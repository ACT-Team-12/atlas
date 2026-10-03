import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wrap as wrapCrate } from "../../../core/atlas-verify/js/atlas_verify.mjs";
import { forgetDeviceChecker, instantiate, loadDeviceChecker, sameSpan, wrap } from "./deviceChecker";
import { deviceParitySet } from "./deviceParity";
import { findSpan } from "./verify";

// The exact file the browser downloads.
const wasm = readFileSync(new URL("../../public/atlas_verify.wasm", import.meta.url));

describe("the checker the browser runs (public/atlas_verify.wasm)", () => {
  it("finds the same span as the server checker on every eval case", async () => {
    const device = await instantiate(wasm);
    const set = deviceParitySet();
    expect(set.cases.length).toBeGreaterThan(100);
    expect(set.cases.some((c) => c.server === null)).toBe(true);
    expect(set.cases.some((c) => c.server !== null)).toBe(true);
    const differ = set.cases.filter((c) => !sameSpan(c.server, device.findSpan(set.papers[c.paper], c.quote)));
    expect(differ).toEqual([]);
  });

  it("agrees on the hard Unicode and ellipsis cases too", async () => {
    const device = await instantiate(wasm);
    const cases: [string, string][] = [
      ["İlaç günde iki kez", "günde iki kez"],
      ["ΟΔΟΣ ΚΑΙ", "ΟΔΟΣ"],
      ["\u{1F48A} Take 1 tablet \u{1F48A} daily", "take 1 tablet \u{1F48A} daily"],
      ["Take a seat.", "Take ... 5 ... mg"],
      ["Take 1 tablet by mouth daily.", "Take 1 tablet ... daily"],
    ];
    for (const [s, q] of cases) expect(device.findSpan(s, q), q).toEqual(findSpan(s, q));
  });

  it("findSpans gives the server's span for every eval case, one call per paper", async () => {
    const device = await instantiate(wasm);
    const set = deviceParitySet();
    set.papers.forEach((paper, i) => {
      const cases = set.cases.filter((c) => c.paper === i);
      const got = device.findSpans(paper, cases.map((c) => c.quote));
      expect(got).toHaveLength(cases.length);
      cases.forEach((c, k) => expect(sameSpan(c.server, got[k]), c.quote).toBe(true));
    });
    expect(device.findSpans("anything", [])).toEqual([]);
  });

  it("findSpans handles 40 limit-sized adversarial items", async () => {
    // 20,000-character source, 600-character quotes, 40 items (schema.ts limits): what the care-plan screen runs on
    // the main thread, in one call that maps the paper once. Time is not asserted (it depends on load);
    // scripts/bench-checker.mjs prints it.
    const device = await instantiate(wasm);
    const src = "\u0130".repeat(20000) + " \u0307" + "\u0130".repeat(299);
    const quotes = Array.from({ length: 40 }, (_, i) => (i % 2 ? "\u0307i".repeat(300) : "\u0307i".repeat(299) + "\u0307"));
    const got = device.findSpans(src, quotes);
    expect(got).toEqual(quotes.map((q) => findSpan(src, q)));
    expect(got.filter((s) => s !== null)).toHaveLength(20);
  });

  it("the browser screens check a whole plan with findSpans, never findSpan per item", () => {
    // findSpan maps the paper on every call, so a loop of them re-maps it once per item on the main thread.
    const ui = ["../ui/CarePlanTool.tsx", "../ui/DeviceParity.tsx"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));
    for (const text of ui) {
      expect(text).toMatch(/checker\.findSpans\(/);
      expect(text).not.toMatch(/checker\.findSpan\(/);
    }
    // A Clear (or a new paper) while the checker loads must stop the old effect before it touches the paper.
    expect(ui[0]).toMatch(/await loadDeviceChecker\(\);\s*if \(!live\) return;/);
  });

  it("leaves no copy of the paper or the quotes in WebAssembly memory after a check, or after Clear", async () => {
    // A ~10 KB marker with mixed case: the raw UTF-8 input, its lower-cased (normalized) UTF-8 and the UTF-16 units
    // the checker searches must all be gone from linear memory once the call returns. The instance is cached for the
    // page, so anything left there would outlive "Clear it from this device".
    let seed = 0x9e3779b9;
    const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const marker = "Mk" + Array.from({ length: 10240 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return abc[(seed >>> 0) % abc.length]; }).join("");
    const paper = `Take 1 tablet daily. ${marker} Call the office.`;
    const quotes = [marker.slice(2000, 2590), "Take 1 tablet daily", marker.slice(5000, 5300) + " not in the paper"];
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const memory = instance.exports.memory as WebAssembly.Memory;
    const checker = wrap(instance.exports as unknown as Parameters<typeof wrap>[0]);
    const leaks = () => {
      const mem = Buffer.from(memory.buffer);
      const found: string[] = [];
      for (const at of [10, 2100, 5100, 9000]) {
        const raw = marker.slice(at, at + 40);
        for (const [form, s, enc] of [["raw utf-8", raw, "utf8"], ["normalized utf-8", raw.toLowerCase(), "utf8"], ["normalized utf-16", raw.toLowerCase(), "utf16le"]] as const) {
          if (mem.indexOf(Buffer.from(s, enc)) >= 0) found.push(`${form} @${at}`);
        }
      }
      return found;
    };
    expect(leaks()).toEqual([]);
    const spans = checker.findSpans(paper, quotes);
    expect(spans.map((s) => s !== null)).toEqual([true, true, false]);
    expect(leaks()).toEqual([]);
    expect(checker.findSpan(paper, quotes[0])).toEqual(spans[0]);
    expect(leaks()).toEqual([]);
  });

  it("treats two missing spans as a match and any other difference as a mismatch", () => {
    expect(sameSpan(null, null)).toBe(true);
    expect(sameSpan({ start: 1, end: 4 }, { start: 1, end: 4 })).toBe(true);
    expect(sameSpan({ start: 1, end: 4 }, null)).toBe(false);
    expect(sameSpan(null, { start: 1, end: 4 })).toBe(false);
    expect(sameSpan({ start: 1, end: 4 }, { start: 2, end: 4 })).toBe(false);
  });
});

// ---------- the paper must not survive a failed call, or a Clear during a load ----------

/** A ~10 KB mixed-case marker, and a scan for its raw UTF-8, normalized UTF-8 and UTF-16 forms in linear memory. */
function marked(seed: number) {
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const marker = "Mk" + Array.from({ length: 10240 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return abc[(seed >>> 0) % abc.length]; }).join("");
  const leaks = (memory: WebAssembly.Memory) => {
    const mem = Buffer.from(memory.buffer);
    const found: string[] = [];
    for (const at of [10, 2100, 5100, 9000]) {
      const raw = marker.slice(at, at + 40);
      for (const [form, str, enc] of [["raw utf-8", raw, "utf8"], ["normalized utf-8", raw.toLowerCase(), "utf8"], ["normalized utf-16", raw.toLowerCase(), "utf16le"]] as const) {
        if (mem.indexOf(Buffer.from(str, enc)) >= 0) found.push(`${form} @${at}`);
      }
    }
    return found;
  };
  return { marker, paper: `Take 1 tablet daily. ${marker} Call the office.`, leaks };
}

type RawExports = Parameters<typeof wrap>[0] & Record<string, unknown>;

/** The real exports, except that allocation number `failAlloc` throws, or the write right after allocation number
 * `failWrite` throws. Tracks every allocation still not freed. */
function faulty(real: RawExports, failAlloc: number | null, failWrite: number | null) {
  let allocs = 0;
  let breakNextWrite = false;
  const open = new Map<number, number>();
  const x = {
    ...real,
    atlas_alloc(len: number) {
      allocs++;
      if (allocs === failAlloc) throw new Error("injected allocation failure");
      const p = real.atlas_alloc(len);
      open.set(p, len);
      if (allocs === failWrite) breakNextWrite = true;
      return p;
    },
    atlas_free(p: number, len: number) {
      open.delete(p);
      real.atlas_free(p, len);
    },
    get memory() {
      if (breakNextWrite) {
        breakNextWrite = false;
        throw new Error("injected write failure");
      }
      return real.memory;
    },
  };
  return { x, open };
}

describe("a failed call leaves no allocation and no copy of the paper", () => {
  const loaders = [
    ["web/src/lib/deviceChecker.ts", (x: RawExports) => wrap(x)],
    ["core/atlas-verify/js/atlas_verify.mjs", (x: RawExports) => wrapCrate(x)],
  ] as const;
  const calls = [
    ["findSpans", (c: ReturnType<typeof wrap>, paper: string, q: string) => c.findSpans(paper, [q, "Take 1 tablet daily"])],
    ["findSpan", (c: ReturnType<typeof wrap>, paper: string, q: string) => c.findSpan(paper, q)],
  ] as const;
  for (const [loader, wrapIt] of loaders) {
    for (const [call, run] of calls) {
      for (const [fault, failAlloc, failWrite] of [["the quote allocation throws", 2, null], ["writing the quote throws", null, 2]] as const) {
        it(`${loader} ${call}: ${fault}`, async () => {
          const { instance } = await WebAssembly.instantiate(wasm, {});
          const real = instance.exports as unknown as RawExports;
          const { marker, paper, leaks } = marked(0x2545f491);
          const { x, open } = faulty(real, failAlloc, failWrite);
          const checker = wrapIt(x) as ReturnType<typeof wrap>;
          expect(() => run(checker, paper, marker.slice(3000, 3500))).toThrow(/injected/);
          expect([...open.entries()]).toEqual([]);
          expect(leaks(real.memory)).toEqual([]);
        });
      }
    }
  }
});

describe("the page's cached checker", () => {
  afterEach(() => {
    forgetDeviceChecker();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A browser-like global with a fetch that waits for `release()`; records every instance it creates. */
  function stubBrowser() {
    const releases: (() => void)[] = [];
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () => {
      await new Promise<void>((r) => releases.push(r));
      return new Response(new Uint8Array(wasm), { headers: { "content-type": "application/octet-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const instances: WebAssembly.Instance[] = [];
    const real = WebAssembly.instantiate.bind(WebAssembly) as (b: BufferSource, i: object) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    vi.spyOn(WebAssembly, "instantiate").mockImplementation((async (b: BufferSource, i: object) => {
      const r = await real(b, i);
      instances.push(r.instance);
      return r;
    }) as typeof WebAssembly.instantiate);
    let released = 0;
    const releaseAll = async () => {
      while (released + releases.length < fetchMock.mock.calls.length) await new Promise((r) => setTimeout(r, 0));
      const now = releases.splice(0);
      released += now.length;
      now.forEach((r) => r());
    };
    return { fetchMock, instances, releaseAll };
  }

  it("is loaded once and reused, and Clear makes the next read load a fresh one", async () => {
    const { fetchMock, releaseAll } = stubBrowser();
    const a = loadDeviceChecker();
    expect(loadDeviceChecker()).toBe(a);
    await releaseAll();
    const first = await a;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    forgetDeviceChecker();
    const b = loadDeviceChecker();
    expect(b).not.toBe(a);
    await releaseAll();
    expect(await b).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves no copy of the paper in the cached instance after a check, or after Clear", async () => {
    const { instances, releaseAll } = stubBrowser();
    const p = loadDeviceChecker();
    await releaseAll();
    const checker = await p;
    const { marker, paper, leaks } = marked(0x1b873593);
    expect(checker.findSpans(paper, [marker.slice(100, 600)])[0]).not.toBeNull();
    const memory = instances[0].exports.memory as WebAssembly.Memory;
    expect(leaks(memory)).toEqual([]);
    forgetDeviceChecker();
    expect(leaks(memory)).toEqual([]);
  });

  it("Clear during a pending load: the stale load never hands out a checker, and does not evict the new one", async () => {
    const { fetchMock, releaseAll } = stubBrowser();
    const stale = loadDeviceChecker();
    forgetDeviceChecker(); // "Clear it from this device" while the wasm is still downloading
    const fresh = loadDeviceChecker();
    expect(fresh).not.toBe(stale);
    await releaseAll();
    await expect(stale).rejects.toThrow(/cleared/);
    const checker = await fresh;
    // The stale load failing must not have dropped the current one from the cache.
    expect(loadDeviceChecker()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(checker.findSpans("Take 1 tablet daily.", ["take 1 tablet"])).toEqual([{ start: 0, end: 13 }]);
  });

  it("Clear aborts a download that never finishes, so nothing waiting on it (and the paper it holds) is kept", async () => {
    vi.stubGlobal("window", {});
    // A request that stalls forever unless its signal aborts, as a real fetch does.
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) return new Promise<Response>(() => {});
      signals.push(signal);
      return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    });
    vi.stubGlobal("fetch", fetchMock);
    const loads: Promise<unknown>[] = [];
    for (let k = 0; k < 5; k++) {
      const p = loadDeviceChecker();
      loads.push(p.then(() => "loaded", () => "settled"));
      forgetDeviceChecker(); // "Clear it from this device" while the wasm is still downloading
    }
    // Every stalled load settles once cleared; without the abort these promises would never resolve.
    expect(await Promise.all(loads)).toEqual(Array(5).fill("settled"));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(signals).toHaveLength(5);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});
