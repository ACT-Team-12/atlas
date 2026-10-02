import { describe, expect, it } from "vitest";
import { canMakeSimpler, type SimplerState } from "./simpler";

const base: SimplerState = { readLevel: "detailed", hasCare: true, needsPhotoCheck: false, reading: false, sourceLength: 500 };

describe("canMakeSimpler", () => {
  it("offers it after a detailed or standard read", () => {
    expect(canMakeSimpler(base)).toBe(true);
    expect(canMakeSimpler({ ...base, readLevel: "standard" })).toBe(true);
  });
  it("shows nothing when the steps are already simple", () => expect(canMakeSimpler({ ...base, readLevel: "simple" })).toBe(false));
  it("shows nothing before a paper is read", () => expect(canMakeSimpler({ ...base, hasCare: false, readLevel: null })).toBe(false));
  it("never skips the photo check", () => expect(canMakeSimpler({ ...base, needsPhotoCheck: true })).toBe(false));
  it("hides while a read is running", () => expect(canMakeSimpler({ ...base, reading: true })).toBe(false));
  it("needs enough text to read, like the read button", () => expect(canMakeSimpler({ ...base, sourceLength: 10 })).toBe(false));
});
