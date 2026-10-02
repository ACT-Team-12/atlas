import { describe, expect, it } from "vitest";
import { anchorHolds, ANCHOR_MS, isEditable, photoId, planFingerprint, planPlace, readFingerprint, shouldAutoScroll } from "./staleGuard";

const read = { text: "paper one", photo: null, language: "English", level: "simple" };
const plan = { careIds: ["c1", "c2"], barriers: ["transport", "cost"], language: "English", note: "", place: "30030" };

describe("readFingerprint", () => {
  it("is the same for the same inputs", () => expect(readFingerprint(read)).toBe(readFingerprint({ ...read })));
  it("changes when the paper, language or level changes", () => {
    for (const change of [{ text: "paper two" }, { language: "Spanish" }, { level: "detailed" }]) {
      expect(readFingerprint({ ...read, ...change })).not.toBe(readFingerprint(read));
    }
  });
  it("for a photo, the photo counts, not the empty text box", () => {
    const a = { ...read, text: "", photo: "a.jpg:10:1" };
    expect(readFingerprint(a)).toBe(readFingerprint({ ...a, text: "ignored" }));
    expect(readFingerprint(a)).not.toBe(readFingerprint({ ...a, photo: "b.jpg:10:1" }));
    expect(readFingerprint(a)).not.toBe(readFingerprint({ ...a, photo: null }));
  });
});

describe("planFingerprint", () => {
  it("ignores barrier order", () => expect(planFingerprint({ ...plan, barriers: ["cost", "transport"] })).toBe(planFingerprint(plan)));
  it("changes when barriers, note, place, language or steps change", () => {
    for (const change of [{ barriers: ["cost"] }, { note: "no car" }, { place: "30340" }, { place: "device" }, { language: "French" }, { careIds: ["c1"] }]) {
      expect(planFingerprint({ ...plan, ...change })).not.toBe(planFingerprint(plan));
    }
  });
});

describe("planPlace", () => {
  it("device location wins", () => expect(planPlace(true, "30030")).toBe("device"));
  it("a full ZIP is sent, a partial one is not", () => {
    expect(planPlace(false, "30030")).toBe("30030");
    expect(planPlace(false, "300")).toBe("");
  });
});

describe("photoId", () => {
  it("names a file by name, size and date", () => expect(photoId({ name: "a.jpg", size: 5, lastModified: 9 })).toBe("a.jpg:5:9"));
  it("is null without a photo", () => expect(photoId(null)).toBeNull());
});

describe("isEditable", () => {
  it("text boxes, selects and text inputs are editing", () => {
    expect(isEditable({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditable({ tagName: "select" })).toBe(true);
    expect(isEditable({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditable({ tagName: "INPUT" })).toBe(true);
    expect(isEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("buttons and checkboxes are not", () => {
    expect(isEditable({ tagName: "BUTTON" })).toBe(false);
    expect(isEditable({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditable({ tagName: "BODY" })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe("anchorHolds", () => {
  const base = { anchorAt: 100, now: 200, lastInteractionAt: 50, focusEditable: false };
  it("holds the card in place right after an automatic scroll", () => expect(anchorHolds(base)).toBe(true));
  it("lets go after a while", () => expect(anchorHolds({ ...base, now: 100 + ANCHOR_MS + 1 })).toBe(false));
  it("lets go once they scroll, tap or type", () => expect(anchorHolds({ ...base, lastInteractionAt: 150 })).toBe(false));
  it("lets go while they are in a text box", () => expect(anchorHolds({ ...base, focusEditable: true })).toBe(false));
});

describe("shouldAutoScroll", () => {
  it("scrolls when nothing happened since the button", () => expect(shouldAutoScroll({ submittedAt: 10, lastInteractionAt: 9, focusEditable: false })).toBe(true));
  it("does not scroll after they scrolled, tapped or typed", () => expect(shouldAutoScroll({ submittedAt: 10, lastInteractionAt: 11, focusEditable: false })).toBe(false));
  it("does not scroll while they are in a text box", () => expect(shouldAutoScroll({ submittedAt: 10, lastInteractionAt: 9, focusEditable: true })).toBe(false));
});
