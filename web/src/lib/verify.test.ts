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
    // A grounded item carries the whole sentence from the paper (here, with its period).
    expect(kept.map((k) => k.source_quote)).toEqual(["metformin (GLUCOPHAGE) 500 mg tablet."]);
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

describe("Codex re-review: the care plan shows the whole sentence a quote came from", () => {
  const paper = "Medicines:\n1. If you take insulin, do not take it the morning of your procedure.\n2. Dr. Lee says: stop aspirin 7 days before. Call us with questions.";
  it.each([
    ["take it the morning of your procedure", "If you take insulin, do not take it the morning of your procedure."],
    ["aspirin 7 days before", "Dr. Lee says: stop aspirin 7 days before."],
    ["If you take insulin ... the morning of your procedure", "If you take insulin, do not take it the morning of your procedure."],
  ])("%s", (quote, sentence) => {
    const { kept } = verifyItems(paper, [item(quote)]);
    expect(kept).toHaveLength(1);
    expect(kept[0].source_quote).toBe(sentence);
    expect(paper.slice(kept[0].span!.start, kept[0].span!.end)).toBe(sentence);
  });

  it("a quote that is already a whole sentence is unchanged", () => {
    const q = "Take 1 tablet by mouth 2 times a day with meals.";
    expect(verifyItems(SAMPLE_AVS, [item(q)]).kept[0].source_quote).toBe(q);
  });
});

describe("Codex round 4: a sentence too long to carry is refused, never cut to the fragment", () => {
  const filler = Array.from({ length: 40 }, (_, i) => `item ${i} of your list`).join(", ");
  const sentence = `Do not take insulin, ${filler}, or anything else, and do not take it the morning of your procedure.`;
  const paper = `Medicines:\n${sentence}\nCall us with questions.`;
  it("the test sentence is longer than the 800-character quote limit and starts with its do-not", () => {
    expect(sentence.length).toBeGreaterThan(800);
    expect(sentence.startsWith("Do not")).toBe(true);
  });
  it("a fragment of it is not kept with only the suffix", () => {
    const { kept, refused } = verifyItems(paper, [item("take it the morning of your procedure")]);
    expect(kept).toEqual([]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ grounded: false, span: null, held_reason: "sentence_too_long" });
  });
  it("a short sentence elsewhere in the same paper is still kept", () => {
    expect(verifyItems(paper, [item("Call us with questions")]).kept[0].source_quote).toBe("Call us with questions.");
  });
});

describe("Codex round 4: the care plan's sentence ends at a period followed by a lowercase word", () => {
  it("keeps two lowercase sentences apart, and keeps the explicit exceptions together", () => {
    const paper = "Take bisacodyl. stop iron 3 days before. See Dr. Lee at 7 a.m. the next day.\n1. Take 2.5 mg daily.";
    expect(verifyItems(paper, [item("Take bisacodyl")]).kept[0].source_quote).toBe("Take bisacodyl.");
    expect(verifyItems(paper, [item("Lee at 7")]).kept[0].source_quote).toBe("See Dr. Lee at 7 a.m. the next day.");
    expect(verifyItems(paper, [item("2.5 mg daily")]).kept[0].source_quote).toBe("Take 2.5 mg daily.");
  });
});

describe("Codex round 7: a \"...\" quote never joins two lines or two sentences", () => {
  it.each([
    ["First line says stop aspirin.\nSecond line says take insulin.", "stop aspirin ... take insulin"],
    ["Stop aspirin today. Take insulin tonight.", "Stop aspirin ... Take insulin"],
  ])("%j with %j is held back", (paper, quote) => {
    const { kept, refused } = verifyItems(paper, [item(quote)]);
    expect(kept).toEqual([]);
    expect(refused[0]).toMatchObject({ grounded: false, held_reason: "skips_across" });
  });
  it("a \"...\" inside one sentence is still grounded to that sentence", () => {
    const { kept } = verifyItems("If you take insulin, do not take it the morning of your procedure.", [item("If you take insulin ... the morning of your procedure")]);
    expect(kept[0]).toMatchObject({ grounded: true, source_quote: "If you take insulin, do not take it the morning of your procedure." });
  });
});

describe("Codex round 9: a quote must match whole words and whole numbers", () => {
  it.each([
    ["Don't make a mistake it is easy to fix.", "take it"],
    ["Take 110 mg every morning.", "10 mg"],
    ["Take 2.5 mg every morning.", "5 mg every morning"],
    ["Take 10 mgs daily.", "Take 10 mg"],
  ])("%j does not ground %j", (paper, quote) => {
    expect(findSpan(paper, quote)).toBeNull();
    expect(verifyItems(paper, [item(quote)]).kept).toEqual([]);
  });
  it("a whole-word match later in the paper is still found", () => {
    const paper = "Don't make a mistake it is easy. Take it with food.";
    expect(findSpan(paper, "take it with food")).toEqual({ start: paper.indexOf("Take it"), end: paper.length - 1 });
    expect(findSpan("Take 110 mg. Then take 10 mg.", "take 10 mg")).not.toBeNull();
  });
});
