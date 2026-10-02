import { describe, expect, it } from "vitest";
import { findSpan, normalize, verifyItems } from "./verify";
import { SAMPLE_AVS } from "./sample";
import { PAPERS, fakesFor } from "./checkerTest";
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

  it("never starts or ends a match inside one character's case expansion", () => {
    // "İ" lower-cases to "i" + U+0307. A quote may not begin at the U+0307 half...
    expect(findSpan("Dose İ 5 mg", "̇ 5 mg")).toBeNull();
    expect(findSpan("İlaç", "̇laç")).toBeNull();
    // ...nor end at the "i" half, which used to widen the highlight to the whole "İ".
    expect(findSpan("Dose İ 5 mg", "Dose i")).toBeNull();
    // The whole character still matches.
    expect(findSpan("Dose İ 5 mg", "dose İ 5 mg")).toEqual({ start: 0, end: 11 });
    expect(findSpan("Dose İ 5 mg", "İ 5 mg")).toEqual({ start: 5, end: 11 });
  });

  it("keeps searching past an unaligned occurrence to a later aligned one", () => {
    // The first "̇ 5 mg" is inside "İ"; the second is a real combining dot, its own source character.
    const src = "İ 5 mg, then ̇ 5 mg";
    expect(findSpan(src, "̇ 5 mg")).toEqual({ start: 13, end: 19 });
  });
});

/** The fragment a single-fragment quote must match, by the checker's own rules. */
const fragmentOf = (q: string) => normalize(q).replace(/^["'\s]+|["'\s]+$/g, "").trim();

describe("oracle: every highlighted slice normalizes to the fragment it matched", () => {
  const cases: [string, string][] = [];
  for (const p of PAPERS) {
    for (const e of [...p.expected, ...p.distractors]) cases.push([p.text, e]);
    for (const e of p.expected) for (const f of fakesFor(e)) cases.push([p.text, f.text]);
    // Substrings of each line, including ones that start or end mid-word.
    for (const line of p.text.split("\n").filter((l) => l.trim().length > 6)) {
      for (let a = 0; a < line.length - 3; a += 3) for (let b = a + 3; b <= line.length; b += 5) cases.push([p.text, line.slice(a, b)]);
    }
  }
  // Every code-point substring of strings full of case expansions, as-is and upper-cased.
  for (const src of ["İlaç günde İki kez ΟΔΟΣ \u{10400}\u{10401} \u{1F48A} dose 5 mg", "Dose İ 5 mg, then ̇ 5 mg"]) {
    const cps = Array.from(src);
    for (let a = 0; a < cps.length; a++) {
      for (let b = a + 1; b <= cps.length; b++) {
        cases.push([src, cps.slice(a, b).join("")]);
        cases.push([src, cps.slice(a, b).join("").toUpperCase()]);
      }
    }
  }

  it("holds on every case that is found", () => {
    let found = 0;
    const bad: string[] = [];
    for (const [src, q] of cases) {
      if (/\.\.\.|…/.test(q)) continue;
      const span = findSpan(src, q);
      if (!span) continue;
      found++;
      if (normalize(src.slice(span.start, span.end)) !== fragmentOf(q)) bad.push(JSON.stringify([q, src.slice(span.start, span.end)]));
    }
    expect(found).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
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
