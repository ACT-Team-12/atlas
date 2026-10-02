/**
 * The quote checker, run again on the person's own device.
 *
 * The server checks every step with web/src/lib/verify.ts. This loads the same checker built from Rust
 * (core/atlas-verify, proven identical on the parity corpus) as WebAssembly, so the browser can recompute every
 * span itself. Loaded lazily, only in the browser, only after a read. The file at /atlas_verify.wasm is a byte-for-byte
 * copy of core/atlas-verify/pkg/atlas_verify.wasm (rust-ci checks it).
 */

export type Span = { start: number; end: number };
export type DeviceChecker = { findSpan(source: string, quote: string): Span | null };

export const WASM_URL = "/atlas_verify.wasm";

type Exports = {
  memory: WebAssembly.Memory;
  atlas_alloc(len: number): number;
  atlas_free(ptr: number, len: number): void;
  atlas_find_span(sp: number, sl: number, qp: number, ql: number): number;
  atlas_span_start(): number;
  atlas_span_end(): number;
};

/** Wraps an instantiated module. Strings cross as UTF-8; offsets come back as UTF-16 units (JS string indices). */
export function wrap(x: Exports): DeviceChecker {
  const enc = new TextEncoder();
  const put = (s: string): [number, number] => {
    const bytes = enc.encode(s);
    const ptr = x.atlas_alloc(bytes.length);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  return {
    findSpan(source, quote) {
      const [sp, sl] = put(source);
      const [qp, ql] = put(quote);
      try {
        const r = x.atlas_find_span(sp, sl, qp, ql);
        if (r < 0) throw new Error("atlas_verify: input was not valid UTF-8");
        return r === 0 ? null : { start: x.atlas_span_start(), end: x.atlas_span_end() };
      } finally {
        x.atlas_free(qp, ql);
        x.atlas_free(sp, sl);
      }
    },
  };
}

export async function instantiate(bytes: BufferSource): Promise<DeviceChecker> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return wrap(instance.exports as unknown as Exports);
}

let loading: Promise<DeviceChecker> | null = null;

/** Fetches and instantiates the checker once per page. A failed load is not cached, so a later read can retry. */
export function loadDeviceChecker(): Promise<DeviceChecker> {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") {
    return Promise.reject(new Error("WebAssembly is not available here"));
  }
  loading ??= (async () => {
    const res = await fetch(WASM_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${WASM_URL}`);
    // instantiateStreaming needs the application/wasm content type; fall back to bytes when a host sends another.
    if (typeof WebAssembly.instantiateStreaming === "function" && res.headers.get("content-type")?.startsWith("application/wasm")) {
      const { instance } = await WebAssembly.instantiateStreaming(res, {});
      return wrap(instance.exports as unknown as Exports);
    }
    return instantiate(await res.arrayBuffer());
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** "match" when the device found the same span as the server (or both found nothing). */
export function sameSpan(server: Span | null, device: Span | null): boolean {
  if (server === null || device === null) return server === device;
  return server.start === device.start && server.end === device.end;
}
