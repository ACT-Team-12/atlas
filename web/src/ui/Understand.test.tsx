// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { Understand } from "./Understand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options = ["Take it with food", "Take it without food", "Take it at bedtime"];
const care = { source_text: "Take it with food every morning." } as unknown as CarePlanResponse;
const items = [{ id: "s1", kind: "medication", title: "Your pill", source_quote: "Take it with food" }] as unknown as VerifiedItem[];

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/transcribe") return new Response(JSON.stringify({ enabled: true, languages: ["English"] }));
    return new Response(JSON.stringify({
      questions: [{ item_id: "s1", question: "How do you take it?", options, correct: 0, answer_quote: "Take it with food", span: { start: 0, end: 17 } }],
      dropped: [], model: "m", ms: 1, answer_token: "tok",
    }));
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const buttons = () => [...host.querySelectorAll("button")];
const byText = (t: string) => buttons().find((b) => b.textContent?.trim() === t);
const recorded = () => buttons().filter((b) => b.getAttribute("aria-pressed") === "true").length;
async function type(text: string) {
  const ta = host.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(ta, text); ta.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(b: HTMLElement | undefined) {
  expect(b).toBeTruthy();
  await act(async () => { b!.click(); });
}

describe("speech never grades (design decision, 2026-10-02)", () => {
  it("a spoken or typed answer only suggests; nothing is recorded until the person taps", async () => {
    await act(async () => { root.render(<Understand care={care} items={items} language="English" />); });
    await click(byText("Quiz me on my paper"));
    await type("take it with food");
    await click(byText("Check my answer"));
    expect(host.textContent).toContain(`Did you mean: "${options[0]}"?`);
    expect(recorded()).toBe(0);
    expect(host.textContent).not.toContain("matches your paper");

    await click(byText("No"));
    expect(recorded()).toBe(0);
    expect(host.textContent).toContain("Tap the answer you meant");

    await click(byText("Check my answer"));
    await click(byText("Yes"));
    expect(recorded()).toBe(1);
    expect(host.textContent).toContain("Yes, that matches your paper.");
  });

  it("an answer that is not a near-exact restatement suggests nothing and records nothing", async () => {
    await act(async () => { root.render(<Understand care={care} items={items} language="English" />); });
    await click(byText("Quiz me on my paper"));
    await type("decrease it with food");
    await click(byText("Check my answer"));
    expect(host.textContent).not.toContain("Did you mean");
    expect(host.textContent).toContain("Tap the answer closest to what you said");
    expect(recorded()).toBe(0);
  });
});
