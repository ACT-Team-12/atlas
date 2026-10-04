import { describe, expect, it } from "vitest";
import { readableRect } from "./ReadyCue";

const heading = (top: number, height = 40) => ({ top, bottom: top + height, height });

describe("readableRect: the cue hides only when the result's heading is plainly on screen", () => {
  it("portrait phone (390x844): a heading in the middle counts; under the sticky header or the bottom bar does not", () => {
    expect(readableRect(heading(300), 844)).toBe(true);
    expect(readableRect(heading(60), 844)).toBe(false); // under the sticky tab bar
    expect(readableRect(heading(800), 844)).toBe(false); // only its top edge has come into view
  });
  it("landscape phone (844x390): the band follows the height, so it does not collapse (Codex review, round 2)", () => {
    expect(readableRect(heading(150), 390)).toBe(true);
    expect(readableRect(heading(20), 390)).toBe(false);
  });
  it("ultrawide desktop (3440x1440): still decided by height", () => {
    expect(readableRect(heading(600, 60), 1440)).toBe(true);
    expect(readableRect(heading(1400, 60), 1440)).toBe(false);
  });
  it("a hidden heading (zero height) never counts", () => {
    expect(readableRect({ top: 300, bottom: 300, height: 0 }, 844)).toBe(false);
  });
});
