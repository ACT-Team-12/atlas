import { describe, expect, it } from "vitest";
import { readableNow } from "./ReadyCue";

describe("readableNow: the cue hides only when the result's heading is plainly on screen", () => {
  it("a heading fully inside the middle band counts", () => {
    expect(readableNow({ isIntersecting: true, intersectionRatio: 1 })).toBe(true);
  });
  it("one edge entering the viewport does not (Codex review)", () => {
    expect(readableNow({ isIntersecting: true, intersectionRatio: 0.05 })).toBe(false);
    expect(readableNow({ isIntersecting: true, intersectionRatio: 0.6 })).toBe(false);
  });
  it("off screen does not", () => {
    expect(readableNow({ isIntersecting: false, intersectionRatio: 0 })).toBe(false);
  });
});
