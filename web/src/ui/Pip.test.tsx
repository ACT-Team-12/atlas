// @vitest-environment jsdom
/**
 * Pip (Akhil's "you are here" marker) inside the real steps view and the real plan's top three. His rules: on the
 * step that matters now, in a reserved spot that never covers text; a quiet cheer when a step is done, then on to the
 * next; quiet on medicine, lab tests and warning signs; calm mode fades and never blinks; fixed lines only, read
 * through a polite live region; the SVG itself is hidden from screen readers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOf, type Check } from "@/lib/paperFirst";
import type { MeaningState } from "@/lib/meaningRun";
import { NO_DEVICE_RUN } from "@/lib/deviceRun";
import { SAMPLE_AVS } from "@/lib/sample";
import { LANGUAGES, type CarePlanResponse, type VerifiedItem } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { topResources } from "@/lib/planTop";
import { PIP_LINES } from "@/lib/pip";
import { CareSteps } from "./CareSteps";
import { TopCalls } from "./PlanStart";
import { CALM_KEY, setCalmMode } from "./Pip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function step(id: string, kind: VerifiedItem["kind"], quote: string): VerifiedItem {
  const start = SAMPLE_AVS.indexOf(quote);
  if (start < 0) throw new Error(`not on the sample paper: ${quote}`);
  return {
    id, kind, title: `TITLE ${id}`, when: "", source_quote: quote, plain_language: `PLAIN ${id}`, why: "",
    needs_clarification: false, question_for_clinic: "", grounded: true, span: { start, end: start + quote.length },
  };
}
const WALK = step("walk", "self_care", "Walk 30 minutes, 5 days a week, as tolerated.");
const SODA = step("soda", "self_care", "Limit sugary drinks such as soda and sweet tea.");
const MET = step("met", "medication", "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.");
const BMP = step("bmp", "lab_test", "Basic metabolic panel - fasting, complete within 2 weeks at any Quest or Labcorp location");
const W911 = step("w911", "warning_sign", "Call 911 or go to the nearest emergency room if you have chest pain, trouble breathing, or sudden weakness on one side of your body.");

function careWith(items: VerifiedItem[]): CarePlanResponse {
  return {
    source_text: SAMPLE_AVS, source_kind: "text", items, refused: [], model: "test", has_warning_signs: items.some((i) => i.kind === "warning_sign"),
    questions_for_doctor: [], not_in_document: [], stats: { extracted: items.length, grounded: items.length, refused: 0, ms: 1000 },
  };
}

let host: HTMLDivElement;
let root: Root;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion") && reduced, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The steps view with its own "done" state, as CarePlanTool holds it. */
function Steps({ items, meaning, language = "English", initialDone = {} }: { items: VerifiedItem[]; meaning?: MeaningState; language?: string; initialDone?: Record<string, boolean> }) {
  const [done, setDone] = useState<Record<string, boolean>>(initialDone);
  const m = meaning ?? { status: "idle", byId: {} };
  const checkFor = (id: string): Check => (m.status === "done" ? checkOf(m.byId[id]) : "unchecked");
  return (
    <CareSteps care={careWith(items)} items={items} removedItems={[]} checkFor={checkFor} meaning={m} deviceRun={NO_DEVICE_RUN}
      deviceStatus="idle" done={done} language={language} photo={null} simpler={{ ok: false, onClick: () => {} }}
      onDone={(id, v) => setDone((d) => ({ ...d, [id]: v }))} onRemove={() => {}} onUndoRemove={() => {}} />
  );
}
const render = (props: Parameters<typeof Steps>[0]) => act(() => root.render(<Steps {...props} />));
const rowOf = (id: string) => host.querySelector<HTMLLIElement>(`li[data-step="${id}"]`)!;
const pipRows = () => [...host.querySelectorAll<HTMLLIElement>("li[data-pip-here]")].map((li) => [li.dataset.step, li.dataset.pipHere]);
const bubbles = () => [...host.querySelectorAll("[data-pip-bubble]")].map((b) => b.textContent);
const live = () => host.querySelector("[data-pip-status]")!.textContent;
const greetBubble = () => host.querySelector("[data-pip-greet] [data-pip-bubble]")?.textContent ?? null;
const tick = (id: string) => act(() => { rowOf(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
const settle = (ms = 2000) => act(() => { vi.advanceTimersByTime(ms); });

describe("Pip on the steps", () => {
  it("sits on the current step (the first not done, earliest group first), says Start here, and reads it out politely", () => {
    render({ items: [SODA, WALK] });
    // walk is "5 days a week" (Every day or every week), soda names no time (Check the date): walk's group comes first.
    expect(pipRows()).toEqual([["walk", "arrive"]]);
    expect(bubbles()).toEqual(["Start here"]);
    const region = host.querySelector("[data-pip-status]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    settle();
    expect(live()).toBe("Start here");
    // Decorative to assistive tech: the slot (and the SVG in it) and the visual bubble are hidden.
    const svg = rowOf("walk").querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.closest("[data-pip-slot]")!.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("[data-pip-bubble]")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("cheers quietly when the step is marked done, then moves on to the next step", () => {
    render({ items: [WALK, SODA] });
    tick("walk");
    expect(pipRows()).toEqual([["walk", "cheer"]]);
    expect(bubbles()).toEqual(["Nice, that's done"]);
    const svg = rowOf("walk").querySelector("svg")!;
    expect(svg.dataset.face).toBe("happy");
    expect(svg.querySelector('[data-acc="flag"]')).toBeTruthy();
    settle();
    expect(pipRows()).toEqual([["soda", "arrive"]]);
    expect(bubbles()).toEqual(["Next up"]);
    settle(); // the live region speaks a moment after Pip lands
    expect(live()).toBe("Next up");
    tick("soda");
    settle();
    // Every step done: Pip goes to the heading's reserved spot.
    expect(pipRows()).toEqual([]);
    expect(host.querySelector("[data-pip-done-all]")!.textContent).toBe("All done for now");
    settle();
    expect(live()).toBe("All done for now");
  });

  it("reads the second of two quick cheers too, though the words are the same (Codex review)", () => {
    render({ items: [WALK, SODA] });
    tick("walk");
    act(() => { vi.advanceTimersByTime(400); });
    expect(live()).toBe("Nice, that's done");
    tick("soda"); // inside the first cheer's window: same words, new spot
    expect(pipRows()).toEqual([["soda", "cheer"]]);
    act(() => { vi.advanceTimersByTime(50); });
    expect(live()).toBe(""); // cleared, so the same words land as a fresh change
    act(() => { vi.advanceTimersByTime(400); });
    expect(live()).toBe("Nice, that's done");
  });

  it("is quiet on a medicine step: neutral face, no motion, no blink, no bubble, and no cheer when it is done", () => {
    render({ items: [MET, WALK] });
    // Both are daily; metformin comes first.
    expect(pipRows()).toEqual([["met", "quiet"]]);
    const marker = rowOf("met").querySelector<HTMLElement>(".pip")!;
    expect(marker.dataset.pip).toBe("quiet");
    expect(marker.hasAttribute("data-blink")).toBe(false);
    expect(rowOf("met").querySelector("svg")!.dataset.face).toBe("norm");
    expect(rowOf("met").querySelector("[data-acc]")).toBeNull();
    // Nothing on the card itself: the only bubble is the heading greeting.
    expect(rowOf("met").querySelector("[data-pip-bubble]")).toBeNull();
    expect(greetBubble()).toBe("Start here");
    tick("met");
    // No cheer on medicine: straight to the next step.
    expect(pipRows()).toEqual([["walk", "arrive"]]);
    expect(bubbles()).toEqual(["Next up"]);
  });

  it("is quiet on a lab test, and never on a warning sign (warning cards have no slot at all)", () => {
    render({ items: [W911, BMP, WALK] });
    expect(pipRows()).toEqual([["bmp", "quiet"]]);
    expect(rowOf("bmp").querySelector("[data-pip-bubble]")).toBeNull();
    expect(rowOf("w911").querySelector("[data-pip-slot]")).toBeNull();
    tick("w911");
    expect(rowOf("w911").hasAttribute("data-pip-here")).toBe(false);
  });

  it("is quiet on a step the second check disagreed with: no bubble, no cheer", () => {
    const meaning: MeaningState = { status: "done", byId: { walk: { id: "walk", flagged: true, numbers_ok: true, unexpected_numbers: [], model_verdict: "different", what_differs: "", certified: false } } };
    render({ items: [WALK, SODA], meaning });
    expect(pipRows()).toEqual([["walk", "quiet"]]);
    expect(rowOf("walk").querySelector("[data-pip-bubble]")).toBeNull();
    tick("walk");
    expect(pipRows()).toEqual([["soda", "arrive"]]);
  });

describe("the heading greeting (first current step is quiet)", () => {
  const greet = () => host.querySelector<HTMLElement>("[data-pip-greet]");
  const headingPip = () => host.querySelector<HTMLElement>("[data-pip-heading] .pip");

  it("a quiet first step: Pip says Start here once at the heading, pointing down, and the card stays quiet", () => {
    render({ items: [MET, WALK] });
    expect(greetBubble()).toBe("Start here");
    expect(greet()!.querySelector("[data-pip-bubble]")!.getAttribute("data-point")).toBe("down");
    const hp = headingPip()!;
    expect(hp.dataset.pip).toBe("arrive");
    expect(hp.hasAttribute("data-calm")).toBe(false);
    // The card: quiet Pip, neutral face, no blink, no bubble.
    expect(pipRows()).toEqual([["met", "quiet"]]);
    expect(rowOf("met").querySelector<HTMLElement>(".pip")!.hasAttribute("data-blink")).toBe(false);
    expect(rowOf("met").querySelector("svg")!.dataset.face).toBe("norm");
    expect(bubbles()).toEqual(["Start here"]);
    // Read once, politely.
    settle();
    expect(live()).toBe("Start here");
    // In a reserved slot beside the heading, in flow (not an overlay over text).
    const slot = hp.closest<HTMLElement>("[data-pip-slot]")!;
    expect(slot.className).not.toMatch(/absolute|fixed/);
    expect(slot.getAttribute("aria-hidden")).toBe("true");
  });

  it("in each of the 7 app languages, the greeting is the fixed start line", () => {
    for (const language of LANGUAGES) {
      render({ items: [MET, WALK], language });
      expect(greetBubble(), language).toBe(PIP_LINES[language].start);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });

  it("a non-quiet first step: the normal Start here on the card and no heading greeting", () => {
    render({ items: [WALK, MET] });
    expect(pipRows()).toEqual([["walk", "arrive"]]);
    expect(greet()).toBeNull();
    expect(headingPip()).toBeNull();
    expect(bubbles()).toEqual(["Start here"]);
  });

  it("is gone after the first step is marked done, and does not come back when it is unticked", () => {
    render({ items: [MET, WALK] });
    expect(greet()).not.toBeNull();
    tick("met");
    expect(greet()).toBeNull();
    expect(headingPip()).toBeNull();
    // Normal behavior: no cheer on medicine, Pip goes on to the next step with Next up.
    expect(pipRows()).toEqual([["walk", "arrive"]]);
    expect(bubbles()).toEqual(["Next up"]);
    tick("met"); // untick: back to nothing done, still no greeting (it was said once)
    expect(greet()).toBeNull();
    expect(pipRows()).toEqual([["met", "quiet"]]);
    expect(bubbles()).toEqual([]);
  });

  it("in calm mode (and under reduced motion) the greeting fades in with no hop and no blink", () => {
    reduced = true;
    render({ items: [MET, WALK] });
    const hp = headingPip()!;
    expect(hp.hasAttribute("data-calm")).toBe(true);
    expect(hp.hasAttribute("data-blink")).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    reduced = false;
    act(() => setCalmMode(true));
    try {
      render({ items: [MET, WALK] });
      expect(headingPip()!.hasAttribute("data-calm")).toBe(true);
      expect(headingPip()!.hasAttribute("data-blink")).toBe(false);
    } finally {
      act(() => setCalmMode(false));
    }
  });

  it("does not greet when a warning sign was already marked done (a saved plan is not a first view)", () => {
    render({ items: [W911, MET, WALK], initialDone: { w911: true } });
    expect(greet()).toBeNull();
    expect(pipRows()).toEqual([["met", "quiet"]]);
  });

  it("a late check that turns the first step quiet moves Start here to the heading without reading it twice (Codex review)", () => {
    render({ items: [WALK, SODA] });
    settle();
    expect(live()).toBe("Start here");
    const meaning: MeaningState = { status: "done", byId: { walk: { id: "walk", flagged: true, numbers_ok: true, unexpected_numbers: [], model_verdict: "different", what_differs: "", certified: false } } };
    render({ items: [WALK, SODA], meaning });
    expect(greetBubble()).toBe("Start here");
    expect(pipRows()).toEqual([["walk", "quiet"]]);
    for (let i = 0; i < 6; i++) { act(() => { vi.advanceTimersByTime(100); }); expect(live()).toBe("Start here"); }
  });

  it("is never on or beside the warning signs", () => {
    render({ items: [W911, MET, WALK] });
    const g = greet()!;
    expect(g).not.toBeNull();
    const warnings = host.querySelector<HTMLElement>("[data-warnings]")!;
    expect(warnings.contains(g)).toBe(false);
    expect(warnings.contains(headingPip())).toBe(false);
    expect(warnings.querySelector("[data-pip-bubble], .pip")).toBeNull();
    // Not the warning section's neighbour either: the greeting sits under "Your steps", after the trust line.
    expect(warnings.nextElementSibling?.hasAttribute("data-trust-line")).toBe(true);
    expect(g.closest("[data-pip-heading-area]")).not.toBeNull();
  });
});

  it("keeps a reserved slot on every step row, beside the text and never over it", () => {
    render({ items: [WALK, SODA, MET] });
    for (const id of ["walk", "soda", "met"]) {
      const slot = rowOf(id).querySelector<HTMLElement>("[data-pip-slot]")!;
      expect(slot, id).toBeTruthy();
      // A flex sibling of the row's text button, in flow (not an overlay), on the right edge.
      const header = slot.parentElement!;
      expect(header.lastElementChild).toBe(slot);
      expect(header.querySelector("button[aria-expanded]")).toBeTruthy();
      expect(slot.className).not.toMatch(/absolute|fixed/);
    }
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.pip-slot \{ flex: none; display: block; width: 2\.75rem; height: 3rem; \}/);
  });

  it("shows its fixed line in each of the 7 app languages", () => {
    for (const language of LANGUAGES) {
      render({ items: [WALK, SODA], language });
      expect(bubbles(), language).toEqual([PIP_LINES[language].start]);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });
});

describe("calm mode", () => {
  it("under reduced motion: Pip fades (data-calm), never blinks, and the toggle shows it is on", () => {
    reduced = true;
    render({ items: [WALK, SODA] });
    const marker = rowOf("walk").querySelector<HTMLElement>(".pip")!;
    expect(marker.hasAttribute("data-calm")).toBe(true);
    expect(marker.hasAttribute("data-blink")).toBe(false);
    const toggle = host.querySelector<HTMLButtonElement>("[data-calm-toggle]")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("the toggle still works when storage reads but cannot be written (full or private window; Codex review)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    try {
      render({ items: [WALK, SODA] });
      const toggle = host.querySelector<HTMLButtonElement>("[data-calm-toggle]")!;
      act(() => toggle.click());
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(rowOf("walk").querySelector(".pip")!.hasAttribute("data-calm")).toBe(true);
    } finally {
      setItem.mockRestore();
      act(() => setCalmMode(false)); // storage works again: back to off for the next test
    }
    expect(localStorage.getItem(CALM_KEY)).toBe("0");
  });

  it("the Calm mode toggle is saved on this device and turns the blink off", () => {
    render({ items: [WALK, SODA] });
    expect(rowOf("walk").querySelector(".pip")!.hasAttribute("data-blink")).toBe(true);
    const toggle = host.querySelector<HTMLButtonElement>("[data-calm-toggle]")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(localStorage.getItem(CALM_KEY)).toBe("1");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const marker = rowOf("walk").querySelector<HTMLElement>(".pip")!;
    expect(marker.hasAttribute("data-calm")).toBe(true);
    expect(marker.hasAttribute("data-blink")).toBe(false);
  });

  it("the stylesheet gives reduced motion no hop, no bounce and no blink, only a fade", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    const reducedBlock = block.slice(0, block.indexOf("\n}\n"));
    expect(reducedBlock).toContain(".pip .pip-eyes, .pip[data-pip] .pip-body { animation: none !important; }");
    expect(reducedBlock).toContain('.pip[data-pip="arrive"] .pip-body, .pip[data-pip="cheer"] .pip-body { animation: pip-fade 0.4s ease-out both !important; }');
    expect(reducedBlock).not.toMatch(/pip-hop|pip-cheer|pip-blink/);
    // Calm mode (the toggle) does the same through data-calm.
    expect(css).toContain(".pip[data-calm] .pip-body { animation: pip-fade 0.4s ease-out both; }");
    expect(css).toContain('.pip[data-calm] .pip-eyes, .pip[data-pip="quiet"] .pip-body, .pip[data-pip="quiet"] .pip-eyes { animation: none; }');
  });
});

describe("Pip on the plan's top three", () => {
  const PLAN = JSON.parse(readFileSync(join(process.cwd(), "../mobile/ios/ATLASTests/Fixtures/plan_sample_30303_live.json"), "utf8")) as PlanResponse;

  it("marks the first place to start, with Start here, and only that one", () => {
    act(() => root.render(<TopCalls top={topResources(PLAN)} chosen={["transport", "cost"]} language="Spanish" />));
    const cards = [...host.querySelectorAll<HTMLLIElement>("ol > li")];
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.map((c) => c.hasAttribute("data-pip-here"))).toEqual(cards.map((_, i) => i === 0));
    expect(cards[0].querySelector("[data-pip-slot] svg")).toBeTruthy();
    expect(bubbles()).toEqual([PIP_LINES.Spanish.start]);
    settle();
    expect(live()).toBe(PIP_LINES.Spanish.start);
  });

  it("does not point at a place while the plan is out of date", () => {
    act(() => root.render(<TopCalls top={topResources(PLAN)} chosen={["transport"]} language="English" off="Your answers changed" />));
    expect(host.querySelector("[data-pip-here]")).toBeNull();
    expect(bubbles()).toEqual([]);
  });
});
