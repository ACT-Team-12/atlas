import { describe, expect, it } from "vitest";
import { PAPERS, runCheckerTest } from "./checkerTest";
import { findSpan } from "./verify";

describe("eval sample papers", () => {
  it("every expected instruction and distractor really appears in its paper", () => {
    for (const p of PAPERS) {
      for (const e of p.expected) expect(findSpan(p.text, e), `${p.id}: ${e}`).not.toBeNull();
      for (const d of p.distractors) expect(findSpan(p.text, d), `${p.id}: ${d}`).not.toBeNull();
    }
  });
});

describe("checker test", () => {
  it("accepts every real instruction and catches every planted fake", () => {
    const r = runCheckerTest();
    expect(r.papers).toBe(6);
    expect(r.real.accepted).toBe(r.real.total);
    expect(r.fakes.total).toBeGreaterThan(50);
    expect(r.fakes.slipped).toEqual([]);
    expect(r.fakes.caught).toBe(r.fakes.total);
  });
});
