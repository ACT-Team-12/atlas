import type { MeaningResult } from "./meaning";
import { cuesForbid } from "./prepCues";
import { paperFirstView } from "./paperFirst";
import type { PrepGroup, PrepResponse, PrepStep } from "./prepTimeline";
import type { Slot } from "./prepTime";
import { shortQuote } from "./stepsView";

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
  numbers: "Plain-words explanation hidden: it had a number your paper doesn't say, or one our code couldn't read. Read your paper's words above.",
  negation: "No plain-words explanation for this one: it has a \"do not\", \"stop\" or \"until\" (or is in a language our code can't check for one), so read your paper's own words above.",
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
  // The shared paper-first rule (paperFirst.ts); prep is stricter still and hides, rather than demotes, the rest.
  const v = paperFirstView({ quote: step.source_quote, explanation: [step.plain_language], check: explainState(step, m) === "certified" ? "certified" : "unchecked" });
  return v.lead === "explanation" ? v.explanation : null;
}

/**
 * A step that must never be folded away: its paper sentence has a "do not" / "stop" word or an "only" / "until" /
 * "unless" limit (prepCues.ts, the same lists that hide explanations: "Stop drinking", "Do not eat", "drink only clear
 * liquids", "fasting"), it can't be read for those words (Ethiopic script), it says to call, contact or tell someone or
 * prints a phone number, or it names 911, the emergency room or going for care ("seek medical attention", "go to the
 * hospital", Codex review round 3). All read from the paper's own sentence by our code; the
 * AI's "call" kind can add a step but is never needed (Codex review). Its row stays visible and whole.
 */
export function prepMustSee(s: Pick<PrepStep, "kind" | "source_quote">): boolean {
  // cuesForbid with no explanation: a "no" or "limit" cue word in the sentence, or a sentence it can't read.
  return s.kind === "call" || cuesForbid(s.source_quote, "") || CALL_WORDS.test(s.source_quote) || PHONE.test(s.source_quote);
}

/** Words that tell the person to reach someone, or name an emergency (English, Spanish, French, Vietnamese). */
const CALL_WORDS = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${[
  "call", "calls", "calling", "phone", "contact", "notify", "tell", "let\\s+us\\s+know", "let\\s+your\\s+\\p{L}+\\s+know", "text", "page", "911", "emergency", "er",
  "llame", "llamar", "llámenos", "llamenos", "comuníquese", "comuniquese", "contacte", "avise", "avísenos", "emergencia", "urgencias",
  "appelez", "appeler", "contactez", "prévenez", "urgence", "urgences",
  "gọi", "liên\\s+lạc", "báo", "cấp\\s+cứu",
  // Going for care, whatever kind the model gave the step ("seek immediate medical attention", "go to the hospital").
  "seek", "hospital", "ambulance", "urgent", "urgently", "immediate", "immediately", "right\\s+away", "medical\\s+(?:attention|care|help)",
  "inmediatamente", "atención\\s+médica", "atencion\\s+medica", "hôpital", "immédiatement", "bệnh\\s+viện", "ngay\\s+lập\\s+tức",
].join("|")})(?![\p{L}\p{N}])`, "iu");
/** A phone number: at least 7 digits with the usual separators ("404-555-0199", "(404) 555 0199", "555.0199" is too short). */
const PHONE = /(?:\+?\d[\s().-]*){7,}/;

/**
 * What a closed prep row shows: the paper's own sentence (shortened at a word boundary, or whole for a must-see step)
 * and the time words from it. Never the AI's explanation, certified or not: prep keeps it inside the opened row.
 */
export function prepClosedRow(s: PrepStep): { quote: string; full: boolean; whenWords: string[] } {
  const full = prepMustSee(s);
  return { quote: full ? s.source_quote.replace(/\s+/g, " ").trim() : shortQuote(s.source_quote), full, whenWords: s.when_words };
}

/**
 * The group open when the timeline first shows: the next one ahead. The paper gives no date, so that is the earliest
 * group (days before, then the day before, ...). Every other group starts closed, its must-see steps still showing.
 */
export function defaultOpenSlot(timeline: Pick<PrepGroup, "slot">[]): Slot | null {
  return timeline[0]?.slot ?? null;
}

/** What Copy puts on the clipboard for "Ask your clinic when": each step as the paper's own sentence. */
export function prepAskText(ask: Pick<PrepStep, "source_quote">[]): string {
  return ask.map((s, i) => `${i + 1}. When should I do this? Your paper says: "${s.source_quote.replace(/\s+/g, " ").trim()}"`).join("\n");
}

export const allSteps =(res: Pick<PrepResponse, "timeline" | "ask">): PrepStep[] => [...res.timeline.flatMap((g) => g.steps), ...res.ask];

/** The items sent to /api/meaning: every step with an explanation, within that route's limits (40 items, 800 chars). */
export function meaningItems(res: Pick<PrepResponse, "timeline" | "ask">) {
  return allSteps(res)
    .filter((s) => s.plain_language && s.source_quote.length <= 800)
    .slice(0, 40)
    .map((s) => ({ id: s.id, plain_language: s.plain_language, when: s.when_words.join(", ").slice(0, 200), source_quote: s.source_quote }));
}
