/**
 * The quote checker, run again on the person's own device.
 *
 * The server checks every step with web/src/lib/verify.ts. This loads the same checker built from Rust
 * (core/atlas-verify, proven identical on the parity corpus) as WebAssembly, so the browser can recompute every
 * span itself. Loaded lazily, only in the browser, only after a read. The file at /atlas_verify.wasm is a byte-for-byte
 * copy of core/atlas-verify/pkg/atlas_verify.wasm (rust-ci checks it).
 */

export type Span = { start: number; end: number };
export type DeviceChecker = {
  findSpan(source: string, quote: string): Span | null;
  /** findSpan for every quote, in order, with the source mapped once (use this for a whole care plan). */
  findSpans(source: string, quotes: readonly string[]): (Span | null)[];
};

export const WASM_URL = "/atlas_verify.wasm";

type Exports = {
  memory: WebAssembly.Memory;
  atlas_alloc(len: number): number;
  atlas_free(ptr: number, len: number): void;
  atlas_find_span(sp: number, sl: number, qp: number, ql: number): number;
  atlas_span_start(): number;
  atlas_span_end(): number;
  atlas_find_spans(sp: number, sl: number, qp: number, ql: number): number;
  atlas_out_ptr(): number;
  atlas_clear_out(): void;
};

/** Wraps an instantiated module. Strings cross as UTF-8; offsets come back as UTF-16 units (JS string indices). */
export function wrap(x: Exports): DeviceChecker {
  const enc = new TextEncoder();
  // The instance is cached for the page, so the paper and quotes must not stay readable in its memory: zero what we
  // wrote before freeing it (the Rust side also zeroes every block it frees, and its output once read).
  const wipeFree = (p: number, l: number) => {
    new Uint8Array(x.memory.buffer, p, l).fill(0);
    x.atlas_free(p, l);
  };
  // Allocates `len` bytes, lets `write` fill them, and frees them (zeroed) if the write throws.
  const alloc = (len: number, write: (p: number) => void): [number, number] => {
    const ptr = x.atlas_alloc(len);
    try {
      write(ptr);
    } catch (e) {
      wipeFree(ptr, len);
      throw e;
    }
    return [ptr, len];
  };
  /** Runs `fn` with `s` copied into memory, and always zeroes and frees the copy afterwards. */
  const withString = <T>(s: string, fn: (p: number, l: number) => T): T => {
    const bytes = enc.encode(s);
    const [p, l] = alloc(bytes.length, (ptr) => new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes));
    try {
      return fn(p, l);
    } finally {
      wipeFree(p, l);
    }
  };
  /** The same for a list of quotes, as frames: a little-endian u32 byte length, then the UTF-8 bytes. */
  const withFrames = <T>(strings: readonly string[], fn: (p: number, l: number) => T): T => {
    const parts = strings.map((s) => enc.encode(s));
    const total = parts.reduce((n, b) => n + 4 + b.length, 0);
    const [p, l] = alloc(total, (ptr) => {
      const view = new DataView(x.memory.buffer, ptr, total);
      const bytes = new Uint8Array(x.memory.buffer, ptr, total);
      let at = 0;
      for (const b of parts) {
        view.setUint32(at, b.length, true);
        bytes.set(b, at + 4);
        at += 4 + b.length;
      }
    });
    try {
      return fn(p, l);
    } finally {
      wipeFree(p, l);
    }
  };
  return {
    findSpans(source, quotes) {
      // Nested, so the source copy is freed even when copying the quotes fails.
      return withString(source, (sp, sl) =>
        withFrames(quotes, (qp, ql) => {
          const len = x.atlas_find_spans(sp, sl, qp, ql);
          if (len < 0) throw new Error("atlas_verify: input was not valid UTF-8");
          const json = new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.atlas_out_ptr(), len));
          x.atlas_clear_out();
          return (JSON.parse(json) as ([number, number] | null)[]).map((r) => (r === null ? null : { start: r[0], end: r[1] }));
        }),
      );
    },
    findSpan(source, quote) {
      return withString(source, (sp, sl) =>
        withString(quote, (qp, ql) => {
          const r = x.atlas_find_span(sp, sl, qp, ql);
          if (r < 0) throw new Error("atlas_verify: input was not valid UTF-8");
          return r === 0 ? null : { start: x.atlas_span_start(), end: x.atlas_span_end() };
        }),
      );
    },
  };
}

export async function instantiate(bytes: BufferSource): Promise<DeviceChecker> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return wrap(instance.exports as unknown as Exports);
}

let loading: Promise<DeviceChecker> | null = null;
// Bumped by forgetDeviceChecker. A load started before a Clear never hands out its checker, so a screen still
// waiting on it cannot copy the cleared paper into it.
let generation = 0;
// Aborts the download of the load in flight. Clear calls it, so a stalled request settles now and every screen
// awaiting it (which holds the paper it meant to check) lets go, instead of waiting on the network indefinitely.
let abortLoad: AbortController | null = null;

/** Fetches and instantiates the checker once per page. A failed load is not cached, so a later read can retry. */
export function loadDeviceChecker(): Promise<DeviceChecker> {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") {
    return Promise.reject(new Error("WebAssembly is not available here"));
  }
  if (loading) return loading;
  const gen = generation;
  const ac = new AbortController();
  const p: Promise<DeviceChecker> = (async () => {
    const res = await fetch(WASM_URL, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${WASM_URL}`);
    // instantiateStreaming needs the application/wasm content type; fall back to bytes when a host sends another.
    let checker: DeviceChecker;
    if (typeof WebAssembly.instantiateStreaming === "function" && res.headers.get("content-type")?.startsWith("application/wasm")) {
      const { instance } = await WebAssembly.instantiateStreaming(res, {});
      checker = wrap(instance.exports as unknown as Exports);
    } else {
      checker = await instantiate(await res.arrayBuffer());
    }
    if (gen !== generation) throw new Error("the on-device checker was cleared while it loaded");
    return checker;
  })().catch((e) => {
    // Only a failure of the CURRENT load clears the cache; a stale one must not evict a newer load.
    if (loading === p) loading = null;
    throw e;
  });
  loading = p;
  abortLoad = ac;
  return p;
}

/**
 * Drops the cached checker, for "Clear it from this device": the next read loads a fresh instance, and a load still
 * in flight is aborted and never hands out its checker. Every check already leaves no copy of the paper in the
 * instance's memory; this also lets the instance itself be collected.
 */
export function forgetDeviceChecker(): void {
  generation++;
  loading = null;
  abortLoad?.abort();
  abortLoad = null;
}

/** "match" when the device found the same span as the server (or both found nothing). */
export function sameSpan(server: Span | null, device: Span | null): boolean {
  if (server === null || device === null) return server === device;
  return server.start === device.start && server.end === device.end;
}
