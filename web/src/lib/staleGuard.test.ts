import { describe, expect, it } from "vitest";
import {
  anchorHolds, ANCHOR_MS, isEditable, LAYOUT_SCROLL_MS, NO_LAYOUT_SHIFT, OWN_SCROLL_SLACK_PX, ownScrollEndedByPerson, photoId, rebaseOwnScroll, planFingerprint, planPlace,
  readFingerprint, scrollIsPersons, shouldAutoScroll,
} from "./staleGuard";

const read = { text: "paper one", photo: null, language: "English", level: "simple" };
const plan = { careIds: ["c1", "c2"], barriers: ["transport", "cost"], language: "English", note: "", place: "30030", location: null };

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
  it("a new device position is a different request, even though place still says device", () => {
    const a = { ...plan, place: "device", location: { lat: 33.75, lng: -84.39 } };
    expect(planFingerprint(a)).toBe(planFingerprint({ ...a, location: { lat: 33.75, lng: -84.39 } }));
    expect(planFingerprint(a)).not.toBe(planFingerprint({ ...a, location: { lat: 33.76, lng: -84.39 } }));
    expect(planFingerprint(a)).not.toBe(planFingerprint({ ...a, location: { lat: 33.75, lng: -84.4 } }));
    expect(planFingerprint(a)).not.toBe(planFingerprint({ ...a, location: null }));
  });
  it("normalizes -0 so the same position always matches", () => {
    const a = { ...plan, place: "device", location: { lat: 0, lng: -84.39 } };
    expect(planFingerprint(a)).toBe(planFingerprint({ ...a, location: { lat: -0, lng: -84.39 } }));
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

describe("scrollIsPersons", () => {
  const own = { start: 9_000, until: 10_500, from: 2_000, to: 500 };
  const quiet = { now: 10_000, y: 1_200, own: null, layout: NO_LAYOUT_SHIFT };
  /** The page grew by 300px a moment before, at scrollY 1_000; the browser moved the view to 1_200 (within 300). */
  const shifted = (at: number) => ({ at, y: 1_000, shift: 300 });
  it("a scroll with nothing else going on is the person's (scrollbar drag, find in page)", () => expect(scrollIsPersons(quiet)).toBe(true));
  it("on the path of the page's own scroll, it is the page", () => {
    expect(scrollIsPersons({ ...quiet, own })).toBe(false);
    expect(scrollIsPersons({ ...quiet, own, y: 500 + OWN_SCROLL_SLACK_PX })).toBe(false);
  });
  it("off that path (dragged the other way, or past the target), it is the person", () => {
    expect(scrollIsPersons({ ...quiet, own, y: 2_000 + OWN_SCROLL_SLACK_PX + 1 })).toBe(true);
    expect(scrollIsPersons({ ...quiet, own, y: 500 - OWN_SCROLL_SLACK_PX - 1 })).toBe(true);
  });
  it("after the page's own scroll could still be moving, any scroll is the person's", () => {
    expect(scrollIsPersons({ ...quiet, own: { ...own, until: 9_999 } })).toBe(true);
  });
  it("not right after the page changed size, when it moved no further than the size change (the browser keeping content in place)", () => {
    expect(scrollIsPersons({ ...quiet, layout: shifted(10_000 - LAYOUT_SCROLL_MS + 1) })).toBe(false);
    expect(scrollIsPersons({ ...quiet, y: 700 - OWN_SCROLL_SLACK_PX, layout: shifted(10_000 - 10) })).toBe(false);
    expect(scrollIsPersons({ ...quiet, layout: shifted(10_000 - LAYOUT_SCROLL_MS - 1) })).toBe(true);
  });
  it("a far scrollbar move right after a size change is still the person (further than the size change explains)", () => {
    expect(scrollIsPersons({ ...quiet, y: 4_000, layout: shifted(10_000 - 10) })).toBe(true);
    expect(scrollIsPersons({ ...quiet, y: 1_300 + OWN_SCROLL_SLACK_PX + 1, layout: shifted(10_000 - 10) })).toBe(true);
    expect(scrollIsPersons({ ...quiet, y: 1_300 + OWN_SCROLL_SLACK_PX + 1, layout: { at: 10_000 - 10, y: 1_000, shift: 0 } })).toBe(true);
  });
  it("a size change during the page's own scroll does not switch the check off: once settled, off the (rebased) path is the person", () => {
    expect(scrollIsPersons({ ...quiet, own, y: 5_000, layout: shifted(9_500) })).toBe(true);
    expect(scrollIsPersons({ ...quiet, own, y: 1_200, layout: shifted(9_500) })).toBe(false);
  });
});

describe("ownScrollEndedByPerson", () => {
  const own = { start: 9_000, until: 10_500, from: 2_000, to: 500 };
  it("ending at the target is the page", () => expect(ownScrollEndedByPerson({ y: 500 + OWN_SCROLL_SLACK_PX, own, layout: NO_LAYOUT_SHIFT, now: 10_000 })).toBe(false));
  it("ending elsewhere is the person", () => expect(ownScrollEndedByPerson({ y: 1_200, own, layout: NO_LAYOUT_SHIFT, now: 10_000 })).toBe(true));
  it("a size change meanwhile still counts the (rebased) target", () => expect(ownScrollEndedByPerson({ y: 1_200, own, layout: { at: 9_500, y: 500, shift: 900 }, now: 10_000 })).toBe(true));
  it("but not a scroll end right after a size change, within that change of the target (the browser keeping content in place)", () => {
    expect(ownScrollEndedByPerson({ y: 1_200, own, layout: { at: 9_950, y: 500, shift: 700 }, now: 10_000 })).toBe(false);
  });
  it("a scroll end right after a size change, further from the target than the change explains, is the person", () => {
    expect(ownScrollEndedByPerson({ y: 3_000, own, layout: { at: 9_950, y: 500, shift: 700 }, now: 10_000 })).toBe(true);
  });
});

describe("rebaseOwnScroll", () => {
  it("re-aims the path from where the page is now to where its target sits now", () => {
    const own = { start: 9_000, until: 10_500, from: 2_000, to: 500 };
    expect(rebaseOwnScroll(own, { y: 1_400, to: 800 })).toEqual({ ...own, from: 1_400, to: 800 });
  });
});
