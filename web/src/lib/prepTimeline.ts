import { z } from "zod";
import { LANGUAGES } from "./schema";
import { findSpan } from "./verify";
import { unexpectedNumbersAnyForm } from "./meaning";
import { LINE_BREAK, PREP_KINDS, readWhen, SLOTS, SLOT_LABEL, type PrepKind, type Slot, type WhenReason } from "./prepTime";

/**
 * "Get ready for your procedure" (prep mode). Asked for by a Registered Nurse at a specialist practice on Oct 2:
 * her slowest task is calling patients to make sure they understand pre-procedure instructions and arrival times,
 * and some procedures get canceled on arrival because the prep was done wrong.
 *
 * The AI reads the prep paper and lists each instruction with a word-for-word quote. Our code then:
 * 1. checks every quote is in the paper (findSpan); anything it can't find is held back and counted, never shown;
 * 2. places each kept step on the timeline from the time words in its own quote (prepTime.ts), never from the AI;
 * 3. makes the paper's own quote the step's headline. The AI's plain-words explanation is never the headline. It is
 *    blocked here when it has a number (digits or English number words) the quote doesn't, and otherwise the page
 *    shows it only after the second-model meaning check (meaning.ts, /api/meaning) certifies it (prepView.ts).
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

/** The deterministic part of prep mode: verify, place, group. `source` is the paper the person pasted. */
export function buildPrepTimeline(source: string, items: PrepModelItem[]): Omit<PrepResponse, "model" | "ms"> {
  const kept: { step: PrepStep; at: number }[] = [];
  const heldKinds: PrepKind[] = [];
  let overridden = 0;
  items.slice(0, MAX_ITEMS).forEach((it, i) => {
    const quote = it.source_quote.trim();
    const span = quote ? findSpan(source, quote) : null;
    if (!span) { heldKinds.push(it.kind); return; }
    const multiLine = !withinOneLine(source, span);
    const when = readWhen(quote, multiLine);
    if ((it.ai_slot === "not_stated" ? null : it.ai_slot) !== when.slot) overridden++;
    const plain = clip(it.plain_language, 600);
    // A number in the AI's words (digits or "two", "twice") that the paper's line doesn't have blocks the explanation.
    const blocked = plain !== "" && unexpectedNumbersAnyForm({ plain_language: plain, source_quote: quote }).length > 0;
    kept.push({
      at: span.start,
      step: {
        id: `prep-${i}`, kind: it.kind, source_quote: quote, plain_language: blocked ? "" : plain, numbers_blocked: blocked,
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
    },
  };
}
