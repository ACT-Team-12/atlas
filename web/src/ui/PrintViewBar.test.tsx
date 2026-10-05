// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrintViewBar } from "./PrintViewBar";
import { HANDOFF_SHEET, PRINT_START_MS, printOrView, printPageOr } from "./printView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHROME_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const ANDROID_GOOGLE_APP = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 GSA/16.30.42";

let root: Root;
let host: HTMLDivElement;
let sheet: HTMLDivElement;
let trigger: HTMLButtonElement;
const html = () => document.documentElement;
const bar = () => document.getElementById("print-view-bar")!;
const shown = () => !!bar().getAttribute("data-print-view");
const button = (t: string) => [...bar().querySelectorAll("button")].find((b) => b.textContent === t);

function as(ua: string) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
}

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("scrollTo", vi.fn());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<PrintViewBar />));
  sheet = document.createElement("div"); // added after the bar, as the portaled sheets are
  sheet.id = "atlas-sheet";
  sheet.setAttribute("aria-hidden", "true");
  document.body.appendChild(sheet);
  trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sheet.remove();
  trigger.remove();
  html().className = "";
  vi.unstubAllGlobals();
});

// Akhil, Oct 4: Print and Handoff did nothing in Chrome on his iPhone. The sheet is now always shown first.
describe("the sheet view", () => {
  it("Chrome on iPhone: the sheet becomes the page; the bar says to use Share or the menu, and offers no dead Print button", () => {
    as(CHROME_IPHONE);
    act(() => printOrView(HANDOFF_SHEET));
    expect(window.print).not.toHaveBeenCalled();
    expect(html().classList.contains("print-view")).toBe(true);
    expect(html().classList.contains("print-sheet")).toBe(true);
    expect(sheet.hasAttribute("aria-hidden")).toBe(false); // the sheet is the page now, so screen readers read it
    expect(bar().getAttribute("data-print-how")).toBe("ios-menu");
    expect(bar().textContent).toContain("then Print");
    expect(button("Print")).toBeUndefined();
    expect(document.activeElement?.id).toBe("print-view-title");
  });

  it("the bar sits before the sheet in the page, so the sticky bar is above it and never covers it", () => {
    as(CHROME_IPHONE);
    act(() => printOrView(HANDOFF_SHEET));
    expect(bar().compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar().className).toContain("sticky");
  });

  it("Safari: the sheet first, with a Print button that prints it", () => {
    as(SAFARI_IPHONE);
    act(() => printOrView(HANDOFF_SHEET));
    expect(window.print).not.toHaveBeenCalled();
    expect(bar().getAttribute("data-print-how")).toBe("print");
    act(() => button("Print")!.click());
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(html().classList.contains("print-sheet")).toBe(true); // still set, so the print captures only the sheet
  });

  it("an app's own browser (the Google app on Android): says to open the page in the phone's browser", () => {
    as(ANDROID_GOOGLE_APP);
    act(() => printOrView(HANDOFF_SHEET));
    expect(bar().getAttribute("data-print-how")).toBe("open-browser");
    expect(bar().textContent).toContain("Open in browser");
    expect(button("Print")).toBeUndefined();
  });

  it("Done goes back: classes off, the sheet hidden again, the bar empty, focus back on the button used", () => {
    as(CHROME_IPHONE);
    act(() => printOrView(HANDOFF_SHEET));
    act(() => button("Done")!.click());
    expect(html().classList.contains("print-view")).toBe(false);
    expect(html().classList.contains("print-sheet")).toBe(false);
    expect(sheet.getAttribute("aria-hidden")).toBe("true");
    expect(shown()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape goes back too, and returns focus", () => {
    as(CHROME_IPHONE);
    act(() => printOrView(HANDOFF_SHEET));
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(html().classList.contains("print-view")).toBe(false);
    expect(shown()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("with smooth scroll on, Done jumps back through Lenis, so its own target can't carry the page elsewhere", () => {
    as(CHROME_IPHONE);
    const lenis = { resize: vi.fn(), scrollTo: vi.fn() };
    (window as unknown as { __lenis?: unknown }).__lenis = lenis;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 5338 });
    try {
      act(() => printOrView(HANDOFF_SHEET));
      expect(lenis.scrollTo).toHaveBeenLastCalledWith(0, { immediate: true, force: true });
      act(() => button("Done")!.click());
      expect(lenis.resize).toHaveBeenCalled();
      expect(lenis.scrollTo).toHaveBeenLastCalledWith(5338, { immediate: true, force: true });
      expect(window.scrollTo).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as { __lenis?: unknown }).__lenis;
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    }
  });

  it("focus goes back to the button that was tapped, even when a tap left focus somewhere else (Codex round 2)", () => {
    as(CHROME_IPHONE);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    act(() => { printOrView(HANDOFF_SHEET, trigger); });
    act(() => button("Done")!.click());
    expect(document.activeElement).toBe(trigger);
    field.remove();
  });

  it("with no sheet on the page, nothing is hidden behind an empty view", () => {
    as(CHROME_IPHONE);
    sheet.remove();
    let shownView = true;
    act(() => { shownView = printOrView(HANDOFF_SHEET); });
    expect(shownView).toBe(false);
    expect(html().classList.contains("print-view")).toBe(false);
    expect(shown()).toBe(false);
  });

  it("a sheet that goes away before the bar starts watching still closes the view (Codex round 2)", () => {
    as(CHROME_IPHONE);
    act(() => { printOrView(HANDOFF_SHEET); sheet.remove(); });
    expect(html().classList.contains("print-view")).toBe(false);
    expect(shown()).toBe(false);
  });

  it("if the sheet goes away while shown (the plan went out of date), it goes back instead of leaving a blank page", async () => {
    as(CHROME_IPHONE);
    act(() => printOrView(HANDOFF_SHEET));
    await act(async () => { sheet.remove(); await new Promise((r) => setTimeout(r, 0)); });
    expect(html().classList.contains("print-view")).toBe(false);
    expect(shown()).toBe(false);
  });
});

// "Print for the next visit" prints the page itself, and falls back to the sheet when the browser doesn't print.
describe("printPageOr", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("a browser that prints (beforeprint fires) prints the page and shows no sheet", () => {
    as(SAFARI_IPHONE);
    vi.stubGlobal("print", vi.fn(() => window.dispatchEvent(new Event("beforeprint"))));
    vi.useFakeTimers();
    act(() => printPageOr(HANDOFF_SHEET, trigger));
    act(() => { vi.advanceTimersByTime(PRINT_START_MS + 50); });
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(html().classList.contains("print-view")).toBe(false);
  });

  it("a browser that looks able but never starts a print (an app's browser) gets the sheet after a moment", () => {
    as(SAFARI_IPHONE);
    vi.useFakeTimers();
    act(() => printPageOr(HANDOFF_SHEET, trigger));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(html().classList.contains("print-view")).toBe(false);
    act(() => { vi.advanceTimersByTime(PRINT_START_MS + 50); });
    expect(html().classList.contains("print-view")).toBe(true);
    expect(shown()).toBe(true);
    // The print just did nothing here, so no Print button wired to it again (Codex round 3).
    expect(bar().getAttribute("data-print-how")).toBe("open-browser");
    expect(button("Print")).toBeUndefined();
  });

  it("two taps during the wait open one sheet, and Done still goes back to where the person was", () => {
    as(SAFARI_IPHONE);
    vi.useFakeTimers();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 4000 });
    try {
      act(() => printPageOr(HANDOFF_SHEET, trigger));
      act(() => { vi.advanceTimersByTime(PRINT_START_MS / 2); });
      act(() => printPageOr(HANDOFF_SHEET, trigger));
      act(() => { vi.advanceTimersByTime(PRINT_START_MS + 50); });
      expect(shown()).toBe(true);
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 }); // the sheet view is at the top
      act(() => { vi.advanceTimersByTime(PRINT_START_MS * 2); }); // no stale timer reopens it or resets the way back
      act(() => button("Done")!.click());
      expect(window.scrollTo).toHaveBeenLastCalledWith(0, 4000);
      expect(html().classList.contains("print-view")).toBe(false);
    } finally {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    }
  });

  it("Handoff during the wait cancels the pending fallback, so Done isn't followed by a second sheet", () => {
    as(SAFARI_IPHONE);
    vi.useFakeTimers();
    act(() => printPageOr(HANDOFF_SHEET, trigger));
    act(() => { printOrView(HANDOFF_SHEET, trigger); });
    expect(bar().getAttribute("data-print-how")).toBe("print");
    act(() => button("Done")!.click());
    act(() => { vi.advanceTimersByTime(PRINT_START_MS + 50); });
    expect(html().classList.contains("print-view")).toBe(false);
    expect(shown()).toBe(false);
  });

  it("a browser known not to print (Chrome on iPhone) gets the sheet straight away, no dead print call", () => {
    as(CHROME_IPHONE);
    act(() => printPageOr(HANDOFF_SHEET, trigger));
    expect(window.print).not.toHaveBeenCalled();
    expect(html().classList.contains("print-view")).toBe(true);
  });
});
