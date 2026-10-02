import { describe, expect, it } from "vitest";
import { PAPERS, fakesFor, runCheckerTest } from "./checkerTest";
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

describe("changed-number fakes", () => {
  const changed = (real: string) => fakesFor(real).find((f) => f.kind === "changed number")?.text;

  it("changes the dose or interval, never a digit inside a word", () => {
    expect(changed("Hemoglobin A1c - due in 3 months")).toBe("Hemoglobin A1c - due in 30 months");
    expect(changed("START metformin 500 mg tablet.")).toBe("START metformin 5000 mg tablet.");
    expect(changed("Take 1 tablet by mouth 2 times a day with meals.")).toBe("Take 10 tablet by mouth 2 times a day with meals.");
  });

  it("falls back to a standalone number, and makes no number fake when there is none", () => {
    expect(changed("Call the office if your blood sugar is above 300")).toBe("Call the office if your blood sugar is above 3000");
    expect(changed("Hemoglobin A1c today")).toBeUndefined();
  });
});
