import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./schema";
import type { Check } from "./paperFirst";
import { currentStepId, PIP_LINES, pipLine, pipQuiet, pipSpot, type PipLine } from "./pip";

const LINES: PipLine[] = ["start", "done", "next", "allDone"];
const unchecked = (): Check => "unchecked";

describe("Pip's fixed lines", () => {
  it("has every line in all 7 app languages, short and non-empty", () => {
    expect(Object.keys(PIP_LINES).sort()).toEqual([...LANGUAGES].sort());
    for (const lang of LANGUAGES) {
      for (const line of LINES) {
        const text = PIP_LINES[lang][line];
        expect(text.trim().length, `${lang} ${line}`).toBeGreaterThan(0);
        expect(text.length, `${lang} ${line}`).toBeLessThanOrEqual(32);
        expect(pipLine(lang, line)).toBe(text);
      }
    }
  });

  it("falls back to English for a language it does not know", () => {
    expect(pipLine("Klingon", "start")).toBe("Start here");
  });

  it("never suggests a medical action: English lines are about position and progress only", () => {
    expect(PIP_LINES.English).toEqual({ start: "Start here", done: "Nice, that's done", next: "Next up", allDone: "All done for now" });
    for (const lang of LANGUAGES) for (const line of LINES) expect(PIP_LINES[lang][line]).not.toMatch(/\d|mg|take|dose|pill|call/i);
  });
});

describe("where Pip goes", () => {
  const steps = [
    { id: "eye", kind: "referral" },
    { id: "met", kind: "medication" },
    { id: "a1c", kind: "lab_test" },
    { id: "walk", kind: "self_care" },
  ];

  it("the current step is the first one not done, in the order shown", () => {
    expect(currentStepId(steps, {})).toBe("eye");
    expect(currentStepId(steps, { eye: true })).toBe("met");
    expect(currentStepId(steps, { eye: true, met: true, a1c: true, walk: true })).toBeNull();
  });

  it("is quiet on medicine, lab tests, warning signs and a step a check disagreed with", () => {
    expect(pipQuiet("medication", "certified")).toBe(true);
    expect(pipQuiet("lab_test", "certified")).toBe(true);
    expect(pipQuiet("warning_sign", "unchecked")).toBe(true);
    expect(pipQuiet("self_care", "flagged")).toBe(true);
    expect(pipQuiet("self_care", "unchecked")).toBe(false);
    expect(pipQuiet("referral", "certified")).toBe(false);
  });

  it("says Start here first, then cheers a done step, then Next up", () => {
    expect(pipSpot(steps, {}, unchecked, null)).toEqual({ at: "step", id: "eye", mood: "arrive", line: "start" });
    expect(pipSpot(steps, { eye: true }, unchecked, "eye")).toEqual({ at: "step", id: "eye", mood: "cheer", line: "done" });
    expect(pipSpot(steps, { eye: true, met: true, a1c: true }, unchecked, null)).toEqual({ at: "step", id: "walk", mood: "arrive", line: "next" });
  });

  it("never cheers, and never speaks, on medicine or a lab test", () => {
    // Current step is medicine: quiet, no line.
    expect(pipSpot(steps, { eye: true }, unchecked, null)).toEqual({ at: "step", id: "met", mood: "quiet", line: null });
    // Medicine just marked done: no cheer there, Pip goes to the next step (a lab test: quiet again).
    expect(pipSpot(steps, { eye: true, met: true }, unchecked, "met")).toEqual({ at: "step", id: "a1c", mood: "quiet", line: null });
    // A step the check flagged: no cheer and no line either.
    const flagged = (id: string): Check => (id === "eye" ? "flagged" : "unchecked");
    expect(pipSpot(steps, {}, flagged, null, false)).toEqual({ at: "step", id: "eye", mood: "quiet", line: null });
    expect(pipSpot(steps, { eye: true }, flagged, "eye")).toEqual({ at: "step", id: "met", mood: "quiet", line: null });
  });

  it("greets once at the heading when the first current step is quiet, and never after a step is done", () => {
    // Nothing done and the current step is quiet: the heading says Start here, the card stays quiet (id).
    const flagged = (id: string): Check => (id === "eye" ? "flagged" : "unchecked");
    expect(pipSpot(steps, {}, flagged, null)).toEqual({ at: "greet", id: "eye", mood: "arrive", line: "start" });
    const medFirst = [steps[1], steps[0], steps[2], steps[3]];
    expect(pipSpot(medFirst, {}, unchecked, null)).toEqual({ at: "greet", id: "met", mood: "arrive", line: "start" });
    // A non-quiet first step: the normal Start here on the card, no greeting.
    expect(pipSpot(steps, {}, unchecked, null).at).toBe("step");
    // Anything done, or the screen has turned the greeting off: quiet card only.
    expect(pipSpot(steps, { eye: true }, unchecked, null)).toEqual({ at: "step", id: "met", mood: "quiet", line: null });
    expect(pipSpot(medFirst, {}, unchecked, null, false)).toEqual({ at: "step", id: "met", mood: "quiet", line: null });
  });

  it("moves to the heading with All done for now, and is absent with no steps", () => {
    expect(pipSpot(steps, { eye: true, met: true, a1c: true, walk: true }, unchecked, null)).toEqual({ at: "header", mood: "arrive", line: "allDone" });
    expect(pipSpot([], {}, unchecked, null)).toEqual({ at: "none" });
  });

  it("drops the cheer when the step is unticked again", () => {
    expect(pipSpot(steps, {}, unchecked, "eye")).toEqual({ at: "step", id: "eye", mood: "arrive", line: "start" });
  });
});
