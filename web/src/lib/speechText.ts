import type { PlanResponse } from "./plan";

/** What "Read it out loud" says for a plan. One line each; the server signs exactly this text (speakToken.ts). */
export function speechLines(plan: Pick<PlanResponse, "summary" | "steps">): string[] {
  return [plan.summary, ...plan.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.action}`)];
}

export const speechText = (plan: Pick<PlanResponse, "summary" | "steps">) => speechLines(plan).join("\n");
