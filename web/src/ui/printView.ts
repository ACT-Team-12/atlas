import { canPrintFromPage } from "@/lib/printSupport";

/** The print-only sheets: the class that shows one while printing, and its element in <body>. */
export type PrintTarget =
  | { cls: "print-sheet"; sheetId: "atlas-sheet" }
  | { cls: "print-prep"; sheetId: "atlas-prep-sheet" }
  | { cls: "print-session"; sheetId: "atlas-session-sheet" };

export const HANDOFF_SHEET: PrintTarget = { cls: "print-sheet", sheetId: "atlas-sheet" };
export const PREP_SHEET: PrintTarget = { cls: "print-prep", sheetId: "atlas-prep-sheet" };
export const SESSION_SHEET: PrintTarget = { cls: "print-session", sheetId: "atlas-session-sheet" };

/** Fired when a sheet is shown on screen instead of printed; PrintViewBar listens for it. */
export const PRINT_VIEW_EVENT = "atlas:print-view";

export function canPrintHere(): boolean {
  return typeof navigator === "undefined" ? true : canPrintFromPage(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

let returnY = 0;

/**
 * Prints the sheet where the browser can. Where it can't (Chrome on iPhone, in-app browsers), shows the sheet on screen
 * as the whole page instead, with PrintViewBar on top saying how to print it from the browser's own menu: that menu's
 * Print then captures the sheet either way (the same classes keep the print styles pointed at it).
 */
export function printOrView(t: PrintTarget): "print" | "view" {
  const root = document.documentElement;
  if (canPrintHere()) {
    const done = () => { root.classList.remove(t.cls); window.removeEventListener("afterprint", done); };
    root.classList.add(t.cls);
    window.addEventListener("afterprint", done);
    window.print();
    return "print";
  }
  returnY = window.scrollY;
  root.classList.add(t.cls, "print-view");
  document.getElementById(t.sheetId)?.removeAttribute("aria-hidden"); // it is the page now, so it is read too
  window.scrollTo(0, 0);
  window.dispatchEvent(new CustomEvent<PrintTarget>(PRINT_VIEW_EVENT, { detail: t }));
  return "view";
}

/** Back to the app, where the person was. */
export function closePrintView(t: PrintTarget) {
  const root = document.documentElement;
  root.classList.remove(t.cls, "print-view");
  document.getElementById(t.sheetId)?.setAttribute("aria-hidden", "true");
  window.scrollTo(0, returnY);
}
