// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanLoop } from "./Hero";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<PlanLoop />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

// The hero card's height changed with each turn, the browser nudged the page to keep content in place, and that scroll
// counted as the person: a phone left alone never opened its plan (Akhil, Oct 4, measured on the live site).
describe("hero plan loop keeps one height", () => {
  const items = () => [...host.querySelectorAll<HTMLElement>("[data-plan-loop] > [data-loop-item]")];

  it("renders every card in the same grid cell, all the time, so the tallest sets the height", () => {
    for (let turn = 0; turn < 4; turn++) {
      expect(items()).toHaveLength(3);
      for (const el of items()) expect(el.className).toMatch(/\bcol-start-1\b.*\brow-start-1\b/);
      act(() => { vi.advanceTimersByTime(2600); });
    }
  });

  it("shows exactly one card; the others are invisible and hidden from screen readers", () => {
    for (let turn = 0; turn < 4; turn++) {
      const on = items().filter((el) => el.dataset.loopItem === "on");
      expect(on).toHaveLength(1);
      expect(on[0].getAttribute("aria-hidden")).toBeNull();
      for (const el of items().filter((x) => x !== on[0])) {
        expect(el.className).toMatch(/\binvisible\b/);
        expect(el.getAttribute("aria-hidden")).toBe("true");
      }
      act(() => { vi.advanceTimersByTime(2600); });
    }
  });
});
