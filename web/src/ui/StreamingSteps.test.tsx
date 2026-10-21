// @vitest-environment jsdom
/**
 * The steps shown while the paper is still being read (StreamingSteps in CarePlanTool.tsx) are styled as warnings by the
 * same rule that pins them in "Your steps" (lib/warningPin.ts): the model's kind or the paper's own words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VerifiedItem } from "@/lib/schema";
import { isWarning } from "@/lib/warningPin";
import { StreamingSteps } from "./CarePlanTool";

vi.mock("@/lib/deviceChecker", () => ({ loadDeviceChecker: () => Promise.reject(new Error("no wasm in tests")), sameSpan: () => false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string, kind: VerifiedItem["kind"], quote: string): VerifiedItem => ({
  id, kind, title: id, when: "", source_quote: quote, plain_language: id, why: "", needs_clarification: false, question_for_clinic: "", grounded: true, span: null,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("styles a step as a warning exactly when it is pinned as one, whatever kind the model gave it", () => {
  const items = [
    item("mislabeled", "self_care", "Call 911 or go to the nearest emergency room if you have chest pain."),
    item("labeled", "warning_sign", "Call the office if your blood sugar is above 300 two times in a row."),
    item("plain", "self_care", "Walk 30 minutes, 5 days a week, as tolerated."),
    item("not-emergency", "self_care", "This is not an emergency. Call your doctor during office hours."),
  ];
  act(() => root.render(<StreamingSteps items={items} />));
  const rows = [...host.querySelectorAll("li")];
  expect(rows).toHaveLength(items.length);
  rows.forEach((li, i) => {
    const pinned = isWarning(items[i]);
    expect(li.hasAttribute("data-warning"), items[i].id).toBe(pinned);
    expect(li.className.includes("border-red"), items[i].id).toBe(pinned);
  });
  expect(rows.map((li) => li.hasAttribute("data-warning"))).toEqual([true, true, false, false]);
});
