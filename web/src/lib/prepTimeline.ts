import { z } from "zod";
import { LANGUAGES } from "./schema";
import { findSpanIn, mapSource } from "./verify";
import { unexpectedNumbers } from "./meaning";
import { PREP_KINDS, PREP_KIND_LABEL, readWhen, SLOTS, SLOT_LABEL, type PrepKind, type Slot, type WhenReason } from "./prepTime";

/**
 * "Get ready for your procedure" (prep mode). Asked for by a Registered Nurse at a specialist practice on Oct 2:
 * her slowest task is calling patients to make sure they understand pre-procedure instructions and arrival times,
 * and some procedures get canceled on arrival because the prep was done wrong.
 *
 * The AI reads the prep paper and lists each instruction with a word-for-word quote. Our code then:
 * 1. checks every quote is in the paper (findSpan); anything it can't find is held back and counted, never shown;
 * 2. places each kept step on the timeline from the time words in its own quote (prepTime.ts), never from the AI;
 * 3. hides the AI's explanation when it has a number the quote doesn't (the paper's words are still shown).
 *
 * Nothing here calls the network, so it is unit tested and used by the planted-mistake test on /tests.
 */

export const PrepRequestSchema = z.object({
  text: z.string().min(20, "Paste your prep paper as text (at least a few lines).").max(20000, "That paper is too long. Paste only the prep instructions."),
  language: z.enum(LANGUAGES).default("English"),
});
export type PrepRequest = z.infer<typeof PrepRequestSchema>;

/** What the AI returns for each instruction. `ai_slot` is its guess of when; our code records it and never uses it to place a step. */
export const PrepModelItem = z.object({
  kind: z.enum(PREP_KINDS),
  title: z.string(),
  plain_language: z.string(),
  source_quote: z.string(),
  ai_slot: z.enum([...SLOTS, "not_stated"]),
});
export const PrepModelOutput = z.object({ items: z.array(PrepModelItem) });
export type PrepModelItem = z.infer<typeof PrepModelItem>;

export type PrepStep = {
  id: string;
  kind: PrepKind;
  title: string;
  /** Empty when the explanation was hidden (it had a number the quote doesn't). */
  plain_language: string;
  explanation_hidden: boolean;
  source_quote: string;
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
    explanations_hidden: number;
  };
  model: string;
  ms: number;
};

const MAX_ITEMS = 40;
const clip = (s: string, n: number) => s.trim().slice(0, n);

/** The deterministic part of prep mode: verify, place, group. `source` is the paper the person pasted. */
export function buildPrepTimeline(source: string, items: PrepModelItem[]): Omit<PrepResponse, "model" | "ms"> {
  const kept: { step: PrepStep; at: number }[] = [];
  const heldKinds: PrepKind[] = [];
  let overridden = 0;
  const paper = mapSource(source);
  items.slice(0, MAX_ITEMS).forEach((it, i) => {
    const quote = it.source_quote.trim();
    const span = quote ? findSpanIn(paper, quote) : null;
    if (!span) { heldKinds.push(it.kind); return; }
    const multiLine = /[\r\n]/.test(source.slice(span.start, span.end));
    const when = readWhen(quote, multiLine);
    if ((it.ai_slot === "not_stated" ? null : it.ai_slot) !== when.slot) overridden++;
    const title = clip(it.title, 160);
    const plain = clip(it.plain_language, 600);
    // A number in the AI's words that the paper's line doesn't have (a changed time, dose or count) hides the explanation.
    const hide = unexpectedNumbers({ plain_language: `${title} ${plain}`, source_quote: quote }).length > 0;
    kept.push({
      at: span.start,
      step: {
        id: `prep-${i}`, kind: it.kind, title: hide ? PREP_KIND_LABEL[it.kind] : title, plain_language: hide ? "" : plain,
        explanation_hidden: hide, source_quote: quote, when_words: when.words, slot: when.slot, reason: when.reason,
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
      explanations_hidden: steps.filter((s) => s.explanation_hidden).length,
    },
  };
}
