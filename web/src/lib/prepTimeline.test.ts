import { describe, expect, it } from "vitest";
import { buildPrepTimeline, PrepRequestSchema, withinOneLine, type PrepModelItem } from "./prepTimeline";
import { prepSpeechLines } from "./prepSpeech";
import { SAMPLE_PREP, SAMPLE_PREP_LABEL } from "./samplePrep";
import { PREP_PLANT_KINDS, PREP_TRUTH, prepPlants, runPrepPlantedTest } from "./prepPlanted";
import { explainState, meaningItems, shownExplanation, type MeaningState } from "./prepView";
import { combine } from "./meaning";

const item = (over: Partial<PrepModelItem>): PrepModelItem => ({
  kind: "medicine", plain_language: "Stop iron 7 days before.", source_quote: "Stop taking iron pills and fish oil 7 days before your procedure.", ai_slot: "days_before", ...over,
});

describe("buildPrepTimeline", () => {
  it("keeps a verified step and places it from its quote", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({})]);
    expect(r.timeline).toHaveLength(1);
    expect(r.timeline[0].slot).toBe("days_before");
    expect(r.timeline[0].steps[0]).toMatchObject({ when_words: ["7 days before your procedure"], reason: "placed", numbers_blocked: false });
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

  it("blocks the AI's explanation when it has a number the quote doesn't", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ plain_language: "Stop iron 5 days before." })]);
    const s = r.timeline[0].steps[0];
    expect(s.numbers_blocked).toBe(true);
    expect(s.plain_language).toBe("");
    expect(s.source_quote).toContain("7 days before"); // the paper's own words are still shown
    expect(r.stats.numbers_blocked).toBe(1);
  });

  it("Codex review: number WORDS count too", () => {
    const blocked = (plain: string) => buildPrepTimeline(SAMPLE_PREP, [item({ plain_language: plain })]).timeline[0].steps[0].numbers_blocked;
    expect(blocked("Stop iron three days before.")).toBe(true);
    expect(blocked("Stop iron twice.")).toBe(true);
    expect(blocked("Stop iron seven days before.")).toBe(false); // "seven" is the paper's 7
    expect(blocked("Stop iron 7 days before.")).toBe(false);
  });

  it("orders groups by time and steps by their place in the paper", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [...PREP_TRUTH].reverse().map((t) => item({ kind: t.kind, plain_language: t.plain, source_quote: t.quote })));
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

describe("prepSpeechLines (phone voice, Codex review: read the paper, not the paraphrase)", () => {
  const r = buildPrepTimeline(SAMPLE_PREP, PREP_TRUTH.map((t) => item({ kind: t.kind, plain_language: t.plain, source_quote: t.quote })));
  const steps = [...r.timeline.flatMap((g) => g.steps), ...r.ask];
  const texts = (m?: MeaningState) => prepSpeechLines(r, m).map((l) => l.text);

  it("reads every step's exact quote from the paper, in the paper's voice", () => {
    const lines = prepSpeechLines(r);
    for (const s of steps) expect(lines).toContainEqual({ text: s.source_quote, voice: "paper" });
    expect(lines[0]).toEqual({ text: "Days before.", voice: "ours" });
    expect(lines.filter((l) => /^Step \d+\. Your paper says:$/.test(l.text))).toHaveLength(PREP_TRUTH.length);
  });

  it("reads the time words that placed each step, and why an unplaced step has none", () => {
    const lines = texts();
    expect(lines).toContain("7 days before your procedure");
    expect(lines).toContain("Your paper gives a time but not which day.");
    expect(lines).toContain("3 PM");
    expect(lines).toContain("Your paper doesn't say when for this one.");
  });

  it("never reads an unchecked paraphrase; says it was left out instead", () => {
    const lines = texts({ status: "loading", byId: {} });
    expect(prepSpeechLines(r, { status: "loading", byId: {} }).filter((l) => l.voice === "explanation")).toEqual([]);
    // (one sample explanation is word for word its quote, so that text is still read, as the quote)
    for (const t of PREP_TRUTH.filter((x) => x.plain !== x.quote)) expect(lines).not.toContain(t.plain);
    const open = steps.filter((s) => s.plain_language !== "");
    expect(open.length).toBeGreaterThan(3);
    expect(lines.filter((l) => l === "The plain-words explanation is still being checked, so it is left out.")).toHaveLength(open.length);
    expect(lines.filter((l) => l.startsWith("There is no plain-words explanation for this one"))).toHaveLength(steps.length - open.length);
    expect(texts({ status: "error", byId: {} })).toContain("The plain-words explanation is left out because the double-check isn't available right now.");
  });

  it("announces a flagged or number-blocked explanation", () => {
    const s = steps.find((x) => x.plain_language !== "")!;
    const flagged: MeaningState = { status: "done", byId: { [s.id]: combine(s.id, { id: s.id, plain_language: s.plain_language, when: "", source_quote: s.source_quote }, "different", "x") } };
    expect(texts(flagged)).toContain("The plain-words explanation is left out because a second check found it may not match your paper.");
    const b = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: "5 hours before your procedure, drink the second half of the bowel prep.", plain_language: "8 hours before, drink the rest of the prep." })]);
    expect(prepSpeechLines(b, { status: "done", byId: {} }).map((l) => l.text)).toContain("The plain-words explanation is left out because it had a number your paper doesn't say.");
  });

  it("reads a certified explanation, in the chosen language's voice", () => {
    const byId = Object.fromEntries(steps.map((s) => [s.id, combine(s.id, { id: s.id, plain_language: s.plain_language, when: s.when_words.join(", "), source_quote: s.source_quote }, "same", "")]));
    const lines = prepSpeechLines(r, { status: "done", byId });
    for (const s of steps) {
      const t = PREP_TRUTH.find((x) => x.quote === s.source_quote)!;
      if (s.plain_language) expect(lines).toContainEqual({ text: t.plain, voice: "explanation" });
      else expect(lines).not.toContainEqual({ text: t.plain, voice: "explanation" });
    }
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

describe("Codex review: Unicode line separators", () => {
  const breaks: [string, string][] = [["U+0085", "\u0085"], ["U+2028", "\u2028"], ["U+2029", "\u2029"], ["vertical tab", "\v"], ["form feed", "\f"], ["CR", "\r"], ["LF", "\n"]];
  it.each(breaks)("a quote that runs across a %s is never placed at the next line's time", (_name, br) => {
    const paper = `PREP SHEET (sample)${br}Bring your photo ID${br}2 hours before your procedure, stop drinking.`;
    const quote = `Bring your photo ID${br}2 hours before your procedure`;
    const r = buildPrepTimeline(paper, [item({ kind: "bring", source_quote: quote, plain_language: "", ai_slot: "hours_before" })]);
    expect(r.timeline).toEqual([]);
    expect(r.ask).toHaveLength(1);
    expect(r.ask[0]).toMatchObject({ slot: null, reason: "multi_line" });
  });

  it.each(breaks.filter(([n]) => !["U+0085"].includes(n)))("the AI's quote has a plain space where the paper has a %s: still not placed", (_name, br) => {
    const paper = `PREP SHEET (sample)${br}Bring your photo ID${br}2 hours before your procedure, stop drinking.`;
    const r = buildPrepTimeline(paper, [item({ kind: "bring", source_quote: "Bring your photo ID 2 hours before your procedure", plain_language: "", ai_slot: "hours_before" })]);
    expect(r.timeline).toEqual([]);
    expect(r.ask[0]).toMatchObject({ reason: "multi_line" });
  });

  it.each(breaks)("withinOneLine refuses a span across a %s", (_name, br) => {
    const src = `abc${br}def`;
    expect(withinOneLine(src, { start: 0, end: 3 })).toBe(true);
    expect(withinOneLine(src, { start: 4, end: 7 })).toBe(true);
    expect(withinOneLine(src, { start: 1, end: 6 })).toBe(false);
  });

  it("refuses a span outside the paper", () => {
    expect(withinOneLine("abc", { start: 0, end: 9 })).toBe(false);
    expect(withinOneLine("abc", { start: 2, end: 1 })).toBe(false);
  });
});

describe("Codex review: the explanation fails closed (negation reversal)", () => {
  const insulin = "If you take insulin, do not take it the morning of your procedure unless your doctor told you to.";
  const r = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: insulin, plain_language: "Take insulin that morning.", ai_slot: "morning_of" })]);
  const s = r.timeline[0].steps[0];

  it("the headline is the paper's own quote, never the AI's words", () => {
    expect(s.source_quote).toBe(insulin);
    expect(Object.keys(s)).not.toContain("title");
  });

  it("the reversed explanation passes the number check (no numbers), and our code's do-not rule blocks it", () => {
    expect(s.numbers_blocked).toBe(false);
    expect(s.negation_blocked).toBe(true);
    expect(s.plain_language).toBe("");
  });

  it("is not shown while checking, after a failed check, when flagged, unclear, or not returned", () => {
    const states: MeaningState[] = [
      { status: "idle", byId: {} },
      { status: "loading", byId: {} },
      { status: "error", byId: {} },
      { status: "done", byId: {} },
      { status: "done", byId: { [s.id]: combine(s.id, { id: s.id, plain_language: s.plain_language, when: "", source_quote: insulin }, "different", 'paper says "do not take it" but explanation says "take insulin"') } },
      { status: "done", byId: { [s.id]: combine(s.id, { id: s.id, plain_language: s.plain_language, when: "", source_quote: insulin }, "unclear", "") } },
    ];
    expect(states.map((m) => explainState(s, m))).toEqual(["negation", "negation", "negation", "negation", "negation", "negation"]);
    for (const m of states) expect(shownExplanation(s, m)).toBeNull();
  });

  it("is not shown even when the meaning check wrongly says \"same\" (Codex review)", () => {
    const ok: MeaningState = { status: "done", byId: { [s.id]: combine(s.id, { id: s.id, plain_language: "Take insulin that morning.", when: "", source_quote: insulin }, "same", "") } };
    expect(explainState(s, ok)).toBe("negation");
    expect(shownExplanation(s, ok)).toBeNull();
  });

  it("even an explanation that keeps the do-not is never shown for this line (Codex re-review)", () => {
    const keep = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: insulin, plain_language: "Do not take insulin that morning unless your doctor said to.", ai_slot: "morning_of" })]).timeline[0].steps[0];
    const same: MeaningState = { status: "done", byId: { [keep.id]: combine(keep.id, { id: keep.id, plain_language: "Do not take insulin that morning unless your doctor said to.", when: "", source_quote: insulin }, "same", "") } };
    expect(explainState(keep, same)).toBe("negation");
    expect(shownExplanation(keep, same)).toBeNull();
  });

  it("an explanation of a line with no cue word is shown only when the meaning check certified it", () => {
    const bp = "The morning of your procedure, take your blood pressure pill with a small sip of water.";
    const plain = "That morning, take your blood pressure pill with a sip of water.";
    const keep = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: bp, plain_language: plain, ai_slot: "morning_of" })]).timeline[0].steps[0];
    const m = (v: "same" | "different" | "unclear"): MeaningState => ({ status: "done", byId: { [keep.id]: combine(keep.id, { id: keep.id, plain_language: plain, when: "", source_quote: bp }, v, "") } });
    expect([explainState(keep, { status: "loading", byId: {} }), explainState(keep, m("different")), explainState(keep, m("unclear"))]).toEqual(["checking", "flagged", "unclear"]);
    expect(shownExplanation(keep, m("same"))).toBe(plain);
  });

  it("a blocked explanation is never sent to the meaning check and never shown", () => {
    const b = buildPrepTimeline(SAMPLE_PREP, [item({ plain_language: "Stop iron 5 days before." })]);
    expect(meaningItems(b)).toEqual([]);
    expect(explainState(b.timeline[0].steps[0], { status: "done", byId: {} })).toBe("numbers");
  });

  it("sends every unblocked explanation with its quote and time words, and never a blocked one", () => {
    expect(meaningItems(r)).toEqual([]);
    const bp = "The morning of your procedure, take your blood pressure pill with a small sip of water.";
    const keep = buildPrepTimeline(SAMPLE_PREP, [item({ source_quote: bp, plain_language: "That morning, take your blood pressure pill.", ai_slot: "morning_of" })]);
    expect(meaningItems(keep)).toEqual([{ id: keep.timeline[0].steps[0].id, plain_language: "That morning, take your blood pressure pill.", when: "The morning of your procedure", source_quote: bp }]);
  });
});

describe("Codex review: an ellipsis quote can drop the paper's \"do not\"", () => {
  const paper = "PREP SHEET (sample)\nIf you take insulin, do not take it the morning of your procedure.\n";
  const dropped = "If you take insulin ... take it the morning of your procedure";

  it("findSpan itself accepts the fragments, which is why prep mode must refuse them", () => {
    expect(buildPrepTimeline(paper, [item({ source_quote: "If you take insulin, do not take it the morning of your procedure." })]).timeline).toHaveLength(1);
  });

  it.each([["three dots", "..."], ["ellipsis character", "…"], ["spaced dots", ". . ."], ["two dots", ".."], ["midline ellipsis", "⋯"]])(
    "a quote with %s is held back, never shown, spoken, or placed",
    (_name, e) => {
      const r = buildPrepTimeline(paper, [item({ source_quote: dropped.replace("...", e), plain_language: "", ai_slot: "morning_of" })]);
      expect(r.timeline).toEqual([]);
      expect(r.ask).toEqual([]);
      expect(r.held_back.count).toBe(1);
      expect(prepSpeechLines(r).map((l) => l.text).join(" ")).not.toContain("take it the morning");
    },
  );

  it("an accepted quote is replaced by the paper's own text (case, quote marks, spacing)", () => {
    const r = buildPrepTimeline(paper, [item({ source_quote: "if you take INSULIN,   do not take it the morning of your procedure", plain_language: "" })]);
    const s = r.timeline[0].steps[0];
    expect(s.source_quote).toBe("If you take insulin, do not take it the morning of your procedure.");
    expect(prepSpeechLines(r)).toContainEqual({ text: "If you take insulin, do not take it the morning of your procedure.", voice: "paper" });
  });
});

describe("Codex re-review: an exact fragment can leave out the line's \"do not\", \"stop\", \"until\" or \"unless\"", () => {
  const paper = [
    "PREP SHEET (sample)",
    "- If you take insulin, do not take it the morning of your procedure.",
    "- Stop taking aspirin 7 days before your procedure.",
    "- Drink clear liquids until 2 hours before your procedure.",
    "- Take metformin the morning of your procedure unless your doctor told you not to.",
    "- Take your pill. Stop drinking 2 hours before your procedure.",
  ].join("\n");
  const shown = (quote: string) => {
    const r = buildPrepTimeline(paper, [item({ source_quote: quote, plain_language: "" })]);
    const steps = [...r.timeline.flatMap((g) => g.steps), ...r.ask];
    expect(steps).toHaveLength(1);
    return { s: steps[0], spoken: prepSpeechLines(r).filter((l) => l.voice === "paper").map((l) => l.text) };
  };

  it.each([
    ["suffix fragment drops \"do not\"", "take it the morning of your procedure", "If you take insulin, do not take it the morning of your procedure."],
    ["prefix-dropped \"Stop\"", "taking aspirin 7 days before your procedure", "Stop taking aspirin 7 days before your procedure."],
    ["dropped \"until\" clause", "Drink clear liquids", "Drink clear liquids until 2 hours before your procedure."],
    ["dropped \"unless\" clause", "Take metformin the morning of your procedure", "Take metformin the morning of your procedure unless your doctor told you not to."],
  ])("%s: the whole sentence is shown and spoken", (_n, quote, sentence) => {
    const { s, spoken } = shown(quote);
    expect(s.source_quote).toBe(sentence);
    expect(spoken).toContain(sentence);
    expect(spoken).not.toContain(quote);
  });

  it("the sentence, not the whole line: a fragment of the first sentence never takes the next sentence's time", () => {
    const { s } = shown("Take your pill");
    expect(s.source_quote).toBe("Take your pill.");
    expect(s.slot).toBeNull();
  });

  it("a fragment of a timed sentence is placed from the whole sentence", () => {
    const { s } = shown("taking aspirin");
    expect(s.source_quote).toBe("Stop taking aspirin 7 days before your procedure.");
    expect(s.slot).toBe("days_before");
  });
});

describe("Codex re-review: a changed number written as a word in another language", () => {
  const bisa = "Take 2 bisacodyl tablets at 3 PM.";
  it.each<[string, string]>([
    ["Spanish", "Tome cuatro tabletas de bisacodilo a las 3 PM."],
    ["French", "Prenez quatre comprimés de bisacodyl à 3 PM."],
    ["Vietnamese", "Uống bốn viên bisacodyl lúc 3 PM."],
    ["Korean", "오후 3시에 비사코딜 네 알을 드세요."],
    ["Chinese", "下午3点服用四片比沙可啶。"],
  ])("%s: %s is blocked", (language, plain) => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ kind: "bowel_prep", source_quote: bisa, plain_language: plain, ai_slot: "not_stated" })], language as never);
    expect(r.ask[0]).toMatchObject({ numbers_blocked: true, plain_language: "" });
  });

  it("the same number in words passes the number check", () => {
    const r = buildPrepTimeline(SAMPLE_PREP, [item({ kind: "bowel_prep", source_quote: bisa, plain_language: "Tome dos tabletas de bisacodilo a las 3 PM.", ai_slot: "not_stated" })], "Spanish");
    expect(r.ask[0].numbers_blocked).toBe(false);
  });
});

describe("Codex round 4: the widened sentence never borrows the next sentence's time", () => {
  const paper = "PREP SHEET (sample)\n- Take bisacodyl. stop iron 3 days before your procedure.\n- take your pill.Stop drinking 2 hours before your procedure.";
  const one = (quote: string) => {
    const r = buildPrepTimeline(paper, [item({ source_quote: quote, plain_language: "" })]);
    return [...r.timeline.flatMap((g) => g.steps), ...r.ask][0];
  };
  it("lowercase after the period", () => {
    expect(one("Take bisacodyl")).toMatchObject({ source_quote: "Take bisacodyl.", slot: null });
    expect(one("stop iron 3 days before")).toMatchObject({ source_quote: "stop iron 3 days before your procedure.", slot: "days_before" });
  });
  it("OCR text with no space after the period", () => {
    expect(one("take your pill")).toMatchObject({ source_quote: "take your pill.", slot: null });
    expect(one("Stop drinking 2 hours")).toMatchObject({ source_quote: "Stop drinking 2 hours before your procedure.", slot: "hours_before" });
  });
});

describe("Codex round 5: a unit abbreviation then a lowercase instruction is two sentences", () => {
  const steps = (paper: string, quotes: string[]) => {
    const r = buildPrepTimeline(paper, quotes.map((q) => item({ source_quote: q, plain_language: "" })));
    return [...r.timeline.flatMap((g) => g.steps), ...r.ask];
  };
  it.each([
    ["mg. stop", "Take 5 mg. stop aspirin 3 days before your procedure.", "Take 5 mg.", "stop aspirin 3 days before your procedure."],
    ["mg.stop (OCR)", "Take 5 mg.stop aspirin 3 days before your procedure.", "Take 5 mg.", "stop aspirin 3 days before your procedure."],
    ["a.m. take", "Eat breakfast by 7 a.m. take your pill 3 days before your procedure.", "Eat breakfast by 7 a.m.", "take your pill 3 days before your procedure."],
    ["ml. do not", "Drink 240 ml. do not eat 3 days before your procedure.", "Drink 240 ml.", "do not eat 3 days before your procedure."],
    ["etc. drink", "Bring snacks, drinks, etc. drink only water 2 hours before your procedure.", "Bring snacks, drinks, etc.", "drink only water 2 hours before your procedure."],
  ])("%s: the first step is its own sentence, unplaced; the second keeps its time", (_n, line, first, second) => {
    const paper = `PREP SHEET (sample)\n- ${line}`;
    const all = steps(paper, [first.replace(/\.$/, ""), second.replace(/\.$/, "")]);
    expect(all).toHaveLength(2);
    const a = all.find((s) => s.source_quote === first);
    const b = all.find((s) => s.source_quote === second);
    if (!a || !b) throw new Error(`steps were ${JSON.stringify(all.map((s) => s.source_quote))}`);
    expect(a.slot).toBeNull();
    expect(b.slot).not.toBeNull();
    expect(prepSpeechLines({ timeline: [], ask: [a] }).map((l) => l.text)).not.toContain(line);
  });

  it("an abbreviation followed by a word that could go either way is never placed", () => {
    const paper = "PREP SHEET (sample)\n- Take 5 mg. aspirin 3 days before your procedure.";
    const [s] = steps(paper, ["Take 5 mg"]);
    expect(s).toMatchObject({ slot: null, reason: "ambiguous_sentence" });
  });

  it("a.m. followed by \"the\" still reads as one sentence and is placed", () => {
    const [s] = steps("PREP SHEET (sample)\n- Arrive at 6:45 a.m. the morning of your procedure.", ["Arrive at 6:45"]);
    expect(s).toMatchObject({ source_quote: "Arrive at 6:45 a.m. the morning of your procedure.", slot: "arrival" });
  });
});

describe("Codex round 5: a fraction in the paper never lets a whole-number explanation through", () => {
  it.each([
    ["Take 1/2 tablet of your water pill 3 days before your procedure.", "Take 2 tablets of your water pill."],
    ["Take 1 1/2 tablets of your water pill 3 days before your procedure.", "Take 1 tablet of your water pill."],
    ["Take half a tablet of your water pill 3 days before your procedure.", "Take 1 tablet of your water pill."],
  ])("%j: explanation %j is blocked", (line, plain) => {
    const r = buildPrepTimeline(`PREP SHEET (sample)\n- ${line}`, [item({ source_quote: line, plain_language: plain })]);
    const [s] = [...r.timeline.flatMap((g) => g.steps), ...r.ask];
    expect(s).toMatchObject({ source_quote: line, numbers_blocked: true });
  });
});

describe("Codex round 6: a step never borrows the time of another part of its sentence", () => {
  const one = (line: string, quote: string) => {
    const r = buildPrepTimeline(`PREP SHEET (sample)\n- ${line}`, [item({ source_quote: quote, plain_language: "" })]);
    return [...r.timeline.flatMap((g) => g.steps), ...r.ask][0];
  };
  it.each([
    ["Take your pill; stop drinking 2 hours before your procedure.", "Take your pill"],
    ["Take your pill, and stop drinking 2 hours before your procedure.", "Take your pill"],
    ["Take your pill - stop drinking 2 hours before your procedure.", "Take your pill"],
    ["Stop drinking 2 hours before your procedure; take your pill.", "take your pill"],
    ["Take your pill, then refrain from drinking 3 days before your procedure.", "Take your pill"],
  ])("%j quoted as %j is not placed", (line, quote) => {
    expect(one(line, quote)).toMatchObject({ slot: null, reason: "other_clause" });
  });
  it.each([
    ["5 hours before your procedure, drink the second half of the bowel prep.", "drink the second half of the bowel prep", "hours_before"],
    ["Stop aspirin 3 days before your procedure, and call us with questions.", "Stop aspirin", "days_before"],
    ["Stop drinking 2 hours before your procedure.", "Stop drinking", "hours_before"],
  ])("%j quoted as %j is still placed", (line, quote, slot) => {
    expect(one(line, quote)).toMatchObject({ slot });
  });
  it("words that appear twice in the paper are never placed from the first one", () => {
    const paper = "PREP SHEET (sample)\n- Take your pill 3 days before your procedure.\n- Take your pill the morning of your procedure.";
    const r = buildPrepTimeline(paper, [item({ source_quote: "Take your pill", plain_language: "" })]);
    expect([...r.timeline.flatMap((g) => g.steps), ...r.ask][0]).toMatchObject({ slot: null, reason: "repeated" });
  });
});
