import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./schema";
import type { Check } from "./paperFirst";
import { pipSpot } from "./pip";
import { nextOpen, WALK_LINES, walkLine, walkPip, walkSteps, type WalkLine } from "./walkThrough";
import type { WhenGroup } from "./stepsView";

const s = (id: string, kind: string, group: WhenGroup | "warning") => ({ id, kind, group });
const STEPS = [
  s("later1", "lab_test", "later"),
  s("w1", "warning_sign", "warning"),
  s("today1", "self_care", "today"),
  s("unclear1", "referral", "unclear"),
  s("today2", "medication", "today"),
  s("daily1", "self_care", "daily"),
  s("w2", "self_care", "warning"),
  s("soon1", "follow_up_visit", "soon"),
];
const walk = () => walkSteps(STEPS, (x) => x.group === "warning", (x) => x.group as WhenGroup);

describe("walkSteps: the list's own order", () => {
  it("puts warning signs first, then every time group earliest first, paper order inside each", () => {
    expect(walk().map((w) => w.it.id)).toEqual(["w1", "w2", "today1", "today2", "soon1", "daily1", "later1", "unclear1"]);
  });
  it("keeps every step exactly once", () => {
    const ids = walk().map((w) => w.it.id);
    expect(ids).toHaveLength(STEPS.length);
    expect(new Set(ids).size).toBe(STEPS.length);
  });
  it("labels each step with its group", () => {
    expect(walk().map((w) => w.group)).toEqual(["warning", "warning", "today", "today", "soon", "daily", "later", "unclear"]);
  });
  it("is empty for no steps", () => {
    expect(walkSteps([], () => false, () => "today")).toEqual([]);
  });
});

describe("nextOpen", () => {
  const w = walk();
  it("finds the first step not done at or after a position, wrapping", () => {
    expect(nextOpen(w, {}, 0)).toBe(0);
    expect(nextOpen(w, { w1: true, w2: true }, 0)).toBe(2);
    expect(nextOpen(w, { unclear1: true }, 7)).toBe(0);
  });
  it("is -1 when every step is done", () => {
    expect(nextOpen(w, Object.fromEntries(STEPS.map((x) => [x.id, true])), 3)).toBe(-1);
  });
});

describe("walkPip: the list's Pip rules on one screen", () => {
  const ordered = walk().filter((w) => w.group !== "warning").map((w) => w.it);
  const unchecked = (): Check => "unchecked";
  const at = (id: string) => STEPS.find((x) => x.id === id)!;

  it("shows Pip with its fixed line on the step that is Pip's spot", () => {
    const spot = pipSpot(ordered, {}, unchecked, null, false);
    expect(walkPip(spot, at("today1"), "unchecked", false)).toEqual({ mood: "arrive", line: "start" });
  });
  it("shows no Pip on a step that is not Pip's spot", () => {
    const spot = pipSpot(ordered, {}, unchecked, null, false);
    expect(walkPip(spot, at("soon1"), "unchecked", false)).toBeNull();
  });
  it("is quiet (no line, no cheer) on medicine, lab, warning and flagged steps", () => {
    const medFirst = pipSpot([at("today2"), at("today1")], {}, unchecked, null, false);
    expect(walkPip(medFirst, at("today2"), "unchecked", false)).toEqual({ mood: "quiet", line: null });
    const cheer = pipSpot(ordered, { today1: true }, unchecked, "today1", false);
    expect(cheer).toMatchObject({ mood: "cheer" });
    expect(walkPip(cheer, at("today2"), "unchecked", false)).toBeNull();
    expect(walkPip(cheer, at("later1"), "unchecked", false)).toBeNull();
    expect(walkPip(cheer, at("w2"), "unchecked", true)).toBeNull();
    expect(walkPip(cheer, at("soon1"), "flagged", false)).toBeNull();
  });
  it("never carries a cheer onto another step's screen (it would read as that step being done)", () => {
    const cheer = pipSpot(ordered, { today1: true }, unchecked, "today1", false);
    expect(walkPip(cheer, at("soon1"), "unchecked", false)).toBeNull();
    expect(walkPip(cheer, at("today1"), "unchecked", false)).toEqual({ mood: "cheer", line: "done" });
  });
  it("never cheers a quiet step that was just done (pipSpot already refuses it)", () => {
    const spot = pipSpot(ordered, { today2: true }, unchecked, "today2", false);
    expect(spot).not.toMatchObject({ mood: "cheer" });
  });
});

describe("WALK_LINES: every line in every app language", () => {
  const keys = Object.keys(WALK_LINES.English) as WalkLine[];
  it("covers all 7 languages", () => {
    expect(Object.keys(WALK_LINES).sort()).toEqual([...LANGUAGES].sort());
  });
  for (const lang of LANGUAGES) {
    it(`${lang} has every line, non-empty, with the same placeholders as English`, () => {
      expect(Object.keys(WALK_LINES[lang]).sort()).toEqual([...keys].sort());
      for (const k of keys) {
        const line = WALK_LINES[lang][k];
        expect(line.trim(), `${lang}.${k}`).not.toBe("");
        const holes = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort();
        expect(holes(line), `${lang}.${k}`).toEqual(holes(WALK_LINES.English[k]));
        // No em or en dashes in user-facing copy.
        expect(line, `${lang}.${k}`).not.toMatch(/[\u2013\u2014]/);
      }
    });
  }
  it("keeps 911 and 211 in every language's help lines", () => {
    for (const lang of LANGUAGES) {
      expect(WALK_LINES[lang].warningDo).toContain("911");
      expect(WALK_LINES[lang].ask211).toContain("211");
    }
  });
});

describe("walkLine", () => {
  it("fills in values", () => {
    expect(walkLine("English", "progress", { n: 3, total: 12 })).toBe("Step 3 of 12");
    expect(walkLine("Spanish", "progress", { n: 3, total: 12 })).toBe("Paso 3 de 12");
    expect(walkLine("English", "finishedCount", { done: 2, total: 5 })).toBe("2 of 5 marked done.");
  });
  it("falls back to English for a language not in the table", () => {
    expect(walkLine("Klingon", "done")).toBe("Done");
  });
});
