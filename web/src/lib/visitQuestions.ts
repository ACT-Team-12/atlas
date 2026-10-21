import type { Check } from "./paperFirst";
import { askPerson } from "./askPerson";

/**
 * "Questions for the next visit": the one list every surface shows, copies, prints and shares.
 *
 * Paper first (paperFirst.ts): a step's own clinic question is AI-written, so it leaves the screen only when the second
 * check certified that step. Any other step gets the fixed question built from the paper's own words (askPerson.ts),
 * the same one its "Ask your clinic" / "Ask your pharmacist" box shows. A warning sign gets none: its own words say
 * what to do now.
 *
 * `general` is the reading's questions_for_doctor. Older readings (and the model itself) also put each step's question
 * in that list, so any general question equal to a step's question is dropped here: otherwise an uncertified step's
 * AI question would leak through the general list, and a certified one would be listed twice. `also` names steps that
 * are not listed (removed ones) whose questions must still be kept out of the general list.
 *
 * Ported to mobile/ios/ATLAS/Support/PaperFirst.swift (visitQuestions) and mobile/android/.../data/PaperFirst.kt.
 */
/** The same key as dedupe() in extract.ts: case and punctuation insensitive. */
const dedupeKey = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Optional fields: a step saved by an older version, or a test stub, may lack them (it then has no question).
type Step = { id: string; kind: string; source_quote: string; needs_clarification?: boolean; question_for_clinic?: string };

/** One step's question for the next visit, or null when it has none. */
export function stepVisitQuestion(it: Step, check: Check): string | null {
  const own = (it.question_for_clinic ?? "").trim();
  if (!it.needs_clarification || !own) return null;
  if (check === "certified") return own;
  return askPerson({ kind: it.kind, source_quote: it.source_quote ?? "" }, check)?.question ?? null;
}

/** The general questions with every step's own question taken out (those travel with their step, paper first). */
export function generalVisitQuestions(general: string[], steps: Step[]): string[] {
  const own = new Set(steps.map((i) => dedupeKey(i.question_for_clinic ?? "")).filter(Boolean));
  return general.filter((q) => dedupeKey(q) && !own.has(dedupeKey(q)));
}

/**
 * A reading's general questions with every step's own question taken out, held-back (refused) steps included: a
 * saved reading's model list can repeat any of them, and a held-back step is never checked (Codex review).
 */
export function readingGeneralQuestions(care: { questions_for_doctor?: string[]; items: Step[]; refused?: Step[] }): string[] {
  return generalVisitQuestions(care.questions_for_doctor ?? [], [...care.items, ...(care.refused ?? [])]);
}

/** Step questions with repeats (same key) dropped, keeping the first step's paper line. */
export function uniqueStepQuestions<T extends Step>(items: T[], checkFor: (id: string) => Check): { it: T; q: string }[] {
  const seen = new Set<string>();
  return items.flatMap((it) => {
    const q = stepVisitQuestion(it, checkFor(it.id));
    if (!q || seen.has(dedupeKey(q))) return [];
    seen.add(dedupeKey(q));
    return [{ it, q }];
  });
}

export function visitQuestions(input: { items: Step[]; general: string[]; checkFor: (id: string) => Check; also?: Step[] }): string[] {
  return visitQuestionsTagged(input).map((q) => q.text);
}

/**
 * The same list, each marked `english` when it is a fixed question from askPerson.ts (written in English for the
 * pharmacist or front desk), so a screen in another language can mark it lang="en" (Codex review of PR 93).
 */
export function visitQuestionsTagged(input: { items: Step[]; general: string[]; checkFor: (id: string) => Check; also?: Step[] }): { text: string; english: boolean }[] {
  const out: { text: string; english: boolean }[] = [];
  const seen = new Set<string>();
  const add = (q: string, english: boolean) => {
    const k = dedupeKey(q);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ text: q.trim(), english });
  };
  for (const it of input.items) {
    const check = input.checkFor(it.id);
    const q = stepVisitQuestion(it, check);
    if (q) add(q, check !== "certified");
  }
  for (const q of generalVisitQuestions(input.general, [...input.items, ...(input.also ?? [])])) add(q, false);
  return out;
}
