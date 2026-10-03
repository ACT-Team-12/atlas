import { describe, expect, it } from "vitest";
import { cues, cuesDiffer, negationBlocked } from "./prepCues";
import { buildPrepTimeline, type PrepModelItem } from "./prepTimeline";
import { explainState, meaningItems, shownExplanation, type MeaningState } from "./prepView";
import { prepSpeechLines } from "./prepSpeech";
import { combine } from "./meaning";
import { SAMPLE_PREP } from "./samplePrep";
import { PREP_TRUTH } from "./prepPlanted";

const INSULIN = "If you take insulin, do not take it the morning of your procedure unless your doctor told you to.";
const BP = "The morning of your procedure, take your blood pressure pill with a small sip of water.";
const item = (quote: string, plain: string): PrepModelItem => ({ kind: "medicine", plain_language: plain, source_quote: quote, ai_slot: "morning_of" });
/** The meaning check answers "same" (certified) for every step: the worst case, a second model that is wrong. */
const falseSame = (steps: { id: string; plain_language: string; source_quote: string }[]): MeaningState => ({
  status: "done",
  byId: Object.fromEntries(steps.map((s) => [s.id, combine(s.id, { id: s.id, plain_language: s.plain_language, when: "", source_quote: s.source_quote }, "same", "")])),
});

describe("cue words", () => {
  it.each([
    ["do not take it", { no: true, limit: false }], ["Don't eat", { no: true, limit: false }], ["You can't drive", { no: true, limit: false }],
    ["Stop drinking", { no: true, limit: false }], ["Hold your metformin", { no: true, limit: false }], ["Avoid red gelatin", { no: true, limit: false }],
    ["Skip breakfast", { no: true, limit: false }], ["nothing by mouth", { no: true, limit: false }], ["NPO after midnight", { no: true, limit: false }],
    ["Drink until it is gone", { no: false, limit: true }], ["unless your doctor says so", { no: false, limit: true }], ["only clear liquids", { no: false, limit: true }],
    ["except the prep", { no: false, limit: true }], ["Take your pill with water", { no: false, limit: false }],
    ["Note the time and knot nothing", { no: true, limit: false }], ["Note the time", { no: false, limit: false }], ["snow", { no: false, limit: false }],
    ["No tome insulina", { no: true, limit: false }], ["Deje de tomar hierro", { no: true, limit: false }], ["hasta la medianoche", { no: false, limit: true }],
    ["Ne prenez pas d'insuline", { no: true, limit: false }], ["N'oubliez rien", { no: true, limit: false }], ["jusqu'à minuit", { no: false, limit: true }],
    ["Không uống thuốc", { no: true, limit: false }], ["Đừng ăn", { no: true, limit: false }],
    ["不要服用胰岛素", { no: true, limit: false }], ["直到午夜", { no: false, limit: true }],
    ["인슐린을 복용하지 마세요", { no: true, limit: false }], ["자정까지", { no: false, limit: true }],
  ])("%s", (text, want) => expect(cues(text)).toEqual(want));
});

describe("cuesDiffer (both directions)", () => {
  it("a dropped do-not differs", () => expect(cuesDiffer(INSULIN, "Take insulin that morning unless your doctor says so.")).toBe(true));
  it("a dropped until differs", () => expect(cuesDiffer(INSULIN, "Do not take insulin that morning.")).toBe(true));
  it("an added do-not differs", () => expect(cuesDiffer(BP, "Do not take your blood pressure pill that morning.")).toBe(true));
  it("an added only differs", () => expect(cuesDiffer(BP, "That morning, take only your blood pressure pill.")).toBe(true));
  it("a kept do-not and unless match", () => expect(cuesDiffer(INSULIN, "Do not take insulin that morning unless your doctor said to.")).toBe(false));
  it("stop and nothing are the same kind", () => expect(cuesDiffer("Stop drinking all liquids 2 hours before your procedure.", "Nothing to drink in the last 2 hours.")).toBe(false));
  it("Ethiopic script can't be read, so it always differs", () => {
    expect(cuesDiffer(BP, "ጠዋት የደም ግፊት መድሃኒትዎን ይውሰዱ።")).toBe(true);
    expect(cuesDiffer("ኢንሱሊን አይውሰዱ።", "Take your insulin.")).toBe(true);
  });
});

describe("negationBlocked (with the explanation's language)", () => {
  it("English too: any line with a cue word is blocked, even when the explanation keeps it (Codex re-review)", () => {
    expect(negationBlocked(BP, "That morning, take your blood pressure pill with a sip of water.", "English")).toBe(false);
    expect(negationBlocked(INSULIN, "Take your insulin that morning.", "English")).toBe(true);
    expect(negationBlocked(INSULIN, "Do not take insulin that morning unless your doctor said to.", "English")).toBe(true);
  });
  it("other languages: any line with a cue word is blocked, even when the explanation looks right", () => {
    expect(negationBlocked(INSULIN, "No tome insulina esa mañana a menos que su médico se lo diga.", "Spanish")).toBe(true);
    expect(negationBlocked(INSULIN, "不要在那天早上服用胰岛素，除非医生告诉您。", "Chinese")).toBe(true);
  });
  it("other languages: a cue-free line is shown only if the explanation adds no cue", () => {
    expect(negationBlocked(BP, "La mañana de su procedimiento, tome su pastilla para la presión con un sorbo de agua.", "Spanish")).toBe(false);
    expect(negationBlocked(BP, "No tome su pastilla para la presión esa mañana.", "Spanish")).toBe(true);
    expect(negationBlocked(BP, "那天早上不要服用降压药。", "Chinese")).toBe(true);
    expect(negationBlocked(BP, "그날 아침 혈압약을 복용하지 마세요.", "Korean")).toBe(true);
    expect(negationBlocked(BP, "Sáng hôm đó không uống thuốc huyết áp.", "Vietnamese")).toBe(true);
    expect(negationBlocked(BP, "Ne prenez pas votre pilule ce matin-là.", "French")).toBe(true);
  });
  it("Amharic explanations are always blocked", () => {
    expect(negationBlocked(BP, "ጠዋት የደም ግፊት መድሃኒትዎን ይውሰዱ።", "Amharic")).toBe(true);
  });
  it("a sample explanation is shown only for a line with no cue word", () => {
    for (const t of PREP_TRUTH) {
      const q = cues(t.quote);
      expect([t.quote, negationBlocked(t.quote, t.plain, "English")]).toEqual([t.quote, q.no || q.limit]);
    }
    expect(PREP_TRUTH.filter((t) => !negationBlocked(t.quote, t.plain, "English")).length).toBeGreaterThan(4);
  });
});

describe("end to end: a false \"same\" from the meaning check cannot show a reversed explanation", () => {
  const cases: [string, string][] = [
    [INSULIN, "Take your insulin that morning."],
    [BP, "Do not take your blood pressure pill that morning."],
    ["Stop drinking all liquids 2 hours before your procedure.", "Keep drinking liquids in the last 2 hours."],
  ];
  it.each(cases)("%s / %s", (quote, plain) => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item(quote, plain)]);
    const s = [...r.timeline.flatMap((g) => g.steps), ...r.ask][0];
    expect(s.source_quote).toBe(quote);
    expect(s.negation_blocked).toBe(true);
    expect(s.plain_language).toBe("");
    expect(r.stats.negation_blocked).toBe(1);
    expect(meaningItems(r)).toEqual([]); // never even sent to the second model
    const m = falseSame([{ id: s.id, plain_language: plain, source_quote: quote }]);
    expect(explainState(s, m)).toBe("negation");
    expect(shownExplanation(s, m)).toBeNull();
    const spoken = prepSpeechLines(r, m);
    expect(spoken.filter((l) => l.voice === "explanation")).toEqual([]);
    expect(spoken.map((l) => l.text)).not.toContain(plain);
  });

  it("the page re-checks too: a step that reached it with a reversed explanation is still hidden on a false same", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, "Do not take insulin that morning unless your doctor said to.")]);
    const forged = { ...r.timeline[0].steps[0], plain_language: "Take your insulin that morning." };
    const m = falseSame([forged]);
    expect(explainState(forged, m)).toBe("negation");
    expect(shownExplanation(forged, m)).toBeNull();
  });

  it("a reversal that keeps the same cue words is hidden too, even on a false same (Codex re-review)", () => {
    // "not" and "unless" are both still there, so comparing cue words alone would pass it.
    const plain = "Take insulin that morning unless your doctor says not to.";
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, plain)]);
    const s = r.timeline[0].steps[0];
    expect(s.negation_blocked).toBe(true);
    expect(s.plain_language).toBe("");
    expect(shownExplanation(s, falseSame([{ id: s.id, plain_language: plain, source_quote: INSULIN }]))).toBeNull();
    const forged = { ...s, negation_blocked: false, plain_language: plain };
    expect(explainState(forged, falseSame([forged]))).toBe("negation");
  });

  it("a Spanish explanation of a do-not line is hidden even when it is right", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, "No tome insulina esa mañana a menos que su médico se lo diga.")], "Spanish");
    expect(r.timeline[0].steps[0].negation_blocked).toBe(true);
  });

  it("a right explanation of a do-not line is hidden too: the paper's own sentence is shown", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, "Do not take insulin that morning unless your doctor said to.")]);
    const s = r.timeline[0].steps[0];
    expect(s.negation_blocked).toBe(true);
    expect(s.source_quote).toBe(INSULIN);
  });

  it("an explanation of a line with no cue word is still shown once certified", () => {
    const plain = "That morning, take your blood pressure pill with a sip of water.";
    const r = buildPrepTimeline(SAMPLE_PREP, [item(BP, plain)]);
    const s = r.timeline[0].steps[0];
    expect(s.negation_blocked).toBe(false);
    expect(shownExplanation(s, falseSame([s]))).toBe(plain);
  });
});

describe("Codex round 9: fast and omit are do-not words too", () => {
  it.each([
    ["Fast after midnight the night before your procedure.", "Eat after midnight the night before."],
    ["Omit metformin the morning of your procedure.", "Take metformin the morning of your procedure."],
    ["Begin fasting 8 hours before your procedure.", "Eat a meal 8 hours before."],
    ["Pause your water pill the day before your procedure.", "Take your water pill the day before."],
  ])("%s / %s: the explanation is never shown, even on a false same", (quote, plain) => {
    const paper = `PREP SHEET (sample)\n- ${quote}`;
    const r = buildPrepTimeline(paper, [item(quote, plain)]);
    const s = [...r.timeline.flatMap((g) => g.steps), ...r.ask][0];
    expect(s).toMatchObject({ source_quote: quote, negation_blocked: true, plain_language: "" });
    const m = falseSame([{ id: s.id, plain_language: plain, source_quote: quote }]);
    expect(shownExplanation(s, m)).toBeNull();
  });
  it("breakfast is not fast", () => {
    expect(cues("Eat breakfast at 7.").no).toBe(false);
  });
});

describe("Codex round 11: passive and adjectival prohibitions are do-not words", () => {
  it.each([
    ["Aspirin should be avoided 7 days before your procedure.", "Take aspirin 7 days before your procedure."],
    ["Ibuprofen is prohibited 3 days before your procedure.", "Take ibuprofen 3 days before your procedure."],
    ["Fish oil is contraindicated 7 days before your procedure.", "Take fish oil 7 days before your procedure."],
    ["El hierro está prohibido 7 días antes del procedimiento.", "Tome hierro 7 días antes del procedimiento."],
    ["Le fer est interdit 7 jours avant la procédure.", "Prenez du fer 7 jours avant la procédure."],
  ])("%s / %s: never shown, even on a false same", (quote, plain) => {
    const r = buildPrepTimeline(`PREP SHEET (sample)\n- ${quote}`, [item(quote, plain)]);
    const s = [...r.timeline.flatMap((g) => g.steps), ...r.ask][0];
    expect(s).toMatchObject({ source_quote: quote, negation_blocked: true, plain_language: "" });
    expect(shownExplanation(s, falseSame([{ id: s.id, plain_language: plain, source_quote: quote }]))).toBeNull();
  });
});

describe("Codex round 12: delay, postpone and wait are do-not words", () => {
  it.each([
    ["Delay taking metformin on the morning of your procedure.", "Take metformin on the morning of your procedure."],
    ["Postpone your iron pills 7 days before your procedure.", "Take your iron pills 7 days before your procedure."],
    ["Wait to eat until after your procedure.", "Eat before your procedure."],
  ])("%s / %s: never shown, even on a false same", (quote, plain) => {
    const r = buildPrepTimeline(`PREP SHEET (sample)\n- ${quote}`, [item(quote, plain)]);
    const s = [...r.timeline.flatMap((g) => g.steps), ...r.ask][0];
    expect(s).toMatchObject({ negation_blocked: true, plain_language: "" });
    expect(shownExplanation(s, falseSame([{ id: s.id, plain_language: plain, source_quote: quote }]))).toBeNull();
  });
});
