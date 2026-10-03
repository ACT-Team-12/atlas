/**
 * "Get ready for your procedure": the timeline is built by OUR code, never by the AI.
 *
 * A prep step is placed at a day or time only when the time words are inside that step's own verified quote from the
 * paper. If the quote has no time words, or only a clock time with no day ("at 3 PM"), or words for two different
 * moments, the step goes under "Ask your clinic when". The AI's own guess of the slot is never used to place a step.
 *
 * Pure functions, no network, no AI. Safe to import in the browser.
 */

import { firstSentenceEnd, hasAmbiguousEnd, LINE_BREAK as SENTENCE_LINE_BREAK } from "./sentences";

export const SLOTS = ["days_before", "day_before", "evening_before", "day_of", "hours_before", "morning_of", "arrival", "after"] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABEL: Record<Slot, string> = {
  days_before: "Days before",
  day_before: "The day before",
  evening_before: "The evening before",
  day_of: "The day of your procedure",
  hours_before: "In the hours before your procedure",
  morning_of: "The morning of",
  arrival: "When you arrive",
  after: "After your procedure",
};
export const ASK_LABEL = "Ask your clinic when";

export const PREP_KINDS = ["food_drink", "medicine", "bowel_prep", "bring", "arrival", "ride", "call", "other"] as const;
export type PrepKind = (typeof PREP_KINDS)[number];
export const PREP_KIND_LABEL: Record<PrepKind, string> = {
  food_drink: "Eating and drinking", medicine: "Medicine", bowel_prep: "Bowel prep", bring: "What to bring",
  arrival: "Arrival", ride: "Ride home", call: "When to call", other: "Other",
};

/** Why a step was or was not placed on the timeline. */
export type WhenReason = "placed" | "no_time_words" | "clock_without_day" | "conflict" | "multi_line" | "ambiguous_sentence" | "other_clause" | "repeated" | "multi_sentence";

export const WHEN_REASON_TEXT: Record<Exclude<WhenReason, "placed">, string> = {
  no_time_words: "Your paper doesn't say when for this one.",
  clock_without_day: "Your paper gives a time but not which day.",
  conflict: "This line names more than one time, so we didn't pick one.",
  multi_line: "This step's words run across more than one line of your paper, so we didn't place it.",
  ambiguous_sentence: "We couldn't tell where this sentence ends in your paper, so we didn't place it.",
  other_clause: "The time in this sentence may belong to another part of it, so we didn't place this step.",
  repeated: "These words appear more than once in your paper, so we didn't place this step.",
  multi_sentence: "This step runs across more than one sentence of your paper, so we didn't place it.",
};

export type WhenRead = {
  /** null means "Ask your clinic when". */
  slot: Slot | null;
  reason: WhenReason;
  /** The time words exactly as written in the quote, in the order they appear. */
  words: string[];
};

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, a: 1, an: 1,
};
const NUM = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|an?)`;
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[s.toLowerCase()] ?? NaN);
/**
 * What a relative time must be relative to. "2 hours before bedtime" or "a week before your trip" says nothing about
 * the procedure, so a relation only counts when it names the procedure, test, exam, appointment or arrival.
 */
const TARGET = String.raw`(?:your|the|this)\s+(?:scheduled\s+)?(?:procedure|test|exam|examination|appointment|arrival|surgery|operation|colonoscopy|endoscopy|scope|scan)\b`;
const BEFORE = String.raw`(?:before|prior\s+to)`;

/** A clock time: "8 PM", "7:30 a.m.", "noon". Midnight is read separately: alone it is a time with no day. */
const CLOCK = /(?<![\w:])(?:\d{1,2}(?::\d{2})?\s?(?:[ap]\.\s?m\.|[ap]\s?m)(?![a-z])|noon)/gi;
const MIDNIGHT = /\bmidnight\b/gi;
/**
 * An arrival is a step whose action is to arrive or check in: an instruction that starts a clause ("Arrive at 7:30 AM",
 * "Please check in 1 hour before your procedure", "On the day of your procedure, arrive at 7:00 AM"), or a stated
 * arrival time ("Your arrival time is 7:30 AM"). "Stop drinking 2 hours before your arrival" or "before you arrive" uses
 * the arrival only as the moment it counts back from, so those words are taken out (ARRIVAL_AS_TIME) first. A line
 * that only mentions arriving under a condition ("If you cannot arrive by 7:00 AM, call", "Call us if check-in at
 * 7:00 AM is impossible") is not the arrival step (ARRIVAL_CONDITION).
 */
const ARRIVE_INSTRUCTION = /(?:^|[,;:]\s*)(?:(?:please|you\s+(?:must|should|need\s+to|will\s+need\s+to|have\s+to)|plan\s+to|be\s+sure\s+to|make\s+sure\s+to)\s+)?(?:arrive|check[- ]?in)\b/i;
const ARRIVAL_STATED = /\b(?:arrival|check[- ]?in)\s+(?:time\s+)?(?:is|will\s+be)\b/i;
const ARRIVAL_CONDITION = /\b(?:if|unless|when|whenever|whether|in\s+case|cannot|can['’]?t|can\s+not|unable|impossible|late|miss|missed)\b/i;
const isArrival = (t: string) => {
  const s = t.replace(ARRIVAL_AS_TIME, " ");
  return !ARRIVAL_CONDITION.test(s) && (ARRIVE_INSTRUCTION.test(s.trim()) || ARRIVAL_STATED.test(s));
};
const ARRIVAL_AS_TIME = new RegExp(
  String.raw`\b(?:${BEFORE}|after|until|till|by)\s+(?:you\s+(?:arrive|check[- ]?in)|(?:your|the)\s+(?:arrival|check[- ]?in)(?:\s+time)?)\b`,
  "gi",
);

/**
 * Every character that ends a line. CR and LF are not the only ones: U+0085 (next line), U+2028 (line separator),
 * U+2029 (paragraph separator), vertical tab and form feed all start a new line when a paper is pasted or copied.
 */
export const LINE_BREAK = SENTENCE_LINE_BREAK;

type Hit = { slot: Slot; text: string; at: number };

/** Every day or time phrase in one stretch of text, each with the slot it names. */
function dayHits(t: string): Hit[] {
  const hits: Hit[] = [];
  const add = (re: RegExp, slotOf: (m: RegExpMatchArray) => Slot | null) => {
    for (const m of t.matchAll(re)) {
      const slot = slotOf(m);
      if (slot) hits.push({ slot, text: m[0], at: m.index ?? 0 });
    }
  };
  // "7 days before your procedure", "a week before your exam", "1 day before your test"
  add(new RegExp(String.raw`\b${NUM}\s+(days?|weeks?)\s+${BEFORE}\s+${TARGET}`, "gi"), (m) => {
    const n = toNum(m[1]);
    if (!Number.isFinite(n) || n < 1) return null;
    return /^week/i.test(m[2]) || n >= 2 ? "days_before" : "day_before";
  });
  // "the day before your procedure" (never part of "days before"; numbered forms are read above)
  add(new RegExp(String.raw`(?<!\b${NUM}\s+)\b(?:the\s+)?day\s+${BEFORE}\s+${TARGET}`, "gi"), () => "day_before");
  add(new RegExp(String.raw`\b(?:the\s+)?(?:night|evening)\s+${BEFORE}\s+${TARGET}`, "gi"), () => "evening_before");
  // "2 hours before your procedure", "30 minutes before your arrival", "1 hour before you arrive" (no day is said)
  add(new RegExp(String.raw`\b${NUM}\s+(?:hours?|hrs?|minutes?|mins?)\s+(?:${BEFORE}\s+${TARGET}|${BEFORE}\s+you\s+(?:arrive|check[- ]?in)\b)`, "gi"), () => "hours_before");
  add(new RegExp(String.raw`\b(?:the\s+)?morning\s+of\s+${TARGET}`, "gi"), () => "morning_of");
  // "On the day of your procedure" says the day, not the morning: a procedure can be in the afternoon.
  add(new RegExp(String.raw`\b(?:on\s+)?the\s+day\s+of\s+${TARGET}`, "gi"), () => "day_of");
  add(new RegExp(String.raw`\bafter\s+${TARGET}`, "gi"), () => "after");
  // Overlaps ("1 day before" also contains "day before"): keep the longer phrase.
  return hits
    .sort((a, b) => a.at - b.at || b.text.length - a.text.length)
    .filter((h, i, all) => !all.some((o, j) => j !== i && o.at <= h.at && o.at + o.text.length >= h.at + h.text.length && o.text.length > h.text.length));
}

/**
 * The part of a quote whose time words count: up to the end of its first sentence, and never past an ellipsis.
 * "Take your pill. Stop drinking 2 hours before your procedure." gives the pill no time: the 2 hours belongs to
 * the next sentence. An ellipsis can skip any text in between, so nothing after one counts either.
 */
export function firstClause(quote: string): string {
  const t = quote.replace(/\s+/g, " ").trim();
  const ellipsis = t.search(/\.\.\.|…/);
  const head = ellipsis >= 0 ? t.slice(0, ellipsis) : t;
  // The same sentence scanner the page uses to widen a quote to its sentence (sentences.ts).
  const end = firstSentenceEnd(head);
  return (end >= 0 ? head.slice(0, end) : head).trim();
}

/**
 * Reads when a step happens from the words of its own quote, and nothing else.
 * `multiLine` is true when the quote's place in the paper crosses a line break; such a step is never placed,
 * because a time on the next line belongs to the next line.
 */
export function readWhen(quote: string, multiLine = false): WhenRead {
  if (multiLine || LINE_BREAK.test(quote)) return { slot: null, reason: "multi_line", words: [] };
  const t = firstClause(quote);
  // "Take 5 mg. aspirin 3 days before": maybe one sentence, maybe two. Never place a step on a guess.
  if (hasAmbiguousEnd(t)) return { slot: null, reason: "ambiguous_sentence", words: [] };
  const days = dayHits(t);
  const clocks = [...t.matchAll(CLOCK)].map((m) => ({ text: m[0], at: m.index ?? 0 }));
  const midnight = [...t.matchAll(MIDNIGHT)].map((m) => ({ text: m[0], at: m.index ?? 0 }));
  const words = [...days, ...clocks, ...midnight].sort((a, b) => a.at - b.at).map((h) => h.text);

  let slots = new Set(days.map((h) => h.slot));
  // "Arrive at 7:00 AM", "Check in 1 hour before": an arrival with its own time. It happens on the day itself.
  // Only when arriving is the action: "Stop drinking 2 hours before your arrival" stays "in the hours before".
  const arrivalTimed = isArrival(t) && (clocks.length > 0 || slots.has("hours_before"));
  if (arrivalTimed) {
    const rest = [...slots].filter((s) => s !== "day_of" && s !== "morning_of" && s !== "hours_before");
    return rest.length ? { slot: null, reason: "conflict", words } : { slot: "arrival", reason: "placed", words };
  }
  // Midnight ends the evening before ("after midnight the night before your procedure"). Alone it names no day.
  if (midnight.length && slots.size > 0 && [...slots].every((s) => s === "day_before" || s === "evening_before")) {
    slots = new Set(["evening_before"]);
  } else if (midnight.length && slots.size > 0) {
    return { slot: null, reason: "conflict", words };
  }
  // A more exact phrase for the same moment wins ("the day before, at 5 PM the evening before").
  if (slots.has("evening_before") && slots.has("day_before")) slots.delete("day_before");
  if (slots.has("morning_of") && slots.has("hours_before")) slots.delete("hours_before");
  if (slots.has("day_of") && (slots.has("morning_of") || slots.has("hours_before"))) slots.delete("day_of");

  if (slots.size === 1) return { slot: [...slots][0], reason: "placed", words };
  if (slots.size > 1) return { slot: null, reason: "conflict", words };
  if (clocks.length || midnight.length) return { slot: null, reason: "clock_without_day", words };
  return { slot: null, reason: "no_time_words", words: [] };
}
