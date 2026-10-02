import { describe, expect, it } from "vitest";
import { canMakeSimpler, isTranscriptEdited, type SimplerState } from "./simpler";

const base: SimplerState = { readLevel: "detailed", hasCare: true, needsPhotoCheck: false, reading: false, sourceLength: 500, transcriptEdited: false };

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
  it("never re-reads a photo reading the person edited but did not accept", () => expect(canMakeSimpler({ ...base, transcriptEdited: true })).toBe(false));
});

describe("isTranscriptEdited", () => {
  it("is false for pasted text (no photo reading)", () => expect(isTranscriptEdited(null, "abc")).toBe(false));
  it("is false while the reading is unchanged", () => expect(isTranscriptEdited("abc", "abc")).toBe(false));
  it("is true once a word changed", () => expect(isTranscriptEdited("abd", "abc")).toBe(true));
});
