import { canPrintFromPage } from "@/lib/printSupport";

/** The print-only sheets: the class that shows one while printing, and its element in <body>. */
export type PrintTarget =
  | { cls: "print-sheet"; sheetId: "atlas-sheet" }
  | { cls: "print-prep"; sheetId: "atlas-prep-sheet" }
  | { cls: "print-session"; sheetId: "atlas-session-sheet" };

export const HANDOFF_SHEET: PrintTarget = { cls: "print-sheet", sheetId: "atlas-sheet" };
export const PREP_SHEET: PrintTarget = { cls: "print-prep", sheetId: "atlas-prep-sheet" };
export const SESSION_SHEET: PrintTarget = { cls: "print-session", sheetId: "atlas-session-sheet" };

/** Fired when a sheet is shown on screen; PrintViewBar listens for it. */
export const PRINT_VIEW_EVENT = "atlas:print-view";

export function canPrintHere(): boolean {
  return typeof navigator === "undefined" ? true : canPrintFromPage(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

let returnY = 0;
let returnFocus: HTMLElement | null = null;

/**
 * Jump straight to y. With smooth scroll on (motion/SmoothScroll.tsx), Lenis keeps its own target and would carry the
 * page back to it after a plain window.scrollTo, so jump through Lenis, after it re-measures the page that just changed
 * height (found in a real browser: Done landed 3,700px away from where the person was).
 */
function jumpTo(y: number) {
  const lenis = (window as unknown as { __lenis?: { resize: () => void; scrollTo: (t: number, o: { immediate: boolean; force: boolean }) => void } }).__lenis;
  if (lenis) { lenis.resize(); lenis.scrollTo(y, { immediate: true, force: true }); }
  else window.scrollTo(0, y);
}

/**
 * Focus el once it can take focus. On phones the Handoff and Print buttons sit in a bar that is hidden until the plan
 * is back on screen (an IntersectionObserver in CarePlanTool), so try for a few frames. Stop if the person has moved
 * focus somewhere themselves.
 */
function focusWhenShown(el: HTMLElement) {
  let frames = 0;
  const attempt = () => {
    if (!el.isConnected) return;
    const a = document.activeElement;
    // Done itself still has focus on the first try; anything else focused means the person moved on.
    if (a && a !== document.body && a !== el && !a.closest("#print-view-bar")) return;
    el.focus({ preventScroll: true });
    if (document.activeElement !== el && ++frames < 30) requestAnimationFrame(attempt);
  };
  attempt();
}

/**
 * Shows the sheet on screen as the whole page, under PrintViewBar, which prints it where the browser can and otherwise
 * says how (Share or ⋯ then Print on iPhone browsers; open in the phone's browser from an app). Always the sheet first,
 * never a bare window.print: that does nothing in Chrome on iPhone and in apps' browsers, and no check can spot every
 * such browser (Codex review). The sheet's print class stays on while it is shown, so any print captures only it.
 */
export function printOrView(t: PrintTarget) {
  const root = document.documentElement;
  returnY = window.scrollY;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.classList.add(t.cls, "print-view");
  document.getElementById(t.sheetId)?.removeAttribute("aria-hidden"); // it is the page now, so it is read too
  jumpTo(0);
  window.dispatchEvent(new CustomEvent<PrintTarget>(PRINT_VIEW_EVENT, { detail: t }));
}

/** Back to the app, where the person was, with focus back on the button they used. */
export function closePrintView(t: PrintTarget) {
  const root = document.documentElement;
  root.classList.remove(t.cls, "print-view");
  document.getElementById(t.sheetId)?.setAttribute("aria-hidden", "true");
  jumpTo(returnY);
  if (returnFocus) focusWhenShown(returnFocus);
  returnFocus = null;
}
