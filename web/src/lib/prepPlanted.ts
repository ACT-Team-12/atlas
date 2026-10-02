import { SAMPLE_PREP } from "./samplePrep";
import { buildPrepTimeline, type PrepModelItem } from "./prepTimeline";
import { SLOTS, SLOT_LABEL, type PrepKind, type Slot } from "./prepTime";
import { shownExplanation, type MeaningState } from "./prepView";
import type { MeaningResult } from "./meaning";

/**
 * Planted-mistake test for prep mode (no AI involved, recomputed on every load of /tests).
 *
 * For the sample prep paper (written by Team ATLAS, not a real patient) we wrote by hand the answer a correct AI
 * would give: each instruction, its exact line, and the slot a person reading that line would put it in (or "ask"
 * when the line itself doesn't say when). Then we plant the mistakes a wrong AI could make: claiming a wrong time,
 * changing or adding time words in the quote, inventing a step, borrowing the time from the next line, cutting the
 * time words off the quote, changing a number (digits or words) in the explanation, and reversing what the explanation
 * says ("do not take insulin" explained as "take insulin"). Our code must catch each one.
 *
 * What this does NOT test: whether the second model (the meaning check) notices a reversal. That needs the AI. It
 * tests our gate: an explanation is never shown unless that check certified it, and the headline is the paper's words.
 */

export type PrepTruth = { kind: PrepKind; quote: string; plain: string; truth: Slot | "ask" };

export const PREP_TRUTH: PrepTruth[] = [
  { kind: "medicine", quote: "Stop taking iron pills and fish oil 7 days before your procedure.", plain: "Stop iron pills and fish oil 7 days before.", truth: "days_before" },
  { kind: "medicine", quote: "If you take a blood thinner, call the doctor who prescribes it 7 days before your procedure to ask if you should stop it.", plain: "If you take a blood thinner, call that doctor 7 days before.", truth: "days_before" },
  { kind: "food_drink", quote: "Starting 3 days before your procedure, do not eat nuts, seeds, popcorn, or raw vegetables.", plain: "From 3 days before, no nuts, seeds, popcorn or raw vegetables.", truth: "days_before" },
  { kind: "food_drink", quote: "The day before your procedure, drink only clear liquids all day: water, clear broth, apple juice, and plain gelatin.", plain: "The whole day before, only clear liquids.", truth: "day_before" },
  { kind: "bowel_prep", quote: "Take 2 bisacodyl tablets at 3 PM.", plain: "Take 2 bisacodyl tablets at 3 PM.", truth: "ask" },
  { kind: "bowel_prep", quote: "At 5 PM the evening before your procedure, drink the first half of the bowel prep (8 ounces every 15 minutes until it is gone).", plain: "At 5 PM the evening before, drink the first half of the prep, 8 ounces every 15 minutes.", truth: "evening_before" },
  { kind: "food_drink", quote: "Do not eat or drink anything after midnight the night before your procedure, except the second half of the prep.", plain: "After midnight, nothing to eat or drink except the rest of the prep.", truth: "evening_before" },
  { kind: "bowel_prep", quote: "5 hours before your procedure, drink the second half of the bowel prep.", plain: "5 hours before, drink the second half of the prep.", truth: "hours_before" },
  { kind: "food_drink", quote: "Stop drinking all liquids 2 hours before your procedure.", plain: "Nothing to drink in the last 2 hours.", truth: "hours_before" },
  { kind: "medicine", quote: "The morning of your procedure, take your blood pressure pill with a small sip of water.", plain: "That morning, take your blood pressure pill with a sip of water.", truth: "morning_of" },
  { kind: "medicine", quote: "If you take insulin, do not take it the morning of your procedure unless your doctor told you to.", plain: "Do not take insulin that morning unless your doctor said to.", truth: "morning_of" },
  { kind: "arrival", quote: "Arrive at 7:00 AM at Midtown Endoscopy Center, 2nd floor, 100 Sample Street.", plain: "Get there at 7:00 AM, 2nd floor.", truth: "arrival" },
  { kind: "bring", quote: "Bring your photo ID, insurance card, and a list of all your medicines.", plain: "Bring your ID, insurance card and your medicine list.", truth: "ask" },
  { kind: "ride", quote: "An adult must drive you home after your procedure.", plain: "An adult has to drive you home.", truth: "after" },
  { kind: "other", quote: "Do not drive, work, or sign legal papers for the rest of the day after your procedure.", plain: "For the rest of that day, do not drive, work or sign legal papers.", truth: "after" },
  { kind: "call", quote: "Call 404-555-0199 if you cannot finish the prep, or if you have bad stomach pain or vomiting.", plain: "Call 404-555-0199 if you can't finish the prep or have bad pain or vomiting.", truth: "ask" },
];

const asModel = (t: PrepTruth, over: Partial<PrepModelItem> = {}): PrepModelItem => ({
  kind: t.kind, plain_language: t.plain, source_quote: t.quote, ai_slot: t.truth === "ask" ? "not_stated" : t.truth, ...over,
});

/** Swaps the first time phrase for a different one, so the quote no longer matches the paper. */
const TIME_SWAPS: [RegExp, string][] = [
  [/7 days before/, "3 days before"], [/3 days before/, "7 days before"], [/The day before/, "The morning of"],
  [/3 PM/, "9 PM"], [/5 PM/, "8 PM"], [/midnight/, "6 AM"], [/5 hours before/, "8 hours before"],
  [/2 hours before/, "4 hours before"], [/The morning of/, "The evening before"], [/the morning of/, "the night before"],
  [/7:00 AM/, "9:00 AM"], [/after your procedure/, "before your procedure"],
];

export const PREP_PLANT_KINDS = [
  "wrong time claimed", "untimed step given a time", "time words changed in the quote", "time words added to the quote",
  "invented step", "time borrowed from the next line", "time words cut off the quote", "number changed in the explanation",
  "number word changed in the explanation", "meaning reversed in the explanation",
] as const;

/** Explanations that say the opposite of their line. Digits match, so only the meaning check could catch these. */
const REVERSALS: [string, string][] = [
  ["do not take it the morning of", "Take your insulin that morning."],
  ["Do not eat or drink anything after midnight", "After midnight, you can eat and drink."],
  ["do not eat nuts", "From 3 days before, eat nuts, seeds, popcorn and raw vegetables."],
  ["Do not drive, work", "For the rest of that day, you can drive and work."],
  ["Stop drinking all liquids", "Keep drinking liquids in the last 2 hours."],
  ["An adult must drive you home", "You can drive yourself home."],
];
const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Every state of the meaning check except "certified". In each one the explanation must stay hidden. */
function uncertifiedStates(id: string): MeaningState[] {
  const r = (over: Partial<MeaningResult>): MeaningResult => ({ id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "unclear", what_differs: "", certified: false, ...over });
  return [
    { status: "idle", byId: {} },
    { status: "loading", byId: {} },
    { status: "error", byId: {} },
    { status: "done", byId: {} },
    { status: "done", byId: { [id]: r({ model_verdict: "different", flagged: true, what_differs: "reversed" }) } },
    { status: "done", byId: { [id]: r({}) } },
  ];
}
const certifiedState = (id: string): MeaningState => ({ status: "done", byId: { [id]: { id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same", what_differs: "", certified: true } } });
type PlantKind = (typeof PREP_PLANT_KINDS)[number];

/** "held back": the step must not be shown. "not placed": shown, but under Ask your clinic when (or held back). "placed right": in its true slot. "explanation hidden". */
type Expect = "held back" | "not placed" | "placed right" | "explanation hidden" | "shown only if certified";
type Plant = { kind: PlantKind; expect: Expect; item: PrepModelItem; truth: Slot | "ask"; what: string };

export function prepPlants(paper = SAMPLE_PREP, truth = PREP_TRUTH): Plant[] {
  const out: Plant[] = [];
  const lines = paper.split("\n").map((l) => l.replace(/^- /, "").trim());
  truth.forEach((t) => {
    const p = (kind: PlantKind, expect: Expect, over: Partial<PrepModelItem>, what: string) => out.push({ kind, expect, item: asModel(t, over), truth: t.truth, what });
    const short = t.quote.slice(0, 48) + (t.quote.length > 48 ? "..." : "");

    // The AI claims a different time than the line says. Our code must still place it from the line.
    if (t.truth !== "ask") {
      const wrong = SLOTS.find((s) => s !== t.truth)!;
      p("wrong time claimed", "placed right", { ai_slot: wrong }, `"${short}" claimed for "${SLOT_LABEL[wrong].toLowerCase()}"`);
    } else {
      p("untimed step given a time", "not placed", { ai_slot: "morning_of" }, `"${short}" claimed for the morning of`);
    }

    const swap = TIME_SWAPS.find(([re]) => re.test(t.quote));
    if (swap) p("time words changed in the quote", "held back", { source_quote: t.quote.replace(swap[0], swap[1]) }, `"${swap[0].source}" changed to "${swap[1]}"`);

    if (t.truth === "ask") {
      p("time words added to the quote", "held back", { source_quote: `${t.quote.replace(/\.$/, "")} the morning of your procedure.`, ai_slot: "morning_of" }, `"the morning of your procedure" added to "${short}"`);
    }

    // A quote that runs into the next line, whose time words would otherwise place this step.
    const i = lines.findIndex((l) => l.includes(t.quote));
    const next = lines.slice(i + 1).find((l) => l.length > 0);
    const at = paper.indexOf(t.quote);
    if (i >= 0 && next && at >= 0) {
      const end = paper.indexOf(next, at) + next.length;
      p("time borrowed from the next line", "not placed", { source_quote: paper.slice(at, end) }, `"${short}" quoted together with the next line`);
    }

    // The quote stops before the time words. The step is real, but it can no longer be placed.
    const firstTime = t.quote.search(/\d|midnight|morning|evening|night|day|after your/i);
    if (t.truth !== "ask" && firstTime > 12) {
      p("time words cut off the quote", "not placed", { source_quote: t.quote.slice(0, firstTime).trim() }, `quote cut to "${t.quote.slice(0, firstTime).trim()}"`);
    }

    // The quote is right, but the AI's explanation says a different number than the line.
    const num = t.plain.match(/\d+/);
    if (num) p("number changed in the explanation", "explanation hidden", { plain_language: t.plain.replace(num[0], String(Number(num[0]) + 4)) }, `${num[0]} changed to ${Number(num[0]) + 4} in the explanation`);

    // The same, written as a word ("one" in place of 7). Words are read too.
    const quoteNums = new Set(t.quote.match(/\d+/g) ?? []);
    const word = WORDS.find((_w, k) => !quoteNums.has(String(k + 1)));
    if (num && word) p("number word changed in the explanation", "explanation hidden", { plain_language: t.plain.replace(num[0], word) }, `${num[0]} changed to "${word}" in the explanation`);

    // The explanation says the opposite of the line. Its numbers still match, so our number check can't see it.
    const rev = REVERSALS.find(([q]) => t.quote.includes(q));
    if (rev) p("meaning reversed in the explanation", "shown only if certified", { plain_language: rev[1] }, `"${short}" explained as "${rev[1]}"`);
  });
  for (const [quote, slot] of [
    ["Take 2 aspirin the morning of your procedure.", "morning_of"],
    ["Stop all of your medicines 3 days before your procedure.", "days_before"],
    ["Arrive at 5:30 AM at the main hospital entrance.", "arrival"],
  ] as const) {
    out.push({ kind: "invented step", expect: "held back", truth: slot, what: `"${quote}" is not in the paper`, item: { kind: "medicine", plain_language: quote, source_quote: quote, ai_slot: slot } });
  }
  return out;
}

export type PrepPlantedReport = {
  real: { total: number; right: number; wrong: { quote: string; truth: string; got: string }[] };
  planted: {
    total: number; caught: number;
    byKind: Record<string, { total: number; caught: number }>;
    slipped: { kind: string; what: string; got: string }[];
    examples: Record<string, string>;
  };
};

export function runPrepPlantedTest(paper = SAMPLE_PREP, truth = PREP_TRUTH): PrepPlantedReport {
  const rep: PrepPlantedReport = { real: { total: 0, right: 0, wrong: [] }, planted: { total: 0, caught: 0, byKind: {}, slipped: [], examples: {} } };

  // The correct answer, all at once: every step kept, in its true slot, its explanation shown once certified.
  const real = buildPrepTimeline(paper, truth.map((t) => asModel(t)));
  const all = [...real.timeline.flatMap((g) => g.steps), ...real.ask];
  truth.forEach((t) => {
    rep.real.total++;
    const s = all.find((x) => x.source_quote === t.quote);
    const got = !s ? "held back" : shownExplanation(s, certifiedState(s.id)) !== t.plain ? "explanation not shown when certified" : (s.slot ?? "ask");
    if (got === t.truth) rep.real.right++;
    else rep.real.wrong.push({ quote: t.quote, truth: t.truth, got });
  });

  // Each planted mistake on its own.
  for (const pl of prepPlants(paper, truth)) {
    const res = buildPrepTimeline(paper, [pl.item]);
    const s = res.timeline[0]?.steps[0] ?? res.ask[0];
    const neverShownUncertified = !!s && uncertifiedStates(s.id).every((m) => shownExplanation(s, m) === null);
    const got = !s ? "held back" : s.numbers_blocked ? `explanation blocked, ${s.slot ?? "ask"}` : neverShownUncertified ? (s.slot ?? "ask") : "explanation shown without certification";
    const ok =
      pl.expect === "held back" ? !s :
      pl.expect === "not placed" ? !s || s.slot === null :
      pl.expect === "placed right" ? !!s && s.slot === pl.truth :
      pl.expect === "explanation hidden" ? !!s && s.numbers_blocked && s.plain_language === "" && shownExplanation(s, certifiedState(s.id)) === null :
      // The headline is the paper's own words, and the explanation never shows until certified.
      !!s && s.source_quote === pl.item.source_quote.trim() && neverShownUncertified;
    const k = (rep.planted.byKind[pl.kind] ??= { total: 0, caught: 0 });
    rep.planted.total++; k.total++;
    rep.planted.examples[pl.kind] ??= pl.what;
    if (ok) { rep.planted.caught++; k.caught++; }
    else rep.planted.slipped.push({ kind: pl.kind, what: pl.what, got });
  }
  return rep;
}
