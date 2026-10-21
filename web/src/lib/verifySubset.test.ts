import { describe, expect, it } from "vitest";
import { findSpan, normalize } from "./verify";
import { fakesFor, INVENTED, PAPERS, runCheckerTest } from "./checkerTest";
import { SAMPLE_AVS } from "./sample";

// ---- findSpan exactly as it was on main before the whole-word rule (frozen copy, for the subset property) ----
function oldNormalizeWithMap(src: string): { norm: string; starts: number[]; ends: number[] } {
  let norm = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let lastSpace = true;
  let i = 0;
  for (const ch of src) {
    const c = normalize(ch) || " ";
    const next = i + ch.length;
    if (c === " ") {
      if (!lastSpace) {
        norm += " ";
        starts.push(i);
        ends.push(next);
        lastSpace = true;
      }
    } else {
      norm += c;
      for (let k = 0; k < c.length; k++) {
        starts.push(i);
        ends.push(next);
      }
      lastSpace = false;
    }
    i = next;
  }
  return { norm: norm.trimEnd(), starts, ends };
}
function oldFragments(quote: string): string[] {
  const frags = normalize(quote)
    .split(/\.\.\.|…/)
    .map((f) => f.replace(/^["'\s]+|["'\s]+$/g, "").trim())
    .filter((f) => f.length > 0);
  return frags.some((f) => f.length < 3) ? [] : frags;
}
function oldFindSpan(source: string, quote: string): { start: number; end: number } | null {
  const frags = oldFragments(quote);
  if (frags.length === 0) return null;
  const { norm, starts, ends } = oldNormalizeWithMap(source);
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const f of frags) {
    const at = norm.indexOf(f, cursor);
    if (at < 0) return null;
    if (first < 0) first = at;
    lastEnd = at + f.length;
    cursor = lastEnd;
  }
  return { start: starts[first], end: ends[lastEnd - 1] };
}

// ------------------------------------------------------------------------------------------------------------------

/** Seeded so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const ADVERSARIAL: [string, string][] = [
  ["Don't make a mistake it is easy to fix.", "take it"],
  ["Take 110 mg every morning.", "10 mg"],
  ["Take 2.5 mg every morning.", "5 mg every morning"],
  ["Take 1,500 mg daily.", "500 mg daily"],
  ["Take 10 mgs daily.", "Take 10 mg"],
  ["Use ٣10 mg.", "10 mg"],
  ["Use １10 mg.", "10 mg"],
  ["Take your pill.\nStop aspirin.", "pill ... stop"],
  ["请每天服用两片药。", "服用两片"],
  ["Stop taking it. Then stop taking iron.", "stop taking i"],
  ["İSTANBUL clinic: take 2 tablets.", "take 2 tablets"],
];

function cases(): [string, string][] {
  const out: [string, string][] = [...ADVERSARIAL];
  const r = rng(20261003);
  for (const p of [...PAPERS, { text: SAMPLE_AVS, expected: [] as string[], distractors: [] as string[] }]) {
    for (const q of [...p.expected, ...p.distractors, ...INVENTED]) out.push([p.text, q]);
    for (const q of p.expected) for (const f of fakesFor(q)) out.push([p.text, f.text]);
    for (let k = 0; k < 400; k++) {
      const a = Math.floor(r() * p.text.length);
      const len = 3 + Math.floor(r() * 40);
      const q = p.text.slice(a, a + len);
      out.push([p.text, q]);
      const b = Math.floor(r() * p.text.length);
      out.push([p.text, `${q} ... ${p.text.slice(b, b + 3 + Math.floor(r() * 20))}`]);
    }
  }
  return out;
}

describe("whole-word span rule only ever refuses more (security review, round 9)", () => {
  const all = cases();
  it("every span the new findSpan accepts, the old one accepted too", () => {
    let newlyRefused = 0;
    const widened: [string, string][] = [];
    for (const [src, q] of all) {
      const now = findSpan(src, q);
      const before = oldFindSpan(src, q);
      if (now && !before) widened.push([src.slice(0, 40), q]);
      if (!now && before) newlyRefused++;
      // Whatever it accepts is a real occurrence of the quote's text in the paper.
      if (now && !/\.\.\.|…/.test(q)) expect(normalize(src.slice(now.start, now.end))).toBe(normalize(q).replace(/^["'\s]+|["'\s]+$/g, ""));
    }
    expect(widened).toEqual([]);
    expect(all.length).toBeGreaterThan(5000);
    // Not vacuous: the new rule does refuse some cut-mid-word quotes the old one took.
    expect(newlyRefused).toBeGreaterThan(50);
    // Heavy (CPU-bound, thousands of cases): fine alone, but under the full parallel suite on a small machine it has
    // crossed vitest's 5 s default. An explicit timeout, not fewer cases.
  }, 30_000);
  it("the checker test is unchanged: every real line accepted, every planted fake caught", () => {
    const r = runCheckerTest();
    expect(r.real).toMatchObject({ total: 38, accepted: 38 });
    expect(r.fakes).toMatchObject({ total: 101, caught: 101 });
  });
});
