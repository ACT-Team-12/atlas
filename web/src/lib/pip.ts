/**
 * Pip, the "you are here" marker on a plan (Akhil's design: a Georgia peach shaped like a map pin). Pure rules, no AI.
 *
 * His rules, kept in code here so the components cannot drift from them:
 *
 * - Pip sits in a reserved spot on the right edge of the card for the step that matters now, and never covers text.
 * - The step that matters now is the first step not yet done, in the order the groups are shown (earliest group first).
 * - Pip is quiet around medicine, warning signs and lab tests: no animation, no bubble, no cheer on those cards.
 *   A step a check disagreed with is quiet too, so a cheer or a bubble never reads as an endorsement of it.
 * - What Pip says is a short FIXED line from the table below, never AI text, and never a medical suggestion.
 */

import type { LANGUAGES } from "./schema";
import type { Check } from "./paperFirst";

type Lang = (typeof LANGUAGES)[number];

export type PipLine = "start" | "done" | "next" | "allDone";

/**
 * Every line Pip can say, per app language. Only position and progress, never what to do about your health.
 *
 * Translations: written by the team, not by a model at runtime. The non-English lines (Spanish, Vietnamese, Korean,
 * Chinese, Amharic, French) still need a native speaker's review before launch; Amharic most of all.
 */
export const PIP_LINES: Record<Lang, Record<PipLine, string>> = {
  English: { start: "Start here", done: "Nice, that's done", next: "Next up", allDone: "All done for now" },
  // NATIVE REVIEW NEEDED (Spanish).
  Spanish: { start: "Empiece aquí", done: "Bien, ya está hecho", next: "Lo siguiente", allDone: "Todo listo por ahora" },
  // NATIVE REVIEW NEEDED (Vietnamese).
  Vietnamese: { start: "Bắt đầu ở đây", done: "Tốt lắm, đã xong", next: "Tiếp theo", allDone: "Tạm thời đã xong hết" },
  // NATIVE REVIEW NEEDED (Korean).
  Korean: { start: "여기서 시작하세요", done: "잘했어요, 끝났어요", next: "다음 차례", allDone: "지금은 모두 끝났어요" },
  // NATIVE REVIEW NEEDED (Chinese, Simplified).
  Chinese: { start: "从这里开始", done: "很好，完成了", next: "下一步", allDone: "目前都完成了" },
  // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
  Amharic: { start: "ከዚህ ይጀምሩ", done: "ጥሩ፣ ተጠናቋል", next: "ቀጣዩ", allDone: "ለአሁን ሁሉም ተጠናቋል" },
  // NATIVE REVIEW NEEDED (French).
  French: { start: "Commencez ici", done: "Bien, c'est fait", next: "Ensuite", allDone: "Tout est fait pour l'instant" },
};

/** Pip's line in the person's language; any language not in the table falls back to English. */
export function pipLine(language: string, line: PipLine): string {
  return (PIP_LINES as Record<string, Record<PipLine, string>>)[language]?.[line] ?? PIP_LINES.English[line];
}

/** Kinds of step Pip stays quiet on: medicine, lab tests and warning signs. */
export const QUIET_KINDS: ReadonlySet<string> = new Set(["medication", "lab_test", "warning_sign"]);

/** True when Pip must be quiet on this step: no animation, no bubble, no cheer. */
export function pipQuiet(kind: string, check: Check): boolean {
  return QUIET_KINDS.has(kind) || check === "flagged";
}

/**
 * The step that matters now: the first step not done, scanning groups in the order shown. `ordered` is the steps in
 * display order (earliest group first). Returns null when every step is done or there are none.
 */
export function currentStepId(ordered: readonly { id: string }[], done: Readonly<Record<string, boolean>>): string | null {
  return ordered.find((s) => !done[s.id])?.id ?? null;
}

/** Where Pip is and what it says, for the steps view. */
export type PipSpot =
  | { at: "step"; id: string; mood: "arrive" | "cheer" | "quiet"; line: PipLine | null }
  | { at: "header"; mood: "arrive"; line: "allDone" }
  /**
   * First view when the current step is a quiet card: Pip greets once at the "Your steps" heading with the fixed
   * "start" line, pointing down at the list. Pip is one character, so the card itself (`id`) shows no Pip meanwhile:
   * its slot stays reserved and empty. When the greeting ends, Pip moves to his normal spot on the current step.
   */
  | { at: "greet"; id: string; mood: "arrive"; line: "start" }
  | { at: "none" };

/**
 * Decides Pip's spot. `cheering` is a step the person just marked done (and that may be cheered); while it is set and
 * still done, Pip cheers there, then moves on. Quiet steps never get a cheer and never get a line.
 *
 * `greet`: whether the heading greeting is still allowed (the screen turns it off for good once any step is marked
 * done). It shows only before anything is done and only when the current step is quiet; otherwise a first-time
 * person would never hear Pip at all on a paper that starts with a medicine, lab or flagged step.
 */
export function pipSpot(
  ordered: readonly { id: string; kind: string }[],
  done: Readonly<Record<string, boolean>>,
  checkFor: (id: string) => Check,
  cheering: string | null,
  greet = true,
): PipSpot {
  if (ordered.length === 0) return { at: "none" };
  const cheer = cheering ? ordered.find((s) => s.id === cheering) : undefined;
  if (cheer && done[cheer.id] && !pipQuiet(cheer.kind, checkFor(cheer.id))) return { at: "step", id: cheer.id, mood: "cheer", line: "done" };
  const id = currentStepId(ordered, done);
  if (!id) return { at: "header", mood: "arrive", line: "allDone" };
  const step = ordered.find((s) => s.id === id)!;
  const anyDone = ordered.some((s) => done[s.id]);
  if (pipQuiet(step.kind, checkFor(id))) {
    return greet && !anyDone ? { at: "greet", id, mood: "arrive", line: "start" } : { at: "step", id, mood: "quiet", line: null };
  }
  return { at: "step", id, mood: "arrive", line: anyDone ? "next" : "start" };
}
