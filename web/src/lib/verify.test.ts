import { describe, expect, it } from "vitest";
import { findSpan, verifyItems } from "./verify";
import { SAMPLE_AVS } from "./sample";
import { dedupe } from "./extract";

const item = (source_quote: string) => ({
  kind: "medication" as const,
  title: "t",
  plain_language: "p",
  why: "",
  when: "",
  source_quote,
  needs_clarification: false,
  question_for_clinic: "",
});

describe("findSpan", () => {
  it("finds an exact quote and returns original offsets", () => {
    const q = "Take 1 tablet by mouth 2 times a day with meals.";
    const span = findSpan(SAMPLE_AVS, q);
    expect(span).not.toBeNull();
    expect(SAMPLE_AVS.slice(span!.start, span!.end)).toBe(q);
  });

  it("tolerates case, extra whitespace, curly quotes and line breaks", () => {
    expect(findSpan("Call the office if your\n  blood sugar is above 300", "call the office if your blood sugar is above 300")).not.toBeNull();
    expect(findSpan("Patient’s log", "patient's log")).not.toBeNull();
  });

  it("accepts ellipsis fragments only when they appear in order", () => {
    expect(findSpan(SAMPLE_AVS, "Hemoglobin A1c ... due in 3 months")).not.toBeNull();
    expect(findSpan(SAMPLE_AVS, "due in 3 months ... Hemoglobin A1c")).toBeNull();
  });

  it("refuses a quote that is not in the document (a hallucinated instruction)", () => {
    expect(findSpan(SAMPLE_AVS, "Take aspirin 81 mg daily")).toBeNull();
    expect(findSpan(SAMPLE_AVS, "")).toBeNull();
    expect(findSpan(SAMPLE_AVS, "..")).toBeNull();
  });
});

describe("verifyItems", () => {
  it("splits grounded items from refused ones", () => {
    const { kept, refused } = verifyItems(SAMPLE_AVS, [
      item("metformin (GLUCOPHAGE) 500 mg tablet"),
      item("Increase insulin to 20 units"),
    ]);
    expect(kept.map((k) => k.source_quote)).toEqual(["metformin (GLUCOPHAGE) 500 mg tablet"]);
    expect(refused).toHaveLength(1);
    expect(refused[0].grounded).toBe(false);
    expect(kept[0].span).not.toBeNull();
  });
});

describe("dedupe", () => {
  it("removes repeated questions regardless of case and punctuation", () => {
    expect(dedupe(["Where do I get the A1c?", "where do I get the A1c", "Another?"])).toEqual(["Where do I get the A1c?", "Another?"]);
  });
});
