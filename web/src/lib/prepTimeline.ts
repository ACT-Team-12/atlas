import { INSTRUCTION_START, NEGATIVE_START } from "./sentences";
import { z } from "zod";
import { LANGUAGES } from "./schema";
import { negationBlocked } from "./prepCues";
import { crossesSentence, enclosingSentence, findSpan } from "./verify";
import { numberCheckAnyForm } from "./meaning";
import { LINE_BREAK, PREP_KINDS, readWhen, SLOTS, SLOT_LABEL, type PrepKind, type Slot, type WhenReason } from "./prepTime";

/**
 * "Get ready for your procedure" (prep mode). Asked for by a Registered Nurse at a specialist practice on Oct 2:
 * her slowest task is calling patients to make sure they understand pre-procedure instructions and arrival times,
 * and some procedures get canceled on arrival because the prep was done wrong.
 *
 * The AI reads the prep paper and lists each instruction with a word-for-word quote. Our code then:
 * 1. checks every quote is in the paper (findSpan); anything it can't find, or any quote with an ellipsis, is held back
 *    and counted, never shown. A kept step carries the whole sentence from the paper, not the model's copy or a piece;
 * 2. places each kept step on the timeline from the time words in its own quote (prepTime.ts), never from the AI;
 * 3. makes the paper's own quote the step's headline. The AI's plain-words explanation is never the headline. It is
 *    blocked here when it has a number (digits or English number words) the quote doesn't, or when the sentence or the
 *    explanation has a "do not", "stop" or "until" (prepCues.ts, a rule in code the second model can't overrule),
 *    and otherwise the page shows it only after the second-model meaning check (meaning.ts, /api/meaning) certifies
 *    it (prepView.ts).
 *
 * Nothing here calls the network, so it is unit tested and used by the planted-mistake test on /tests.
 */

export const PrepRequestSchema = z.object({
  text: z.string().min(20, "Paste your prep paper as text (at least a few lines).").max(20000, "That paper is too long. Paste only the prep instructions."),
  language: z.enum(LANGUAGES).default("English"),
});
export type PrepRequest = z.infer<typeof PrepRequestSchema>;

/** Prep timelines per UTC day across every server instance (db.takeDailySlot). Each one is one paid model call. */
export const PREP_DAILY_LIMIT = Math.max(1, Number(process.env.ATLAS_PREP_DAILY_LIMIT ?? 300) || 300);

/** What the AI returns for each instruction. `ai_slot` is its guess of when; our code records it and never uses it to place a step. */
export const PrepModelItem = z.object({
  kind: z.enum(PREP_KINDS),
  plain_language: z.string(),
  source_quote: z.string(),
  ai_slot: z.enum([...SLOTS, "not_stated"] as const),
});
export const PrepModelOutput = z.object({ items: z.array(PrepModelItem) });
export type PrepModelItem = z.infer<typeof PrepModelItem>;

export type PrepStep = {
  id: string;
  kind: PrepKind;
  /** The paper's own words: the step's headline. */
  source_quote: string;
  /**
   * The AI's plain-words explanation, NOT yet checked. Empty when blocked for numbers. The page must not show it
   * until the meaning check certifies it (see explainState in prepView.ts).
   */
  plain_language: string;
  /** True when the explanation had a number the quote doesn't, so it was dropped here and never sent on. */
  numbers_blocked: boolean;
  /**
   * True when the sentence or the explanation has a "do not" / "stop" / "until" word, or the explanation can't be
   * checked for one in its language (prepCues.ts), so it was dropped here and never sent on. A rule in code; the AI
   * can't overrule it.
   */
  negation_blocked: boolean;
  /** The time words from the quote that placed it, as written in the paper. */
  when_words: string[];
  slot: Slot | null;
  reason: WhenReason;
};
export type PrepGroup = { slot: Slot; label: string; steps: PrepStep[] };
export type PrepResponse = {
  timeline: PrepGroup[];
  ask: PrepStep[];
  held_back: { count: number; kinds: PrepKind[] };
  stats: {
    extracted: number; verified: number; held_back: number; placed: number; ask: number;
    /** Kept steps where the AI's guess of when differs from what the quote says. Our code used the quote. */
    ai_slot_overridden: number;
    /** Explanations dropped here because of a number the quote doesn't have. */
    numbers_blocked: number;
    /** Explanations dropped here because the sentence or the explanation has a "do not" / "stop" / "until" word. */
    negation_blocked: number;
  };
  model: string;
  ms: number;
};

const MAX_ITEMS = 40;

/**
 * True when the matched span sits inside one line of the paper. A line ends at CR, LF, U+0085, U+2028, U+2029,
 * vertical tab or form feed (LINE_BREAK), so a time on the next line can never place this step.
 */
export function withinOneLine(source: string, span: { start: number; end: number }): boolean {
  if (span.start < 0 || span.end > source.length || span.end < span.start) return false;
  let lineEnd = source.length;
  for (let i = span.start; i < source.length; i++) {
    if (LINE_BREAK.test(source[i])) { lineEnd = i; break; }
  }
  return span.end <= lineEnd;
}
const clip = (s: string, n: number) => s.trim().slice(0, n);

/** A break between two parts of one sentence: a semicolon, colon, comma, dash or bullet, or a joining word. */
const CLAUSE_BREAK = /[;:,•]|\s[-–—]\s|(?<![\p{L}\p{M}])(?:and|then|or|but|also|y|o|luego|et|ou|puis|và|rồi|hoặc)(?![\p{L}\p{M}])/iu;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** Words a time phrase is made of ("3 days before your procedure", "the morning of your exam"). */
const TIME_PHRASE_WORD = new Set([
  "a", "an", "the", "your", "my", "of", "on", "at", "in", "by", "before", "after", "prior", "to", "until", "from",
  "starting", "beginning", "day", "days", "night", "nights", "morning", "evening", "afternoon", "week", "weeks",
  "hour", "hours", "minute", "minutes", "hr", "hrs", "min", "mins", "am", "pm", "a.m", "p.m", "noon", "midnight",
  "procedure", "exam", "test", "appointment", "surgery", "colonoscopy", "endoscopy", "scan", "visit", "arrival",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fourteen",
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "seventy-two", "forty-eight", "twenty-four",
]);

/**
 * True when a time phrase in the sentence is cut off from the model's matched words by a clause break and is not a
 * bare time phrase: "Take your pill; stop drinking 2 hours before your procedure." with the model quoting "Take your
 * pill" (Codex round 6). That time belongs to another instruction, so the step is not placed. A fronted time phrase
 * ("5 hours before your procedure, drink the second half") is only time words and still places. A time word we
 * can't find again counts as cut off (fail closed).
 */
export function timeOutsideClause(quote: string, matched: { start: number; end: number }, words: string[]): boolean {
  const breakRe = new RegExp(CLAUSE_BREAK.source, "giu");
  for (const w of words) {
    const m = new RegExp(escapeRe(w.trim()), "i").exec(quote);
    if (!m) return true;
    const ws = m.index, we = m.index + m[0].length;
    if (ws < matched.end && matched.start < we) continue;
    const after = ws >= matched.end;
    const gap = after ? quote.slice(matched.end, ws) : quote.slice(we, matched.start);
    if (!CLAUSE_BREAK.test(gap)) continue;
    // The part of the sentence that holds the time phrase, on the far side of the break.
    let region: string;
    if (after) {
      breakRe.lastIndex = we;
      const next = breakRe.exec(quote);
      region = quote.slice(matched.end, next ? next.index : quote.length);
    } else {
      let lastEnd = 0;
      for (const b of quote.slice(0, ws).matchAll(breakRe)) lastEnd = b.index + b[0].length;
      region = quote.slice(lastEnd, matched.start);
    }
    const others = [...region.toLowerCase().matchAll(/[\p{L}\p{M}'’.-]+/gu)]
      .map((x) => x[0].replace(/^[.'’-]+|[.'’-]+$/g, ""))
      .filter((x) => x !== "" && !TIME_PHRASE_WORD.has(x) && !CLAUSE_BREAK.test(x));
    if (others.length > 0) return true;
  }
  return false;
}

/** Any way of writing an ellipsis: "...", "..", ". . .", "…" (U+2026), "⋯" (U+22EF), "᠁" (U+1801), "︙" (U+FE19). */
export const ELLIPSIS = /\.\s*\.|[\u2026\u22EF\u1801\uFE19]/;

/**
 * True when the sentence holds two instructions and its time sits in only one of them: "Take your pill; stop drinking
 * 2 hours before your procedure." even when the model quotes the whole sentence (Codex round 7). Parts are split at a
 * semicolon, bullet or spaced dash, at a comma (with or without "and", "then", "or", "but") before an instruction
 * word ("..., and call us"), and at a bare "and", "then" or "but" before one ("Take your medicine and stop drinking
 * 2 hours before", Codex round 9). A bare "or" is left alone: "Do not eat or drink" is one instruction. Then we can't tell which action the time is for, so the step is not placed.
 */
export function timeForOneOfTwoActions(quote: string, words: string[]): boolean {
  const verbs = [...INSTRUCTION_START].map((v) => escapeRe(v)).join("|");
  const negVerbs = [...NEGATIVE_START].map((v) => escapeRe(v)).join("|");
  const splitter = new RegExp(String.raw`[;•]|\s[-–—]\s|,\s*(?:(?:and\s+then|and|then|or|but|y|et|và)\s+)?(?=(?:${verbs})(?![\p{L}\p{M}]))|\s(?:and\s+then|and|then|but|y|luego|et|puis|và|rồi)\s+(?=(?:${verbs})(?![\p{L}\p{M}]))|\s(?:or|o|ou|hoặc)\s+(?=(?:${negVerbs})(?![\p{L}\p{M}]))`, "giu");
  const cuts: { start: number; end: number }[] = [];
  let last = 0;
  for (const m of quote.matchAll(splitter)) { cuts.push({ start: last, end: m.index }); last = m.index + m[0].length; }
  cuts.push({ start: last, end: quote.length });
  const parts = cuts.filter((c) => /[\p{L}\p{M}]/u.test(quote.slice(c.start, c.end)));
  if (parts.length < 2) return false;
  // A time word we can't find again: fail closed.
  if (words.some((w) => !new RegExp(escapeRe(w.trim()), "i").test(quote))) return true;
  // A part with any word that isn't a time word is an action ("stop drinking 2 hours before"); a part of only time
  // words ("5 hours before your procedure,") just says when.
  // A leading condition ("If you take insulin, do not take it ...") belongs to the action after it.
  const CONDITION = /^\s*(?:if|when|unless|while|since|because|si|cuando|mientras|quand|lorsque|nếu|khi)(?![\p{L}\p{M}])/iu;
  const isAction = (c: { start: number; end: number }) => !CONDITION.test(quote.slice(c.start, c.end)) &&
    [...quote.slice(c.start, c.end).toLowerCase().matchAll(/[\p{L}\p{M}'’.-]+/gu)]
      .map((x) => x[0].replace(/^[.'’-]+|[.'’-]+$/g, ""))
      .some((x) => x !== "" && !TIME_PHRASE_WORD.has(x) && !CLAUSE_BREAK.test(x));
  // Two actions and one time: whether the time sits inside one action or stands beside both, we can't tell which
  // action it is for.
  return parts.filter(isAction).length >= 2;
}

/** The deterministic part of prep mode: verify, place, group. `source` is the paper the person pasted. */
export function buildPrepTimeline(source: string, items: PrepModelItem[], language: PrepRequest["language"] = "English"): Omit<PrepResponse, "model" | "ms"> {
  const kept: { step: PrepStep; at: number }[] = [];
  const heldKinds: PrepKind[] = [];
  let overridden = 0;
  items.slice(0, MAX_ITEMS).forEach((it, i) => {
    const asked = it.source_quote.trim();
    // An ellipsis lets a quote skip words ("If you take insulin ... take it the morning of", with "do not" dropped),
    // and findSpan accepts the pieces in order. In prep mode such a quote is held back like one not in the paper.
    const found = asked && !ELLIPSIS.test(asked) ? findSpan(source, asked) : null;
    if (!found) { heldKinds.push(it.kind); return; }
    // From here on the quote is the paper's own text: the WHOLE sentence the model's words sit in, never the model's
    // copy and never a fragment of it ("take it the morning of your procedure" would drop "do not"). It is what the
    // page shows and speaks, and what the time words, the number check and the cue rule read.
    const span = enclosingSentence(source, found);
    const quote = source.slice(span.start, span.end);
    const multiLine = !withinOneLine(source, span);
    const read = readWhen(quote, multiLine);
    // The model's words appear more than once in the paper: we can't tell which line it meant (Codex round 6).
    const repeated = findSpan(source.slice(found.end), asked) !== null;
    // More than one sentence: readWhen reads only the first, whose time may not be the step's (Codex round 8).
    const multiSentence = crossesSentence(source, { start: span.start, end: Math.max(span.start, span.end - 1) });
    const otherClause = read.slot !== null && (timeForOneOfTwoActions(quote, read.words) || timeOutsideClause(quote, { start: found.start - span.start, end: found.end - span.start }, read.words));
    const when = read.slot === null ? read
      : repeated ? { slot: null, reason: "repeated" as const, words: read.words }
      : multiSentence ? { slot: null, reason: "multi_sentence" as const, words: read.words }
      : otherClause ? { slot: null, reason: "other_clause" as const, words: read.words }
      : read;
    if ((it.ai_slot === "not_stated" ? null : it.ai_slot) !== when.slot) overridden++;
    const plain = clip(it.plain_language, 600);
    // A number in the AI's words (digits or "two", "twice") that the paper's line doesn't have blocks the explanation.
    const nums = numberCheckAnyForm({ plain_language: plain, source_quote: quote }, language);
    const blocked = plain !== "" && (nums.unexpected.length > 0 || nums.uncheckable);
    // A "do not", "stop" or "until" in the paper's sentence or in the explanation blocks it (prepCues.ts).
    const negBlocked = !blocked && plain !== "" && negationBlocked(quote, plain, language);
    kept.push({
      at: span.start,
      step: {
        id: `prep-${i}`, kind: it.kind, source_quote: quote, plain_language: blocked || negBlocked ? "" : plain,
        numbers_blocked: blocked, negation_blocked: negBlocked,
        when_words: when.words, slot: when.slot, reason: when.reason,
      },
    });
  });
  // Paper order inside each group.
  const steps = kept.sort((a, b) => a.at - b.at).map((k) => k.step);
  const timeline: PrepGroup[] = SLOTS.map((slot) => ({ slot, label: SLOT_LABEL[slot], steps: steps.filter((s) => s.slot === slot) }))
    .filter((g) => g.steps.length > 0);
  const ask = steps.filter((s) => s.slot === null);
  return {
    timeline,
    ask,
    held_back: { count: heldKinds.length, kinds: heldKinds },
    stats: {
      extracted: Math.min(items.length, MAX_ITEMS), verified: steps.length, held_back: heldKinds.length,
      placed: steps.length - ask.length, ask: ask.length, ai_slot_overridden: overridden,
      numbers_blocked: steps.filter((s) => s.numbers_blocked).length,
      negation_blocked: steps.filter((s) => s.negation_blocked).length,
    },
  };
}
