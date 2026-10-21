/**
 * Generates mobile/shared/walk-vectors.json: the website's own answer for "Walk me through it" (web/src/lib/walkThrough.ts),
 * so the iPhone and Android apps are checked against the same cases as the web.
 *
 * - "lines": every fixed line on the walk-through screen, per app language (WALK_LINES). The phones must hold the same text.
 * - "filled": walkLine with its numbers filled in, for every language and every line that takes a number, plus an
 *   unknown language (English is used).
 * - "order": walkSteps, the order the list shows and numbers the steps (warning signs first, then each time group).
 * - "pip": walkPip, Pip on the step shown, from the list's own spot (pipSpot), with the step's check and whether it is
 *   a warning sign.
 * - "next_open": nextOpen, the first step at or after a position that is not done, wrapping around (-1 when all done).
 *
 * Not part of the web suite. CI regenerates it with mobile/shared/check-vectors.sh (web-ci) and fails when the
 * committed file differs. To regenerate by hand:
 *   cp mobile/shared/genWalkVectors.test.ts web/src/lib/
 *   cd web && VECTORS_OUT=../mobile/shared/walk-vectors.json pnpm exec vitest run src/lib/genWalkVectors.test.ts
 *   rm src/lib/genWalkVectors.test.ts
 */
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { pipSpot } from "./pip";
import { WHEN_GROUPS, type WhenGroup } from "./stepsView";
import { nextOpen, WALK_LINES, walkLine, walkPip, walkSteps, type WalkLine } from "./walkThrough";

type Check = "certified" | "flagged" | "unchecked";

const KINDS = ["medication", "lab_test", "warning_sign", "self_care", "referral", "follow_up_visit", "other"];
const CHECKS: Check[] = ["certified", "flagged", "unchecked"];

/** mulberry32: a small seeded generator, so the file is the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it("writes the walk-through vectors", () => {
  const r = rng(20261004);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const languages = Object.keys(WALK_LINES);
  const lineKeys = Object.keys(WALK_LINES.English) as WalkLine[];

  const filled: { language: string; line: WalkLine; values: Record<string, number>; text: string }[] = [];
  for (const language of [...languages, "Klingon"]) {
    for (const [line, values] of [
      ["progress", { n: 3, total: 12 }],
      ["progress", { n: 1, total: 1 }],
      ["finishedCount", { done: 0, total: 4 }],
      ["finishedCount", { done: 7, total: 9 }],
      ["open", {}],
      ["back", {}],
    ] as [WalkLine, Record<string, number>][]) {
      filled.push({ language, line, values, text: walkLine(language, line, values) });
    }
  }
  // A placeholder with no value stays as written (walkLine leaves an unknown {name} alone).
  filled.push({ language: "English", line: "progress", values: { n: 2 }, text: walkLine("English", "progress", { n: 2 }) });

  // walkSteps: warning signs first, then every time group in WHEN_GROUPS order, paper order inside each.
  const order: { items: { id: string; warning: boolean; group: WhenGroup }[]; ids: string[]; groups: string[] }[] = [];
  for (let k = 0; k < 120; k++) {
    const n = Math.floor(r() * 9);
    const items = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, warning: r() < 0.2, group: pick(WHEN_GROUPS) }));
    const out = walkSteps(items, (it) => it.warning, (it) => it.group);
    order.push({ items, ids: out.map((s) => s.it.id), groups: out.map((s) => s.group) });
  }

  // walkPip: the list's own spot from random steps, then every step shown in turn, as a warning sign or not.
  const pip: unknown[] = [];
  for (let k = 0; k < 400; k++) {
    const n = 1 + Math.floor(r() * 5);
    const steps = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: pick(KINDS) }));
    const done: Record<string, boolean> = {};
    const checks: Record<string, Check> = {};
    for (const s of steps) {
      if (r() < 0.4) done[s.id] = true;
      checks[s.id] = pick(CHECKS);
    }
    const cheering = r() < 0.3 ? pick(steps).id : null;
    const greet = r() < 0.5;
    const spot = pipSpot(steps, done, (id) => checks[id] ?? "unchecked", cheering, greet);
    const shown = pick(steps);
    const warning = r() < 0.25;
    pip.push({ spot, shown, check: checks[shown.id], warning, expected: walkPip(spot, shown, checks[shown.id], warning) });
  }

  const nextOpenCases: { ids: string[]; done: string[]; from: number; expected: number }[] = [];
  for (let k = 0; k < 120; k++) {
    const n = Math.floor(r() * 7);
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    const done = ids.filter(() => r() < 0.5);
    const doneMap = Object.fromEntries(done.map((id) => [id, true]));
    const from = n === 0 ? 0 : Math.floor(r() * n);
    nextOpenCases.push({ ids, done, from, expected: nextOpen(ids.map((id) => ({ it: { id } })), doneMap, from) });
  }

  const vectors = { lines: WALK_LINES, line_keys: lineKeys, filled, order, pip, next_open: nextOpenCases };
  expect(order.length).toBeGreaterThan(100);
  expect(pip.length).toBeGreaterThan(300);
  const out = process.env.VECTORS_OUT;
  if (out) writeFileSync(out, JSON.stringify(vectors, null, 1) + "\n");
});
