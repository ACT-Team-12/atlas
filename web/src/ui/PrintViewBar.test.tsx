// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrintViewBar } from "./PrintViewBar";
import { HANDOFF_SHEET, printOrView } from "./printView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHROME_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

let root: Root;
let host: HTMLDivElement;
let sheet: HTMLDivElement;
const html = () => document.documentElement;
const bar = () => document.getElementById("print-view-bar");

function as(ua: string) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
}

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("scrollTo", vi.fn());
  sheet = document.createElement("div");
  sheet.id = "atlas-sheet";
  sheet.setAttribute("aria-hidden", "true");
  document.body.appendChild(sheet);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<PrintViewBar />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sheet.remove();
  html().className = "";
  vi.unstubAllGlobals();
});

// Akhil, Oct 4: Print and Handoff did nothing in Chrome on his iPhone.
describe("printing where the browser can't print from a button", () => {
  it("Chrome on iPhone: the sheet becomes the page, with a bar that says how to print it; nothing is sent to window.print", () => {
    as(CHROME_IPHONE);
    let how = "";
    act(() => { how = printOrView(HANDOFF_SHEET); });
    expect(how).toBe("view");
    expect(window.print).not.toHaveBeenCalled();
    expect(html().classList.contains("print-view")).toBe(true);
    expect(html().classList.contains("print-sheet")).toBe(true);
    expect(sheet.hasAttribute("aria-hidden")).toBe(false); // the sheet is the page now, so screen readers read it
    expect(bar()?.textContent).toContain("then Print");
    expect(document.activeElement?.id).toBe("print-view-title");
  });

  it("Done goes back: the classes are removed, the sheet is hidden again and the bar goes away", () => {
    as(CHROME_IPHONE);
    act(() => { printOrView(HANDOFF_SHEET); });
    act(() => bar()!.querySelector("button")!.click());
    expect(html().classList.contains("print-view")).toBe(false);
    expect(html().classList.contains("print-sheet")).toBe(false);
    expect(sheet.getAttribute("aria-hidden")).toBe("true");
    expect(bar()).toBeNull();
  });

  it("Escape goes back too", () => {
    as(CHROME_IPHONE);
    act(() => { printOrView(HANDOFF_SHEET); });
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(html().classList.contains("print-view")).toBe(false);
    expect(bar()).toBeNull();
  });

  it("Safari on iPhone still prints as before, with no bar", () => {
    as(SAFARI_IPHONE);
    let how = "";
    act(() => { how = printOrView(HANDOFF_SHEET); });
    expect(how).toBe("print");
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(html().classList.contains("print-view")).toBe(false);
    expect(bar()).toBeNull();
  });
});
