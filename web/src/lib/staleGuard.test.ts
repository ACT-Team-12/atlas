import { describe, expect, it } from "vitest";
import {
  anchorHolds, ANCHOR_MS, isEditable, LAYOUT_SCROLL_MS, laterShiftExplains, NO_LAYOUT_SHIFT, OWN_SCROLL_SLACK_PX, ownScrollArrived, ownScrollEndedByPerson, photoId, rebaseOwnScroll, planFingerprint, planPlace,
  readFingerprint, readFingerprintFor, scrollIsPersons, shouldAutoScroll,
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
  it("while a location request is out, the place is locating (matches no plan)", () => {
    expect(planPlace(true, "30030", true)).toBe("locating");
    expect(planPlace(false, "30030", true)).toBe("locating");
  });
  it("a full ZIP is sent, a partial one is not", () => {
    expect(planPlace(false, "30030")).toBe("30030");
    expect(planPlace(false, "300")).toBe("");
  });
});

/** A chosen photo, as a file input hands it over: a new File object each time. */
const pick = (bytes: string) => new File([bytes], "IMG_0001.jpg", { type: "image/jpeg", lastModified: 1_700_000_000_000 });

describe("photoId", () => {
  it("gives two different photos with the same name, size and date different ids", () => {
    const a = pick("aaaa"), b = pick("bbbb");
    expect([a.name, a.size, a.lastModified]).toEqual([b.name, b.size, b.lastModified]);
    expect(photoId(a)).not.toBe(photoId(b));
  });
  it("keeps the same id for the same chosen file", () => {
    const a = pick("aaaa");
    expect(photoId(a)).toBe(photoId(a));
  });
  it("choosing the same file again is a new choice", () => expect(photoId(pick("aaaa"))).not.toBe(photoId(pick("aaaa"))));
  it("is null without a photo", () => expect(photoId(null)).toBeNull());
});

describe("readFingerprintFor (the freshness check the care tool runs)", () => {
  const inputs = { text: "", language: "English", level: "simple" };
  it("a reading of photo A is not current once photo B (same name, size and date) is chosen", () => {
    const a = pick("aaaa"), b = pick("bbbb");
    const sentForA = readFingerprintFor({ ...inputs, photo: a });
    expect(readFingerprintFor({ ...inputs, photo: a })).toBe(sentForA);
    expect(readFingerprintFor({ ...inputs, photo: b })).not.toBe(sentForA);
  });
  it("matches the plain fingerprint: a photo replaces the text box, no photo reads the text", () => {
    const a = pick("aaaa");
    expect(readFingerprintFor({ ...inputs, text: "ignored", photo: a })).toBe(readFingerprintFor({ ...inputs, photo: a }));
    expect(readFingerprintFor({ ...inputs, text: "paper one", photo: null })).toBe(readFingerprint({ ...read }));
  });
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

describe("laterShiftExplains (the browser's scroll arrives before the size report)", () => {
  const scroll = { at: 10_000, y: 3_535 };
  it("a size change right after the scroll, at that position, explains it", () => {
    expect(laterShiftExplains(scroll, { at: 10_001, y: 3_535 })).toBe(true);
    expect(laterShiftExplains(scroll, { at: 10_000 + LAYOUT_SCROLL_MS, y: 3_535 + OWN_SCROLL_SLACK_PX })).toBe(true);
  });
  it("not one before the scroll, too late, or at another position (the person scrolled while the page changed)", () => {
    expect(laterShiftExplains(scroll, { at: 9_999, y: 3_535 })).toBe(false);
    expect(laterShiftExplains(scroll, { at: 10_001 + LAYOUT_SCROLL_MS, y: 3_535 })).toBe(false);
    expect(laterShiftExplains(scroll, { at: 10_001, y: 3_535 + OWN_SCROLL_SLACK_PX + 1 })).toBe(false);
    expect(laterShiftExplains(scroll, NO_LAYOUT_SHIFT)).toBe(false);
  });
});

describe("scrollIsPersons", () => {
  const own = { start: 9_000, until: 10_500, from: 2_000, to: 500 };
  const quiet = { now: 10_000, y: 1_200, own: null, layout: NO_LAYOUT_SHIFT };
  /** The page changed size a moment before; the observer read the (already adjusted) position 1_200. */
  const shifted = (at: number) => ({ at, y: 1_200 });
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
  it("not right after the page changed size, at the position measured then (the browser keeping content in place)", () => {
    expect(scrollIsPersons({ ...quiet, layout: shifted(10_000 - LAYOUT_SCROLL_MS + 1) })).toBe(false);
    expect(scrollIsPersons({ ...quiet, y: 1_200 + OWN_SCROLL_SLACK_PX, layout: shifted(10_000 - 10) })).toBe(false);
    expect(scrollIsPersons({ ...quiet, layout: shifted(10_000 - LAYOUT_SCROLL_MS - 1) })).toBe(true);
  });
  it("any other position right after a size change is the person, near or far (a big size change excuses nothing)", () => {
    expect(scrollIsPersons({ ...quiet, y: 4_000, layout: shifted(10_000 - 10) })).toBe(true);
    expect(scrollIsPersons({ ...quiet, y: 1_200 + OWN_SCROLL_SLACK_PX + 1, layout: shifted(10_000 - 10) })).toBe(true);
    expect(scrollIsPersons({ ...quiet, y: 1_200 - 100, layout: shifted(10_000 - 10) })).toBe(true);
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
  it("a size change meanwhile still counts the (rebased) target", () => expect(ownScrollEndedByPerson({ y: 1_200, own, layout: { at: 9_500, y: 1_200 }, now: 10_000 })).toBe(true));
  it("but not a scroll end right after a size change, at the position measured then (the browser keeping content in place)", () => {
    expect(ownScrollEndedByPerson({ y: 1_200, own, layout: { at: 9_950, y: 1_200 }, now: 10_000 })).toBe(false);
  });
  it("a scroll end right after a size change anywhere else (not the target either) is the person", () => {
    expect(ownScrollEndedByPerson({ y: 3_000, own, layout: { at: 9_950, y: 1_200 }, now: 10_000 })).toBe(true);
  });
});

describe("ownScrollArrived", () => {
  const own = { start: 9_000, until: 10_500, from: 0, to: 1_000 };
  it("at its target (within the slack) it arrived", () => expect(ownScrollArrived({ y: 1_000 - OWN_SCROLL_SLACK_PX, own })).toBe(true));
  it("still on the way there, it was stopped", () => expect(ownScrollArrived({ y: 500, own })).toBe(false));
});

describe("rebaseOwnScroll", () => {
  it("re-aims the path from where the page is now to where its target sits now", () => {
    const own = { start: 9_000, until: 10_500, from: 2_000, to: 500 };
    expect(rebaseOwnScroll(own, { y: 1_400, to: 800 })).toEqual({ ...own, from: 1_400, to: 800 });
  });
});
