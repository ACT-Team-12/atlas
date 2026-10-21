// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanResponse } from "@/lib/plan";
import { CallMe } from "./CallMe";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = {
  summary: "Get the blood test done.", steps: [], resources: {}, ask_a_person: false, ask_a_person_reason: "",
  located: { by: "none", label: "" }, stats: { candidates: 0, steps: 0, dropped_refs: 0, ms: 1 }, model: "x", speak_token: "t",
} as unknown as PlanResponse;

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, languages: ["English"] }), { status: 200 })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<CallMe plan={plan} language="English" />); await new Promise((r) => setTimeout(r, 0)); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const toggle = () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const tap = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

// Akhil, Oct 4 7:33 PM: the Call me window only closed from its own button.
describe("Call me panel", () => {
  it("a tap outside it folds it away; a tap inside it does not", () => {
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(toggle().getAttribute("aria-controls")!)!;
    tap(panel.querySelector("p")!);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    tap(document.body);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("another control's own action runs once, then the panel folds away (also for a click with no pointer, as from a keyboard or screen reader)", () => {
    const other = document.createElement("button");
    let ran = 0;
    other.addEventListener("click", () => { ran++; });
    document.body.appendChild(other);
    act(() => toggle().click());
    act(() => other.click()); // click only, no pointer events: keyboard Enter/Space and assistive technology
    expect(ran).toBe(1);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    other.remove();
  });

  it("Escape folds it away and puts focus back on its button", () => {
    act(() => toggle().click());
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });

  it("its own button still opens and closes it", () => {
    act(() => toggle().click());
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});
