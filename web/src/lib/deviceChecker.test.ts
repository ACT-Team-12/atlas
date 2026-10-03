import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forgetDeviceChecker, instantiate, sameSpan, wrap } from "./deviceChecker";
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
    forgetDeviceChecker();
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
