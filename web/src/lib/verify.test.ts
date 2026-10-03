import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findSpan, findSpanIn, indexOfAligned, mapSource, normalize, verifyItem, verifyItems } from "./verify";
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
    // Thousands of quotes against a few papers: map each paper once (findSpan is findSpanIn on a fresh map).
    const maps = new Map<string, ReturnType<typeof mapSource>>();
    for (const [src, q] of cases) {
      if (/\.\.\.|…/.test(q)) continue;
      if (!maps.has(src)) maps.set(src, mapSource(src));
      const span = findSpanIn(maps.get(src)!, q);
      if (!span) continue;
      found++;
      if (normalize(src.slice(span.start, span.end)) !== fragmentOf(q)) bad.push(JSON.stringify([q, src.slice(span.start, span.end)]));
    }
    expect(found).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  });
});

describe("findSpan on adversarial input at the request limits", () => {
  // 20,000-character source, 600-character quote, 40 items (schema.ts limits). Every odd normalized position starts
  // an occurrence of the quote, and every one of them begins inside a U+0130 expansion, so none may count. A search
  // that re-compares the whole quote at each such occurrence is O(source * quote) and took ~10 s for 40 items.
  // Wall-clock time is load-dependent, so these tests count the matcher's steps; scripts/bench-checker.mjs times it.
  const source = "İ".repeat(20000);
  const quote = "̇i".repeat(300);

  it("refuses every one of 40 limit-sized items", () => {
    const { kept, refused } = verifyItems(source, Array.from({ length: 40 }, () => item(quote)));
    expect(kept).toHaveLength(0);
    expect(refused).toHaveLength(40);
  });

  /** Steps the matcher takes for one search of `q` in `src` (pattern preprocessing plus the scan). */
  const stepsFor = (src: string, q: string) => {
    const m = mapSource(src);
    const stats = { steps: 0 };
    expect(indexOfAligned(m.norm, normalize(q), 0, m.boundary, stats)).toBe(-1);
    return { steps: stats.steps, hay: m.norm.length, needle: normalize(q).length };
  };

  it("checks word edges inside the same linear pass (a paper of 20,000 \"a\" against 300 \"a\")", () => {
    // Every position is an aligned occurrence that the word-edge rule rejects; re-running the search after each
    // rejection would be quadratic.
    const m = mapSource("a".repeat(20000));
    const stats = { steps: 0 };
    let asked = 0;
    expect(indexOfAligned(m.norm, "a".repeat(300), 0, m.boundary, stats, () => { asked++; return false; })).toBe(-1);
    expect(asked).toBe(20000 - 300 + 1);
    expect(stats.steps).toBeLessThanOrEqual(2 * (20000 + 300));
    expect(findSpan("a".repeat(20000), "a".repeat(300))).toBeNull();
  });

  it("does at most 2 steps per source unit and quote unit (linear, not source * quote)", () => {
    const r = stepsFor(source, quote);
    expect(r.hay).toBe(40000);
    expect(r.needle).toBe(600);
    expect(r.steps).toBeLessThanOrEqual(2 * (r.hay + r.needle));
  });

  it("4x the source and quote costs about 4x the steps, not 16x", () => {
    const small = stepsFor("İ".repeat(5000), "̇i".repeat(75)).steps;
    const big = stepsFor("İ".repeat(20000), "̇i".repeat(300)).steps;
    expect(big / small).toBeLessThanOrEqual(4.5);
  });

  it("still finds the one aligned occurrence after ~20,000 unaligned ones", () => {
    // The tail is a standalone U+0307 followed by 299 U+0130: the quote begins on that standalone mark (a boundary)
    // and ends after the last U+0130's full expansion, so this is the first and only occurrence that may count.
    const src = "İ".repeat(20000) + " ̇" + "İ".repeat(299);
    const q = "̇i".repeat(299) + "̇";
    expect(src.length).toBe(20301);
    expect(findSpan(src, q)).toEqual({ start: 20001, end: 20301 });
    expect(findSpanIn(mapSource(src), q)).toEqual({ start: 20001, end: 20301 });
  });
});

describe("request-scoped source map", () => {
  it("findSpanIn on one mapSource gives the same answer as findSpan, quote by quote", () => {
    const mapped = mapSource(SAMPLE_AVS);
    for (const q of ["Take 1 tablet by mouth 2 times a day with meals.", "Hemoglobin A1c ... due in 3 months", "Increase insulin to 20 units", ""]) {
      expect(findSpanIn(mapped, q), q).toEqual(findSpan(SAMPLE_AVS, q));
    }
    expect(verifyItem(mapped, item("metformin (GLUCOPHAGE) 500 mg tablet"), 3)).toMatchObject({ id: "item-3", grounded: true });
  });

  it("verify.ts keeps no module-level mutable state, so no patient paper outlives its request", () => {
    // A module-level cache in a warm server worker would hold the last paper (and its normalized copy) after the
    // request ends. Any top-level let or var is refused here; the mapped source is passed explicitly instead.
    const text = readFileSync(new URL("./verify.ts", import.meta.url), "utf8");
    expect(text.match(/^(?:export\s+)?(?:let|var)\s+\w+/gm) ?? []).toEqual([]);
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
    ["Take 1/2 tablet daily.", "2 tablet daily"],
    ["Take 3⁄4 cup.", "4 cup"],
    ["Take 1 500 mg.", "500 mg"],
    ["Take 1’500 mg.", "500 mg"],
    ["Take 1 1/2 tablets.", "Take 1"],
    ["Take 1 / 2 tablet daily.", "2 tablet daily"],
    ["Take 3 \u2044 4 cup.", "4 cup"],
    ["Take 1 /2 tablet daily.", "Take 1"],
  ])("%j does not ground %j", (paper, quote) => {
    expect(findSpan(paper, quote)).toBeNull();
    expect(verifyItems(paper, [item(quote)]).kept).toEqual([]);
  });
  it("a whole-word match later in the paper is still found", () => {
    const paper = "Don't make a mistake it is easy. Take it with food.";
    expect(findSpan(paper, "take it with food")).toEqual({ start: paper.indexOf("Take it"), end: paper.length - 1 });
    expect(findSpan("Take 110 mg. Then take 10 mg.", "take 10 mg")).not.toBeNull();
    // Chinese has no spaces between words, so a match mid-run still counts.
    expect(findSpan("请每天服用两片药。", "服用两片")).not.toBeNull();
  });
});
