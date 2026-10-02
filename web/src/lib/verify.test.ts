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

  it("refuses a quote whose ellipsis fragments are too short to check (an invented dose cannot hide in them)", () => {
    expect(findSpan("Take a seat.", "Take ... 5 ... mg")).toBeNull();
    expect(findSpan("Take 1 tablet by mouth daily.", "Take 1 tablet ... daily")).not.toBeNull();
    // A leading or trailing ellipsis is only an empty fragment, which is dropped.
    expect(findSpan("Take 1 tablet by mouth daily.", "... Take 1 tablet ...")).not.toBeNull();
  });

  it("refuses a quote that is not in the document (a hallucinated instruction)", () => {
    expect(findSpan(SAMPLE_AVS, "Take aspirin 81 mg daily")).toBeNull();
    expect(findSpan(SAMPLE_AVS, "")).toBeNull();
    expect(findSpan(SAMPLE_AVS, "..")).toBeNull();
  });

  it("keeps offsets right after a letter that lower-cases to two units (Turkish İ)", () => {
    const src = "İlaç günde iki kez";
    expect(findSpan(src, "günde iki kez")).toEqual({ start: 5, end: 18 });
    const early = "İ take 1 tablet daily with food";
    const span = findSpan(early, "take 1 tablet")!;
    expect(early.slice(span.start, span.end)).toBe("take 1 tablet");
    // Used to come back as { start: undefined, end: NaN }.
    expect(findSpan("İİİ abc", "abc")).toEqual({ start: 4, end: 7 });
    expect(findSpan("İlaç günde", "İLAÇ")).toEqual({ start: 0, end: 4 });
  });

  it("matches a Greek word ending in capital sigma on both sides", () => {
    const src = "ΟΔΟΣ ΚΑΙ";
    expect(findSpan(src, "ΟΔΟΣ")).toEqual({ start: 0, end: 4 });
    expect(findSpan(src, "οδος")).toEqual({ start: 0, end: 4 });
  });

  it("lower-cases capital letters outside the BMP in the source too", () => {
    // Deseret capitals (surrogate pairs) used to be lower-cased only in the quote.
    expect(findSpan("\u{10400}\u{10401} dose", "\u{10400}\u{10401} dose")).toEqual({ start: 0, end: 9 });
    expect(findSpan("\u{10400}\u{10401} dose", "\u{10428}\u{10429} dose")).toEqual({ start: 0, end: 9 });
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
