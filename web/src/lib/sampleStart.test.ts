import { describe, expect, it } from "vitest";
import { isPlainClick, mayFillSample } from "./sampleStart";

describe("isPlainClick: only a plain left click acts in this tab", () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it("a plain left click does", () => expect(isPlainClick(base)).toBe(true));
  it("new-tab and new-window clicks do not (the new tab reads #try-sample itself)", () => {
    expect(isPlainClick({ ...base, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...base, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...base, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...base, altKey: true })).toBe(false);
    expect(isPlainClick({ ...base, button: 1 })).toBe(false);
  });
});

const SAMPLE = "AFTER VISIT SUMMARY\nTake 1 tablet by mouth 2 times a day with meals.";

describe("mayFillSample: arriving with the sample never replaces the person's own paper", () => {
  it("fills an empty or blank box", () => {
    expect(mayFillSample("", false, SAMPLE)).toBe(true);
    expect(mayFillSample("   \n ", false, SAMPLE)).toBe(true);
  });
  it("refills a box that already holds the sample", () => {
    expect(mayFillSample(SAMPLE, false, SAMPLE)).toBe(true);
  });
  it("keeps a paper the person typed, even a short one", () => {
    expect(mayFillSample("my mom's discharge paper", false, SAMPLE)).toBe(false);
    expect(mayFillSample(SAMPLE + " edited", false, SAMPLE)).toBe(false);
  });
  it("keeps a chosen photo", () => {
    expect(mayFillSample("", true, SAMPLE)).toBe(false);
  });
});
