import type { PlanResponse } from "./plan";
import { planStepQuotes } from "./planQuotes";

type Linked = { id: string; source_quote: string; grounded?: boolean };

/**
 * What "Read it out loud" says for a plan. One line each; the server signs exactly this text (speakToken.ts).
 * A plan step is the AI's suggestion and is never certified, so a step tied to steps from the paper is followed by
 * the paper's own words for them (paperFirst.ts).
 */
export function speechLines(plan: Pick<PlanResponse, "summary" | "steps">, items: Linked[] = []): string[] {
  return [
    plan.summary,
    ...plan.steps.flatMap((s, i) => [`${i + 1}. ${s.title}. ${s.action}`, ...planStepQuotes(s, items).map((q) => `Your paper says: "${q}"`)]),
  ];
}

export const speechText = (plan: Pick<PlanResponse, "summary" | "steps">, items: Linked[] = []) => speechLines(plan, items).join("\n");
