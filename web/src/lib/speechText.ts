import type { PlanResponse } from "./plan";
import { planStepQuotes } from "./planQuotes";

type Linked = { id: string; source_quote: string; grounded?: boolean };
/** The plan fields read aloud. The needs-a-person fields are optional so older callers (and saved plans) still type. */
type Spoken = Pick<PlanResponse, "summary" | "steps"> & Partial<Pick<PlanResponse, "ask_a_person" | "ask_a_person_reason">>;

/**
 * The text the paid natural voice may read: ONLY what /api/plan itself produced (summary and steps). /api/plan signs
 * exactly this (speakToken.ts). It never includes anything the caller sent, such as care-step quotes, so a caller
 * can't get a natural-voice token for text of their choosing.
 */
export const paidSpeechText = (plan: Spoken) => planLines(plan).join("\n");

/** Said first, every time: the plan is the AI's suggestion, and the paper wins. */
export const PLAN_IS_A_SUGGESTION = "This plan is a suggestion from ATLAS, not your paper. If anything differs, follow your paper.";

/**
 * The plan's own "this needs a person" line, worded as share and print word it (shareText.ts), or nothing. Only when
 * the plan says so AND gave a reason: a flag with no reason, or a reason without the flag, adds nothing here (the
 * screen still shows the flag). It is /api/plan's own output, so it is part of the signed text and the call reads it.
 */
export function needsPersonLine(plan: Partial<Pick<PlanResponse, "ask_a_person" | "ask_a_person_reason">>): string[] {
  const reason = typeof plan.ask_a_person_reason === "string" ? plan.ask_a_person_reason.trim() : "";
  return plan.ask_a_person === true && reason ? [`This needs a person too: ${reason} Call 211 or a community health worker.`] : [];
}

const planLines = (plan: Spoken) => [PLAN_IS_A_SUGGESTION, plan.summary, ...plan.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.action}`), ...needsPersonLine(plan)];

/**
 * What "Read it out loud" says for a plan, one line each. A plan step is the AI's suggestion and is never certified,
 * so a step tied to steps from the paper is followed by the paper's own words for them (paperFirst.ts). When that
 * adds anything to the paid text, the page reads it with the device's own voice (free), never the paid one.
 */
export function speechLines(plan: Spoken, items: Linked[] = []): string[] {
  return [
    PLAN_IS_A_SUGGESTION,
    plan.summary,
    ...plan.steps.flatMap((s, i) => [`${i + 1}. ${s.title}. ${s.action}`, ...planStepQuotes(s, items).map((q) => `Your paper says: "${q}"`)]),
    ...needsPersonLine(plan),
  ];
}

/** True when the natural (paid) voice may read these lines: they are exactly the plan's own signed text. */
export const paidVoiceAllowed = (plan: Spoken, lines: string[]) => lines.join("\n") === paidSpeechText(plan);
