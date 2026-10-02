import { ASK_LABEL } from "./prepTime";
import type { PrepResponse, PrepStep } from "./prepTimeline";

/**
 * What "Read it out loud" says, with the phone's own voice. In English each group starts with its label. In other
 * languages the labels are left out (they are our English words) and the steps are read in timeline order.
 */
export function prepSpeechLines(res: Pick<PrepResponse, "timeline" | "ask">, language: string): string[] {
  const english = language === "English";
  const say = (s: PrepStep) => [s.title, s.plain_language].filter(Boolean).join(". ");
  const lines: string[] = [];
  let n = 0;
  for (const g of res.timeline) {
    if (english) lines.push(`${g.label}.`);
    for (const s of g.steps) lines.push(`${++n}. ${say(s)}`);
  }
  if (res.ask.length) {
    if (english) lines.push(`${ASK_LABEL}. Your paper does not say a day and time for these.`);
    for (const s of res.ask) lines.push(`${++n}. ${say(s)}`);
  }
  return lines;
}
