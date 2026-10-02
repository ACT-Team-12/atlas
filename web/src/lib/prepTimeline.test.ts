import { describe, expect, it } from "vitest";
import { buildPrepTimeline, PrepRequestSchema, type PrepModelItem } from "./prepTimeline";
import { prepSpeechLines } from "./prepSpeech";
import { SAMPLE_PREP, SAMPLE_PREP_LABEL } from "./samplePrep";
import { PREP_PLANT_KINDS, PREP_TRUTH, prepPlants, runPrepPlantedTest } from "./prepPlanted";

const item = (over: Partial<PrepModelItem>): PrepModelItem => ({
  kind: "medicine", title: "Iron", plain_language: "Stop iron 7 days before.", source_quote: "Stop taking iron pills and fish oil 7 days before your procedure.", ai_slot: "days_before", ...over,
});

describe("buildPrepTimeline", () => {
  it("keeps a verified step and places it from its quote", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({})]);
    expect(r.timeline).toHaveLength(1);
    expect(r.timeline[0].slot).toBe("days_before");
    expect(r.timeline[0].steps[0]).toMatchObject({ when_words: ["7 days before"], reason: "placed", explanation_hidden: false });
    expect(r.stats).toMatchObject({ extracted: 1, verified: 1, held_back: 0, placed: 1, ask: 0, ai_slot_overridden: 0 });
  });

  it("holds back a step whose quote is not in the paper, and counts it without showing it", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: "Stop taking iron pills 10 days before your procedure." })]);
    expect(r.timeline).toEqual([]);
    expect(r.ask).toEqual([]);
    expect(r.held_back).toEqual({ count: 1, kinds: ["medicine"] });
  });

  it("holds back an empty quote", () => {
    expect(buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: "   " })]).held_back.count).toBe(1);
  });

  it("ignores the AI's slot: a wrong claim is overridden and counted", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ ai_slot: "morning_of" })]);
    expect(r.timeline[0].slot).toBe("days_before");
    expect(r.stats.ai_slot_overridden).toBe(1);
  });

  it("puts a step with no time words under Ask your clinic when, even if the AI gave it a time", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ kind: "bring", source_quote: "Bring your photo ID, insurance card, and a list of all your medicines.", plain_language: "Bring ID.", ai_slot: "arrival" })]);
    expect(r.timeline).toEqual([]);
    expect(r.ask[0]).toMatchObject({ slot: null, reason: "no_time_words" });
  });

  it("does not place a quote that runs across two lines of the paper", () => {
    const quote = "Bring your photo ID, insurance card, and a list of all your medicines.\n\nAFTER YOUR PROCEDURE";
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: quote, plain_language: "Bring ID.", ai_slot: "after" })]);
    expect(r.ask[0]).toMatchObject({ slot: null, reason: "multi_line" });
  });

  it("hides the AI's explanation when it has a number the quote doesn't", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ plain_language: "Stop iron 5 days before." })]);
    const s = r.timeline[0].steps[0];
    expect(s.explanation_hidden).toBe(true);
    expect(s.plain_language).toBe("");
    expect(s.title).toBe("Medicine");
    expect(s.source_quote).toContain("7 days before"); // the paper's own words are still shown
    expect(r.stats.explanations_hidden).toBe(1);
  });

  it("a number in the title counts too", () => {
    expect(buildPrepTimeline(SAMPLE_PREP, [item({ title: "Stop iron 3 days early" })]).timeline[0].steps[0].explanation_hidden).toBe(true);
  });

  it("orders groups by time and steps by their place in the paper", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [...PREP_TRUTH].reverse().map((t) => item({ kind: t.kind, plain_language: t.plain, source_quote: t.quote, title: t.kind })));
    expect(r.timeline.map((g) => g.slot)).toEqual(["days_before", "day_before", "evening_before", "hours_before", "morning_of", "arrival", "after"]);
    const firstGroup = r.timeline[0].steps.map((s) => s.source_quote);
    expect(firstGroup[0]).toMatch(/^Stop taking iron/);
    expect(r.ask.map((s) => s.kind)).toEqual(["bowel_prep", "bring", "call"]);
  });

  it("reads at most 40 steps", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, Array.from({ length: 60 }, () => item({})));
    expect(r.stats.extracted).toBe(40);
  });
});

describe("prepSpeechLines (phone voice)", () => {
  const r = buildPrepTimeline(SAMPLE_PREP, PREP_TRUTH.map((t) => item({ kind: t.kind, plain_language: t.plain, source_quote: t.quote, title: t.kind })));
  it("English: each group starts with its label, steps numbered in order", () => {
    const lines = prepSpeechLines(r, "English");
    expect(lines[0]).toBe("Days before.");
    expect(lines[1]).toMatch(/^1\. /);
    expect(lines.some((l) => l.startsWith("Ask your clinic when."))).toBe(true);
    expect(lines.filter((l) => /^\d+\. /.test(l))).toHaveLength(PREP_TRUTH.length);
  });
  it("other languages: no English labels, only the numbered steps", () => {
    const lines = prepSpeechLines(r, "Spanish");
    expect(lines).toHaveLength(PREP_TRUTH.length);
    expect(lines.every((l) => /^\d+\. /.test(l))).toBe(true);
  });
});

describe("request schema", () => {
  it("needs some text and a known language", () => {
    expect(PrepRequestSchema.safeParse({ text: "short" }).success).toBe(false);
    expect(PrepRequestSchema.safeParse({ text: SAMPLE_PREP, language: "Klingon" }).success).toBe(false);
    expect(PrepRequestSchema.parse({ text: SAMPLE_PREP }).language).toBe("English");
  });
});

describe("prep mode: planted mistakes (no AI)", () => {
  it("the sample is labeled, and every truth quote is in it", () => {
    expect(SAMPLE_PREP).toMatch(/written by Team ATLAS, not a real patient/);
    expect(SAMPLE_PREP_LABEL).toMatch(/not a real patient/);
    for (const t of PREP_TRUTH) expect(SAMPLE_PREP).toContain(t.quote);
  });

  it("covers every kind of planted mistake", () => {
    expect([...new Set(prepPlants().map((p) => p.kind))].sort()).toEqual([...PREP_PLANT_KINDS].sort());
  });

  const report = runPrepPlantedTest();
  it("places every correct step in its hand-labeled slot", () => {
    expect(report.real.wrong).toEqual([]);
    expect(report.real.right).toBe(PREP_TRUTH.length);
  });
  it("catches every planted mistake", () => {
    expect(report.planted.slipped).toEqual([]);
    expect(report.planted.caught).toBe(report.planted.total);
    expect(report.planted.total).toBeGreaterThan(60);
  });

  it("the test can fail: a timeline that trusted the AI's slot would let mistakes through", () => {
    // Sanity check on the harness itself: if a plant is scored against the wrong expectation it must show up.
    const plants = prepPlants();
    const wrongClaims = plants.filter((p) => p.kind === "wrong time claimed");
    expect(wrongClaims.length).toBe(PREP_TRUTH.filter((t) => t.truth !== "ask").length);
    expect(wrongClaims.every((p) => p.item.ai_slot !== p.truth)).toBe(true);
  });
});
