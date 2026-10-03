import { ASK_LABEL, WHEN_REASON_TEXT } from "./prepTime";
import type { PrepResponse, PrepStep } from "./prepTimeline";
import { explainState, NO_MEANING, type ExplainState, type MeaningState } from "./prepView";

/**
 * What "Read it out loud" says, with the phone's own voice (no paid voice).
 *
 * For every step it reads the paper's exact quote and the time words that placed it (or why it wasn't placed). The
 * AI's plain-words explanation is read only when the meaning check certified it; otherwise the voice says it was
 * left out and why. Each line says which voice to use: "paper" for the paper's own words, "ours" for our English
 * labels and notes, "explanation" for a certified explanation in the language the person chose.
 */
export type SpeechLine = { text: string; voice: "paper" | "ours" | "explanation" };

const SPOKEN_NOTE: Record<Exclude<ExplainState, "certified" | "none">, string> = {
  checking: "The plain-words explanation is still being checked, so it is left out.",
  numbers: "The plain-words explanation is left out because it had a number your paper doesn't say.",
  negation: "There is no plain-words explanation for this one, because it has a do-not, stop or until. Your paper's words were read above.",
  flagged: "The plain-words explanation is left out because a second check found it may not match your paper.",
  unclear: "The plain-words explanation is left out because a second check couldn't confirm it.",
  check_failed: "The plain-words explanation is left out because the double-check isn't available right now.",
};

function stepLines(s: PrepStep, n: number, meaning: MeaningState): SpeechLine[] {
  const out: SpeechLine[] = [
    { text: `Step ${n}. Your paper says:`, voice: "ours" },
    { text: s.source_quote, voice: "paper" },
  ];
  if (s.slot && s.when_words.length) {
    out.push({ text: "When, in your paper's words:", voice: "ours" }, { text: s.when_words.join(", "), voice: "paper" });
  } else if (s.reason !== "placed") {
    out.push({ text: WHEN_REASON_TEXT[s.reason], voice: "ours" });
    if (s.when_words.length) out.push({ text: "It says:", voice: "ours" }, { text: s.when_words.join(", "), voice: "paper" });
  }
  const state = explainState(s, meaning);
  if (state === "certified") out.push({ text: "In plain words, double-checked against your paper:", voice: "ours" }, { text: s.plain_language, voice: "explanation" });
  else if (state !== "none") out.push({ text: SPOKEN_NOTE[state], voice: "ours" });
  return out;
}

export function prepSpeechLines(res: Pick<PrepResponse, "timeline" | "ask">, meaning: MeaningState = NO_MEANING): SpeechLine[] {
  const lines: SpeechLine[] = [];
  let n = 0;
  for (const g of res.timeline) {
    lines.push({ text: `${g.label}.`, voice: "ours" });
    for (const s of g.steps) lines.push(...stepLines(s, ++n, meaning));
  }
  if (res.ask.length) {
    lines.push({ text: `${ASK_LABEL}. Your paper does not say a day and time for these.`, voice: "ours" });
    for (const s of res.ask) lines.push(...stepLines(s, ++n, meaning));
  }
  return lines;
}
