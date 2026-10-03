import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instantiate, sameSpan } from "./deviceChecker";
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

  it("findSpans handles 40 limit-sized adversarial items and maps the paper once, not per item", async () => {
    // 20,000-character source, 600-character quotes, 40 items (schema.ts limits): what the care-plan screen runs on
    // the main thread. Calling findSpan 40 times re-maps the paper 40 times (seconds on a slow phone).
    const device = await instantiate(wasm);
    const src = "\u0130".repeat(20000) + " \u0307" + "\u0130".repeat(299);
    const quotes = Array.from({ length: 40 }, (_, i) => (i % 2 ? "\u0307i".repeat(300) : "\u0307i".repeat(299) + "\u0307"));
    const got = device.findSpans(src, quotes);
    expect(got).toEqual(quotes.map((q) => findSpan(src, q)));
    expect(got.filter((s) => s !== null)).toHaveLength(20);
    // Relative, not absolute: mapping dominates one call, so 40 quotes in one batch must cost a small multiple of one
    // findSpan, where 40 findSpan calls cost ~40x. Best of 3 each, to damp scheduler noise.
    const best = (f: () => void) => Math.min(...[0, 1, 2].map(() => { const t = performance.now(); f(); return performance.now() - t; }));
    const one = best(() => device.findSpan(src, quotes[1]));
    const batch = best(() => device.findSpans(src, quotes));
    expect(batch / one).toBeLessThan(10);
  });

  it("treats two missing spans as a match and any other difference as a mismatch", () => {
    expect(sameSpan(null, null)).toBe(true);
    expect(sameSpan({ start: 1, end: 4 }, { start: 1, end: 4 })).toBe(true);
    expect(sameSpan({ start: 1, end: 4 }, null)).toBe(false);
    expect(sameSpan(null, { start: 1, end: 4 })).toBe(false);
    expect(sameSpan({ start: 1, end: 4 }, { start: 2, end: 4 })).toBe(false);
  });
});
