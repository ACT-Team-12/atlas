/**
 * Generates mobile/shared/pip-vectors.json: the website's own answer for where Pip (the "you are here" marker) goes and
 * what he says, so the iPhone and Android apps are checked against the same cases as the web (web/src/lib/pip.ts).
 *
 * - "lines": every fixed line Pip can say, per app language (PIP_LINES). The phones must hold the same text.
 * - "quiet_kinds": the kinds of step Pip stays quiet on (QUIET_KINDS).
 * - "cases": a list of steps in the order shown (id and kind), which are done, the second check's verdict per step,
 *   the step just marked done ("cheering") and whether the heading greeting is still allowed ("greet"), with the web's
 *   answer: "spot" is pipSpot exactly, and "card" / "heading" are where the one Pip is drawn (CareSteps.tsx): on a card
 *   only when the spot is a step, at the heading for the greeting and for "All done for now". During the greeting no
 *   card shows Pip, so there is never more than one on screen.
 *
 * Not part of the web suite. CI regenerates it with mobile/shared/check-vectors.sh (web-ci) and fails when the
 * committed file differs. To regenerate by hand (needs web/src/lib/pip.ts):
 *   cp mobile/shared/genPipVectors.test.ts web/src/lib/
 *   cd web && VECTORS_OUT=../mobile/shared/pip-vectors.json pnpm exec vitest run src/lib/genPipVectors.test.ts
 *   rm src/lib/genPipVectors.test.ts
 */
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PIP_LINES, pipSpot, QUIET_KINDS, type PipSpot } from "./pip";

type Check = "certified" | "flagged" | "unchecked";
type Step = { id: string; kind: string };
type Case = { name: string; steps: Step[]; done: string[]; checks: Record<string, Check>; cheering: string | null; greet: boolean };

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

const four: Step[] = [
  { id: "eye", kind: "referral" },
  { id: "met", kind: "medication" },
  { id: "a1c", kind: "lab_test" },
  { id: "walk", kind: "self_care" },
];
const medFirst = [four[1], four[0], four[2], four[3]];
const c = (name: string, steps: Step[], done: string[], checks: Record<string, Check>, cheering: string | null, greet = true): Case =>
  ({ name, steps, done, checks, cheering, greet });

/** The web unit tests' own cases (web/src/lib/pip.test.ts, web/src/ui/Pip.test.tsx), then seeded random ones. */
const HAND: Case[] = [
  c("start here on the first step", four, [], {}, null),
  c("cheer the step just done", four, ["eye"], {}, "eye"),
  c("next up after some are done", four, ["eye", "met", "a1c"], {}, null),
  c("medicine is current: quiet", four, ["eye"], {}, null),
  c("medicine just done: no cheer, next is a lab: quiet", four, ["eye", "met"], {}, "met"),
  c("flagged first step, greeting off: quiet", four, [], { eye: "flagged" }, null, false),
  c("flagged step just done: no cheer", four, ["eye"], { eye: "flagged" }, "eye"),
  c("flagged first step: greet at the heading", four, [], { eye: "flagged" }, null),
  c("medicine first: greet at the heading", medFirst, [], {}, null),
  c("medicine first, greeting turned off: quiet card", medFirst, [], {}, null, false),
  c("everything done: all done at the heading", four, ["eye", "met", "a1c", "walk"], {}, null),
  c("everything done, last one cheering", four, ["eye", "met", "a1c", "walk"], {}, "walk"),
  c("no steps: no Pip", [], [], {}, null),
  c("unticked again: the cheer drops", four, [], {}, "eye"),
  c("cheering a step no longer shown", four, ["eye"], {}, "gone"),
  c("a done mark on a step not shown does not count as done here", four, ["gone"], {}, null),
  c("warning-kind step first: greet", [{ id: "w", kind: "warning_sign" }, four[0]], [], {}, null),
  c("certified medicine is still quiet", medFirst, ["met"], { met: "certified", eye: "certified" }, null),
];

function randomCases(seed: number, n: number): Case[] {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const out: Case[] = [];
  for (let k = 0; k < n; k++) {
    const len = Math.floor(r() * 6);
    const steps = Array.from({ length: len }, (_, i) => ({ id: `s${i}`, kind: pick(KINDS) }));
    const checks: Record<string, Check> = {};
    for (const s of steps) checks[s.id] = pick(CHECKS);
    const done = steps.filter(() => r() < 0.4).map((s) => s.id);
    const roll = r();
    const cheering = roll < 0.4 || len === 0 ? null : roll < 0.9 ? pick(steps).id : "gone";
    out.push(c(`random ${seed}:${k}`, steps, done, checks, cheering, r() < 0.7));
  }
  return out;
}

/** Where the one Pip is drawn (CareSteps.tsx): a card only for a step spot; the heading for the greeting and all done. */
function drawn(spot: PipSpot) {
  return {
    card: spot.at === "step" ? { id: spot.id, mood: spot.mood, line: spot.line } : null,
    heading: spot.at === "header" || spot.at === "greet" ? spot.mood : null,
  };
}

it("writes the Pip vectors", () => {
  const cases = [...HAND, ...randomCases(20261004, 600)];
  const rows = cases.map((x) => {
    const done = Object.fromEntries(x.done.map((id) => [id, true]));
    const spot = pipSpot(x.steps, done, (id) => x.checks[id] ?? "unchecked", x.cheering, x.greet);
    const d = drawn(spot);
    // Exactly one Pip on screen whenever there are steps, and never one on a card during the greeting.
    expect((d.card ? 1 : 0) + (d.heading ? 1 : 0)).toBe(spot.at === "none" ? 0 : 1);
    return { ...x, spot, card: d.card, heading: d.heading };
  });
  // Every kind of spot must be represented, or the phones' replay would prove nothing about it.
  for (const at of ["step", "header", "greet", "none"]) expect(rows.some((x) => x.spot.at === at), at).toBe(true);
  for (const mood of ["arrive", "cheer", "quiet"]) expect(rows.some((x) => x.card?.mood === mood), mood).toBe(true);

  const out = process.env.VECTORS_OUT;
  if (!out) throw new Error("set VECTORS_OUT");
  const body = [
    `"lines":${JSON.stringify(PIP_LINES)}`,
    `"quiet_kinds":${JSON.stringify([...QUIET_KINDS].sort())}`,
    `"cases":[\n${rows.map((x) => JSON.stringify(x)).join(",\n")}\n]`,
  ];
  writeFileSync(out, `{\n${body.join(",\n")}\n}\n`);
});
