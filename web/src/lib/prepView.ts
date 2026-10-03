import type { MeaningResult } from "./meaning";
import { cuesForbid } from "./prepCues";
import type { PrepResponse, PrepStep } from "./prepTimeline";

/**
 * What the page may show for a prep step's plain-words explanation. Fails closed: the paper's own quote is always
 * the headline, and the AI's explanation is shown only when the existing second-model meaning check (meaning.ts,
 * POST /api/meaning, the same one the care plan uses) certified it, AND neither the quote nor the explanation has a
 * "do not" / "stop" / "until" word (prepCues.ts). Checking, flagged, unclear, a check that failed, a number the
 * quote doesn't have, or a cue word dropped or added: the explanation stays hidden and the page says why.
 *
 * Client-safe: type imports only.
 */

export type MeaningState = { status: "idle" | "loading" | "done" | "error"; byId: Record<string, MeaningResult> };
export const NO_MEANING: MeaningState = { status: "idle", byId: {} };

export type ExplainState = "certified" | "checking" | "flagged" | "unclear" | "numbers" | "negation" | "check_failed" | "none";

export const EXPLAIN_NOTE: Record<Exclude<ExplainState, "certified" | "none">, string> = {
  checking: "Checking the plain-words explanation against your paper. Until then, read your paper's words above.",
  numbers: "Plain-words explanation hidden: it had a number your paper doesn't say. Read your paper's words above.",
  negation: "No plain-words explanation for this one: it has a \"do not\", \"stop\" or \"until\", so read your paper's own words above.",
  flagged: "Plain-words explanation hidden: a second check found it may not match your paper. Read your paper's words above.",
  unclear: "Plain-words explanation hidden: a second check couldn't confirm it matches your paper. Read your paper's words above.",
  check_failed: "Plain-words explanation hidden: the double-check isn't available right now. Read your paper's words above.",
};

export function explainState(step: PrepStep, m: MeaningState): ExplainState {
  if (step.numbers_blocked) return "numbers";
  if (step.negation_blocked) return "negation";
  if (!step.plain_language) return "none";
  // Checked again here, whatever the server sent: no "same" from the meaning check can show an explanation of a
  // sentence with a "do not" / "stop" / "until", or one that adds such a word.
  if (cuesForbid(step.source_quote, step.plain_language)) return "negation";
  if (m.status === "idle" || m.status === "loading") return "checking";
  if (m.status === "error") return "check_failed";
  const r = m.byId[step.id];
  if (!r) return "unclear"; // not sent or not returned: never counts as checked
  if (r.certified) return "certified";
  return r.flagged ? "flagged" : "unclear";
}

/** The explanation text the page may show, or null. The only way an AI explanation reaches the screen. */
export function shownExplanation(step: PrepStep, m: MeaningState): string | null {
  return explainState(step, m) === "certified" ? step.plain_language : null;
}

export const allSteps = (res: Pick<PrepResponse, "timeline" | "ask">): PrepStep[] => [...res.timeline.flatMap((g) => g.steps), ...res.ask];

/** The items sent to /api/meaning: every step with an explanation, within that route's limits (40 items, 800 chars). */
export function meaningItems(res: Pick<PrepResponse, "timeline" | "ask">) {
  return allSteps(res)
    .filter((s) => s.plain_language && s.source_quote.length <= 800)
    .slice(0, 40)
    .map((s) => ({ id: s.id, plain_language: s.plain_language, when: s.when_words.join(", ").slice(0, 200), source_quote: s.source_quote }));
}
