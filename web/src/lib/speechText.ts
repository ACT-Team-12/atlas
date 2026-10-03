import type { PlanResponse } from "./plan";
import { planStepQuotes } from "./planQuotes";

type Linked = { id: string; source_quote: string; grounded?: boolean };

/**
 * The text the paid natural voice may read: ONLY what /api/plan itself produced (summary and steps). /api/plan signs
 * exactly this (speakToken.ts). It never includes anything the caller sent, such as care-step quotes, so a caller
 * can't get a natural-voice token for text of their choosing.
 */
export const paidSpeechText = (plan: Pick<PlanResponse, "summary" | "steps">) => planLines(plan).join("\n");

/** Said first, every time: the plan is the AI's suggestion, and the paper wins. */
export const PLAN_IS_A_SUGGESTION = "This plan is a suggestion from ATLAS, not your paper. If anything differs, follow your paper.";

const planLines = (plan: Pick<PlanResponse, "summary" | "steps">) => [PLAN_IS_A_SUGGESTION, plan.summary, ...plan.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.action}`)];

/**
 * What "Read it out loud" says for a plan, one line each. A plan step is the AI's suggestion and is never certified,
 * so a step tied to steps from the paper is followed by the paper's own words for them (paperFirst.ts). When that
 * adds anything to the paid text, the page reads it with the device's own voice (free), never the paid one.
 */
export function speechLines(plan: Pick<PlanResponse, "summary" | "steps">, items: Linked[] = []): string[] {
  return [
    PLAN_IS_A_SUGGESTION,
    plan.summary,
    ...plan.steps.flatMap((s, i) => [`${i + 1}. ${s.title}. ${s.action}`, ...planStepQuotes(s, items).map((q) => `Your paper says: "${q}"`)]),
  ];
}

/** True when the natural (paid) voice may read these lines: they are exactly the plan's own signed text. */
export const paidVoiceAllowed = (plan: Pick<PlanResponse, "summary" | "steps">, lines: string[]) => lines.join("\n") === paidSpeechText(plan);
