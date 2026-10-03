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

/** A stable name for a chosen photo file, so choosing a different photo counts as a change. */
export function photoId(f: { name: string; size: number; lastModified: number } | null): string | null {
  return f ? `${f.name}:${f.size}:${f.lastModified}` : null;
}

/** What the plan request sends for place: the device location wins, else a valid 5 digit ZIP. */
export function planPlace(hasDeviceLocation: boolean, zip: string): string {
  return hasDeviceLocation ? "device" : /^\d{5}$/.test(zip) ? zip : "";
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

/** The page's own scroll: when it started, until when it may still be moving, and from where to where (scrollY). */
export type OwnScroll = { start: number; until: number; from: number; to: number };

/**
 * A scroll counts as the person using the page, except: right after the page changed size (the browser
 * shifting the view to keep content in place), or while the page's own scroll is moving and the page is
 * still on its way from start to target. Off that path (a scrollbar drag the other way, or past the
 * target) it is the person. If the page changed size since its own scroll began, the path is unreliable,
 * so the time window alone decides.
 */
export function scrollIsPersons(s: { now: number; y: number; own: OwnScroll | null; layoutChangedAt: number }): boolean {
  if (s.now - s.layoutChangedAt <= LAYOUT_SCROLL_MS) return false;
  const own = s.own;
  if (!own || s.now > own.until) return true;
  if (s.layoutChangedAt >= own.start) return false;
  const lo = Math.min(own.from, own.to) - OWN_SCROLL_SLACK_PX;
  const hi = Math.max(own.from, own.to) + OWN_SCROLL_SLACK_PX;
  return s.y < lo || s.y > hi;
}

/** The page's own scroll has ended (scrollend). Ending away from its target means the person stopped or moved it. */
export function ownScrollEndedByPerson(s: { y: number; own: OwnScroll; layoutChangedAt: number }): boolean {
  if (s.layoutChangedAt >= s.own.start) return false;
  return Math.abs(s.y - s.own.to) > OWN_SCROLL_SLACK_PX;
}

/** Scroll for them only if they have not touched the page since they pressed the button, and are not typing. */
export function shouldAutoScroll(s: { submittedAt: number; lastInteractionAt: number; focusEditable: boolean }): boolean {
  return s.lastInteractionAt <= s.submittedAt && !s.focusEditable;
}
