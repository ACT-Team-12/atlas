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
export function printOrView(t: PrintTarget, trigger?: Element | null, opts: { printFailed?: boolean } = {}): boolean {
  cancelPendingPrint(); // a sheet is opening; an earlier Print still waiting to fall back must not open another
  // No sheet (the plan just went out of date): don't hide the app behind an empty view.
  if (!document.getElementById(t.sheetId)) return false;
  const root = document.documentElement;
  // A sheet is already showing: keep where Done goes back to (Codex round 3).
  if (root.classList.contains("print-view")) return false;
  returnY = window.scrollY;
  // The button that was tapped; a tap doesn't always focus it, so activeElement is only the fallback.
  const active = document.activeElement;
  returnFocus = trigger instanceof HTMLElement ? trigger : active instanceof HTMLElement && active !== document.body ? active : null;
  root.classList.add(t.cls, "print-view");
  document.getElementById(t.sheetId)?.removeAttribute("aria-hidden"); // it is the page now, so it is read too
  jumpTo(0);
  window.dispatchEvent(new CustomEvent<PrintViewDetail>(PRINT_VIEW_EVENT, { detail: { target: t, printFailed: !!opts.printFailed } }));
  return true;
}

/** What PrintViewBar is told: which sheet, and whether this browser was just seen not to print (so no Print button). */
export type PrintViewDetail = { target: PrintTarget; printFailed: boolean };

/** How long a print has to start before it counts as having done nothing. */
export const PRINT_START_MS = 1000;

// One print attempt at a time: a second tap is ignored while one waits, and opening a sheet cancels it (Codex rounds 3-4).
let cancelPending: (() => void) | null = null;
function cancelPendingPrint() { cancelPending?.(); cancelPending = null; }

/**
 * Print the page as it is, and if the browser turns out not to print, show `fallback` on screen instead. A browser that
 * prints fires beforeprint; one that ignores window.print (an app's browser that looks like Safari or Chrome, which no
 * user-agent check can spot) fires nothing, so after PRINT_START_MS the sheet view opens, marked as failed so it offers
 * no Print button and says to open the page in the phone's browser. Browsers already known not to print go straight
 * to the sheet.
 */
export function printPageOr(fallback: PrintTarget, trigger?: Element | null) {
  // A print is already waiting to start: a second tap must not ask the browser to print again (Codex round 4).
  if (cancelPending) return;
  if (!canPrintHere()) { printOrView(fallback, trigger); return; }
  let started = false;
  const onStart = () => { started = true; };
  const stopListening = () => { window.removeEventListener("beforeprint", onStart); window.removeEventListener("afterprint", onStart); };
  window.addEventListener("beforeprint", onStart);
  window.addEventListener("afterprint", onStart);
  const t0 = performance.now();
  window.print();
  // Where the dialog blocks the page (desktop Chrome), print() returns only after it closed: that was a print.
  // Elsewhere beforeprint can arrive a moment later (measured in Chromium: after print() returned), so wait for it.
  if (started || performance.now() - t0 > 250) { stopListening(); return; }
  const timer = window.setTimeout(() => {
    stopListening();
    cancelPending = null;
    if (!started) printOrView(fallback, trigger, { printFailed: true });
  }, PRINT_START_MS);
  cancelPending = () => { window.clearTimeout(timer); stopListening(); };
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
