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
  it("English: only a cue mismatch blocks", () => {
    expect(negationBlocked(BP, "That morning, take your blood pressure pill with a sip of water.", "English")).toBe(false);
    expect(negationBlocked(INSULIN, "Take your insulin that morning.", "English")).toBe(true);
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
  it("every hand-written sample explanation keeps its line's cues", () => {
    for (const t of PREP_TRUTH) expect([t.quote, negationBlocked(t.quote, t.plain, "English")]).toEqual([t.quote, false]);
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

  it("what this rule can't see: a reversal that keeps the same cue words is left to the meaning check", () => {
    // "not" and "unless" are both still there, so the cue rule passes it; it is shown only if the second model certifies it.
    const plain = "Take insulin that morning unless your doctor says not to.";
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, plain)]);
    const s = r.timeline[0].steps[0];
    expect(s.negation_blocked).toBe(false);
    expect(explainState(s, { status: "done", byId: {} })).toBe("unclear");
  });

  it("a Spanish explanation of a do-not line is hidden even when it is right", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, "No tome insulina esa mañana a menos que su médico se lo diga.")], "Spanish");
    expect(r.timeline[0].steps[0].negation_blocked).toBe(true);
  });

  it("a right English explanation is still shown once certified", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item(INSULIN, "Do not take insulin that morning unless your doctor said to.")]);
    const s = r.timeline[0].steps[0];
    expect(s.negation_blocked).toBe(false);
    expect(shownExplanation(s, falseSame([s]))).toBe("Do not take insulin that morning unless your doctor said to.");
  });
});
