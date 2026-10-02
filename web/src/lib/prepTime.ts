/**
 * "Get ready for your procedure": the timeline is built by OUR code, never by the AI.
 *
 * A prep step is placed at a day or time only when the time words are inside that step's own verified quote from the
 * paper. If the quote has no time words, or only a clock time with no day ("at 3 PM"), or words for two different
 * moments, the step goes under "Ask your clinic when". The AI's own guess of the slot is never used to place a step.
 *
 * Pure functions, no network, no AI. Safe to import in the browser.
 */

export const SLOTS = ["days_before", "day_before", "evening_before", "hours_before", "morning_of", "arrival", "after"] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABEL: Record<Slot, string> = {
  days_before: "Days before",
  day_before: "The day before",
  evening_before: "The evening before",
  hours_before: "In the hours before your procedure",
  morning_of: "The morning of",
  arrival: "When you arrive",
  after: "After your procedure",
};
export const ASK_LABEL = "Ask your clinic when";

/** Why a step was or was not placed on the timeline. */
export type WhenReason = "placed" | "no_time_words" | "clock_without_day" | "conflict" | "multi_line";

export const WHEN_REASON_TEXT: Record<Exclude<WhenReason, "placed">, string> = {
  no_time_words: "Your paper doesn't say when for this one.",
  clock_without_day: "Your paper gives a time but not which day.",
  conflict: "This line names more than one time, so we didn't pick one.",
  multi_line: "This step's words run across more than one line of your paper, so we didn't place it.",
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
const PROCEDURE = String.raw`(?:procedure|test|exam|colonoscopy|endoscopy|surgery|scope)`;

/** A clock time: "8 PM", "7:30 a.m.", "noon". Midnight is read separately. */
const CLOCK = /(?<![\w:])(?:\d{1,2}(?::\d{2})?\s?(?:[ap]\.\s?m\.|[ap]\s?m)(?![a-z])|noon)/gi;
const MIDNIGHT = /\bmidnight\b/gi;
const ARRIVE = /\b(?:arrive|arrival|check[- ]?in|check in)\b/i;

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
  // "7 days before", "a week before", "1 day before"
  add(new RegExp(String.raw`\b${NUM}\s+(days?|weeks?)\s+(?:before|prior)\b`, "gi"), (m) => {
    const n = toNum(m[1]);
    if (!Number.isFinite(n) || n < 1) return null;
    return /^week/i.test(m[2]) || n >= 2 ? "days_before" : "day_before";
  });
  // "the day before" (never part of "days before"; numbered forms are read above)
  add(new RegExp(String.raw`(?<!\b${NUM}\s+)\b(?:the\s+)?day\s+(?:before|prior)\b`, "gi"), () => "day_before");
  add(/\b(?:the\s+)?(?:night|evening)\s+(?:before|prior)\b/gi, () => "evening_before");
  // "2 hours before your procedure", "30 minutes before" (no day is said, so it gets its own slot)
  add(new RegExp(String.raw`\b${NUM}\s+(?:hours?|hrs?|minutes?|mins?)\s+(?:before|prior)\b`, "gi"), () => "hours_before");
  add(/\b(?:the\s+)?morning\s+of\b/gi, () => "morning_of");
  add(new RegExp(String.raw`\b(?:on\s+)?the\s+day\s+of\s+(?:your|the)\s+${PROCEDURE}\b`, "gi"), () => "morning_of");
  add(new RegExp(String.raw`\bafter\s+(?:your|the)\s+${PROCEDURE}\b`, "gi"), () => "after");
  add(/\bwhen you (?:get|are) (?:back )?home\b/gi, () => "after");
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
  const end = head.search(/[.!?](?=\s+["'(]?[A-Z0-9])/);
  return (end >= 0 ? head.slice(0, end + 1) : head).trim();
}

/**
 * Reads when a step happens from the words of its own quote, and nothing else.
 * `multiLine` is true when the quote's place in the paper crosses a line break; such a step is never placed,
 * because a time on the next line belongs to the next line.
 */
export function readWhen(quote: string, multiLine = false): WhenRead {
  if (multiLine) return { slot: null, reason: "multi_line", words: [] };
  const t = firstClause(quote);
  const days = dayHits(t);
  const clocks = [...t.matchAll(CLOCK)].map((m) => ({ text: m[0], at: m.index ?? 0 }));
  const midnight = [...t.matchAll(MIDNIGHT)].map((m) => ({ text: m[0], at: m.index ?? 0 }));
  const words = [...days, ...clocks, ...midnight].sort((a, b) => a.at - b.at).map((h) => h.text);

  let slots = new Set(days.map((h) => h.slot));
  // "Arrive at 7:00 AM", "Check in 1 hour before": an arrival with its own time. It happens on the day itself.
  const arrivalTimed = ARRIVE.test(t) && (clocks.length > 0 || slots.has("hours_before"));
  if (arrivalTimed) {
    const rest = [...slots].filter((s) => s !== "morning_of" && s !== "hours_before");
    return rest.length ? { slot: null, reason: "conflict", words } : { slot: "arrival", reason: "placed", words };
  }
  // Midnight ends the evening before ("after midnight the night before", "at midnight the day before").
  if (midnight.length && (slots.size === 0 || [...slots].every((s) => s === "day_before" || s === "evening_before"))) {
    slots = new Set(["evening_before"]);
  } else if (midnight.length) {
    return { slot: null, reason: "conflict", words };
  }
  // A more exact phrase for the same moment wins ("the day before, at 5 PM the evening before").
  if (slots.has("evening_before") && slots.has("day_before")) slots.delete("day_before");
  if (slots.has("morning_of") && slots.has("hours_before")) slots.delete("hours_before");

  if (slots.size === 1) return { slot: [...slots][0], reason: "placed", words };
  if (slots.size > 1) return { slot: null, reason: "conflict", words };
  if (clocks.length) return { slot: null, reason: "clock_without_day", words };
  return { slot: null, reason: "no_time_words", words: [] };
}
