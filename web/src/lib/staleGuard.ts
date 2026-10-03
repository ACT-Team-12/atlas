/**
 * Late replies must not override what the person did meanwhile. A read or a plan remembers a
 * fingerprint of what was sent; if the inputs have changed when the reply lands, the reply is dropped.
 * The automatic scroll after a reply only happens when the person has not touched the page since.
 */

export type ReadInputs = {
  /** The pasted text, or null when a photo is being read. */
  text: string | null;
  /** Identity of the photo file, or null for pasted text. */
  photo: string | null;
  language: string;
  level: string;
};

export type PlanInputs = {
  /** The care step ids sent (removed steps left out). */
  careIds: string[];
  barriers: string[];
  language: string;
  note: string;
  /** "device" when the device location is used, otherwise the ZIP sent (or ""). */
  place: string;
  /** The device location sent, or null. A new position is a different request, so it counts. */
  location: { lat: number; lng: number } | null;
};

/** Order-free where order means nothing (barriers), exact everywhere else. */
export function readFingerprint(r: ReadInputs): string {
  return JSON.stringify([r.photo ?? null, r.photo ? null : r.text, r.language, r.level]);
}

export function planFingerprint(p: PlanInputs): string {
  return JSON.stringify([p.careIds, [...p.barriers].sort(), p.language, p.note, p.place, normalLocation(p.location)]);
}

/** The exact coordinates sent, in one canonical form (-0 is 0, anything not a finite number is null). */
function normalLocation(l: { lat: number; lng: number } | null): [number | null, number | null] | null {
  if (!l) return null;
  const n = (x: number) => (Number.isFinite(x) ? x + 0 : null);
  return [n(l.lat), n(l.lng)];
}

/**
 * Each chosen photo is its own identity. Name, size and date are not enough: two different photos can share all
 * three (camera exports, renamed copies), and a late reading of the first must not pass as the second's. A file
 * input hands back a new File object on every choice, so the object itself is the identity, numbered on first sight.
 */
const photoSerials = new WeakMap<object, number>();
let nextPhotoSerial = 0;

export function photoId(f: object | null): string | null {
  if (!f) return null;
  let n = photoSerials.get(f);
  if (n === undefined) { n = ++nextPhotoSerial; photoSerials.set(f, n); }
  return `photo:${n}`;
}

/** The fingerprint of a read from the inputs on screen: a chosen photo replaces the text box. */
export function readFingerprintFor(i: { text: string; photo: object | null; language: string; level: string }): string {
  return readFingerprint({ text: i.photo ? null : i.text, photo: photoId(i.photo), language: i.language, level: i.level });
}

/**
 * What the plan request sends for place: the device location wins, else a valid 5 digit ZIP. While a location
 * request is out the place is "locating", which no plan is made from, so nothing is current until it answers.
 */
export function planPlace(hasDeviceLocation: boolean, zip: string, locating = false): string {
  return locating ? "locating" : hasDeviceLocation ? "device" : /^\d{5}$/.test(zip) ? zip : "";
}

/** True for controls a person types into. Buttons, checkboxes and radios are not editing. */
export function isEditable(el: { tagName: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes((el.type ?? "text").toLowerCase());
}

/** How long an automatic scroll keeps its card in place while late content above it loads (checks, quiz). */
export const ANCHOR_MS = 6000;

/**
 * After an automatic scroll, content above the card can still grow (the on-device check, the quiz), pushing
 * the card down. Keep it in place for a short while, unless the person has touched the page or is typing.
 */
export function anchorHolds(s: { anchorAt: number; now: number; lastInteractionAt: number; focusEditable: boolean }): boolean {
  return s.now - s.anchorAt <= ANCHOR_MS && s.lastInteractionAt <= s.anchorAt && !s.focusEditable;
}

/** How long the page's own smooth scroll can keep firing scroll events (it usually ends sooner, at scrollend). */
export const OWN_SCROLL_MS = 1500;
/** An instant scroll's event comes on the next frame or so. */
export const OWN_INSTANT_SCROLL_MS = 150;
/** A scroll this soon after the page changed size is the browser keeping content in place, not the person. */
export const LAYOUT_SCROLL_MS = 120;

/** How far (px) the page may sit off its own scroll's path before the person is taken to be moving it. */
export const OWN_SCROLL_SLACK_PX = 16;

/**
 * The page's last size change, as a size observer sees it: when, and where the page was scrolled at that moment.
 * The browser's own adjustment for a size change (scroll anchoring, or clamping when the page got shorter) is
 * made during layout, before size observers run, so the observer already reads the adjusted position. The
 * scroll event for that adjustment reports that same position; anywhere else is the person moving the page.
 */
export type LayoutShift = { at: number; y: number };
export const NO_LAYOUT_SHIFT: LayoutShift = { at: -Infinity, y: 0 };

/** Is this scroll the browser's adjustment for the last size change (just after it, at the position measured then)? */
function browserAdjusting(now: number, y: number, layout: LayoutShift): boolean {
  return now - layout.at <= LAYOUT_SCROLL_MS && Math.abs(y - layout.y) <= OWN_SCROLL_SLACK_PX;
}

/** The page's own scroll: when it started, until when it may still be moving, and from where to where (scrollY). */
export type OwnScroll = { start: number; until: number; from: number; to: number };

/**
 * A scroll counts as the person using the page, except: right after the page changed size, at the position
 * measured then (the browser keeping content in place; any other position in that moment is still the person), or while the page's own scroll is moving and the page is
 * still on its way from start to target. Off that path (a scrollbar drag the other way, or past the
 * target) it is the person. When the page changes size mid-scroll, the caller re-aims the path
 * (rebaseOwnScroll), so the check keeps working instead of switching off.
 */
export function scrollIsPersons(s: { now: number; y: number; own: OwnScroll | null; layout: LayoutShift }): boolean {
  if (browserAdjusting(s.now, s.y, s.layout)) return false;
  const own = s.own;
  if (!own || s.now > own.until) return true;
  const lo = Math.min(own.from, own.to) - OWN_SCROLL_SLACK_PX;
  const hi = Math.max(own.from, own.to) + OWN_SCROLL_SLACK_PX;
  return s.y < lo || s.y > hi;
}

/**
 * The page's own scroll has ended (scrollend). Ending away from its (re-aimed) target means the person stopped
 * or moved it, unless it ended right after a size change at the position measured then (the browser's adjustment).
 */
export function ownScrollEndedByPerson(s: { y: number; own: OwnScroll; layout: LayoutShift; now: number }): boolean {
  if (browserAdjusting(s.now, s.y, s.layout)) return false;
  return Math.abs(s.y - s.own.to) > OWN_SCROLL_SLACK_PX;
}

/**
 * Did the page's own scroll arrive where it was going? A scroll still between start and target when its time is
 * up was stopped (a scrollbar drag the same way looks like the page's own scroll until then).
 */
export function ownScrollArrived(s: { y: number; own: OwnScroll }): boolean {
  return Math.abs(s.y - s.own.to) <= OWN_SCROLL_SLACK_PX;
}

/**
 * The page changed size while its own scroll was moving: content above the target grew or shrank, and the
 * browser shifted the view. Re-aim the path from where the page is now to where the target sits now.
 */
export function rebaseOwnScroll(own: OwnScroll, at: { y: number; to: number }): OwnScroll {
  return { ...own, from: at.y, to: at.to };
}

/** Scroll for them only if they have not touched the page since they pressed the button, and are not typing. */
export function shouldAutoScroll(s: { submittedAt: number; lastInteractionAt: number; focusEditable: boolean }): boolean {
  return s.lastInteractionAt <= s.submittedAt && !s.focusEditable;
}
