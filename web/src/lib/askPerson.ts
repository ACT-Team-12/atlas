import type { Check } from "./paperFirst";

/**
 * "Ask your pharmacist" / "Ask your clinic": human help for a step whose explanation was not double-checked, instead
 * of telling the person to go read their paper.
 *
 * The question is built ONLY from the paper's own words for the step (its verified quote) and fixed wording here.
 * Never from the AI's title, "when" or explanation: an unconfirmed explanation must not reach a pharmacist dressed up
 * as the person's own question. No AI call. Ported line for line to mobile/ios/ATLAS/Support/PaperFirst.swift
 * (askPerson) and mobile/android/.../data/PaperFirst.kt (askPerson).
 *
 * - Certified steps get nothing new (their card is unchanged).
 * - A warning sign gets nothing either: its own words say what to do (call your clinic or 911), and a question to ask
 *   later must never compete with that.
 * - A medicine step (start, change, stop, a dose) asks the pharmacist; every other step asks the clinic.
 */
export type AskPerson = { who: "pharmacist" | "clinic"; label: string; question: string };

export const ASK_LABEL = { pharmacist: "Ask your pharmacist", clinic: "Ask your clinic" } as const;

export function askPerson(it: { kind: string; source_quote: string }, check: Check): AskPerson | null {
  const quote = it.source_quote.replace(/\s+/g, " ").trim();
  if (check === "certified" || !quote || it.kind === "warning_sign") return null;
  if (it.kind === "medication") {
    return { who: "pharmacist", label: ASK_LABEL.pharmacist, question: `My paper says: "${quote}" Can you confirm what I should take?` };
  }
  return { who: "clinic", label: ASK_LABEL.clinic, question: `My paper says: "${quote}" Can you help me understand what I should do?` };
}
