// @vitest-environment jsdom
/**
 * "Walk me through it" (CareSteps.tsx, WalkThrough), against the real component with a real saved `done` record.
 * The paper-first rule holds on every screen: an AI title or "when" the second check did not certify only ever shows
 * after the paper's own words, under its "not double-checked yet" label.
 */
import { act, useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOf, type Check } from "@/lib/paperFirst";
import type { MeaningResult } from "@/lib/meaning";
import type { MeaningState } from "@/lib/meaningRun";
import { NO_DEVICE_RUN } from "@/lib/deviceRun";
import { SAMPLE_AVS } from "@/lib/sample";
import { QUIET_KINDS } from "@/lib/pip";
import { isWarning } from "@/lib/warningPin";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { CareSteps } from "./CareSteps";
import { UiLangProvider } from "./UiLang";
import { WALK_LINES } from "@/lib/walkThrough";
import { LANGUAGES } from "@/lib/schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function step(id: string, kind: VerifiedItem["kind"], quote: string, title: string, when: string): VerifiedItem {
  const start = SAMPLE_AVS.indexOf(quote);
  if (start < 0) throw new Error(`not on the sample paper: ${quote}`);
  return {
    id, kind, title, when, source_quote: quote, plain_language: `PLAIN ${title}`, why: "",
    needs_clarification: false, question_for_clinic: "", grounded: true, span: { start, end: start + quote.length },
  };
}

const ITEMS: VerifiedItem[] = [
  step("met", "medication", "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.", "AI-TITLE Start metformin", "AI-WHEN with meals"),
  step("a1c", "lab_test", "Hemoglobin A1c - due in 3 months", "AI-TITLE A1c test", "AI-WHEN in about 3 months"),
  step("eye", "referral", "Referral to Ophthalmology for diabetic eye exam. Their office will call you to schedule. If you have not heard from them in 10 days, call 404-555-0134.", "AI-TITLE Eye doctor will call", "AI-WHEN within 10 days"),
  step("walk", "self_care", "Walk 30 minutes, 5 days a week, as tolerated.", "AI-TITLE Walk 30 minutes", "AI-WHEN 5 days a week"),
  step("soda", "self_care", "Limit sugary drinks such as soda and sweet tea.", "AI-TITLE Cut back on soda", "AI-WHEN Every day"),
  step("w911", "warning_sign", "Call 911 or go to the nearest emergency room if you have chest pain, trouble breathing, or sudden weakness on one side of your body.", "AI-TITLE Chest pain", ""),
];

const care: CarePlanResponse = {
  source_text: SAMPLE_AVS, source_kind: "text", items: ITEMS, refused: [], model: "test", has_warning_signs: true,
  questions_for_doctor: [], not_in_document: [], stats: { extracted: ITEMS.length, grounded: ITEMS.length, refused: 0, ms: 1000 },
};

const result = (id: string, r: Partial<MeaningResult>): MeaningResult => ({
  id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "unclear", what_differs: "", certified: false, ...r,
});

let host: HTMLDivElement;
let root: Root;
let calls: [string, boolean][];
let spoken: string[];

/** CareSteps with the saved `done` record held the way CarePlanTool holds it. */
function Harness({ meaning, language }: { meaning: MeaningState; language: string }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const checkFor = (id: string): Check => (meaning.status === "done" ? checkOf(meaning.byId[id]) : "unchecked");
  return (
    <CareSteps care={care} items={ITEMS} removedItems={[]} checkFor={checkFor} meaning={meaning} deviceRun={NO_DEVICE_RUN}
      deviceStatus="idle" done={done} language={language} photo={null} simpler={{ ok: false, onClick: () => {} }}
      onDone={(id, v) => { calls.push([id, v]); setDone((d) => ({ ...d, [id]: v })); }} onRemove={() => {}} onUndoRemove={() => {}} />
  );
}

function render(o: { meaning?: MeaningState; language?: string } = {}) {
  act(() => root.render(<Harness meaning={o.meaning ?? { status: "idle", byId: {} }} language={o.language ?? "English"} />));
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T & Element>(sel) as unknown as T;
const click = (el: Element | null) => { expect(el, "element to click").not.toBeNull(); act(() => (el as HTMLElement).click()); };
const open = () => click(q("[data-walk-open]"));
const card = () => q<HTMLElement>("[data-walk-step]");
const shownId = () => card()?.getAttribute("data-walk-step") ?? null;
const listOrder = () => [...host.querySelectorAll("li[data-step]")].map((li) => li.getAttribute("data-step"));

beforeEach(() => {
  calls = [];
  spoken = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("speechSynthesis", { speak: vi.fn((u: { text: string }) => spoken.push(u.text)), cancel: vi.fn() });
  vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; rate = 1; onend: unknown; onerror: unknown; constructor(public text: string) {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("order and count", () => {
  it("walks every step once, in the list's own order, with Step n of total", () => {
    render();
    const rows = listOrder();
    expect(rows).toHaveLength(ITEMS.length);
    open();
    const seen: string[] = [];
    for (let n = 1; n <= rows.length; n++) {
      expect(q("[data-walk-progress]").textContent).toBe(`Step ${n} of ${rows.length}`);
      seen.push(shownId()!);
      click(q("[data-walk-not-yet]"));
    }
    expect(seen).toEqual(rows);
    expect(q("[data-walk-end]")).not.toBeNull();
    expect(q("[data-walk-end]").textContent).toContain(`0 of ${rows.length} marked done.`);
  });

  it("starts at the warning sign, which the list pins first", () => {
    render();
    open();
    expect(shownId()).toBe("w911");
  });
});

describe("Done, Not yet, Ask a person", () => {
  it("Done marks the step done in the same saved record as the list's tick, and moves on", () => {
    render();
    open();
    const first = shownId()!;
    click(q("[data-walk-done]"));
    expect(calls).toEqual([[first, true]]);
    expect(shownId()).not.toBe(first);
    click(q("[data-walk-exit]"));
    const tick = host.querySelector<HTMLInputElement>(`li[data-step="${first}"] input[type="checkbox"]`)!;
    expect(tick.checked).toBe(true);
  });

  it("Not yet moves on and leaves the step open", () => {
    render();
    open();
    const first = shownId()!;
    click(q("[data-walk-not-yet]"));
    expect(calls).toEqual([]);
    expect(shownId()).not.toBe(first);
    click(q("[data-walk-exit]"));
    expect(host.querySelector<HTMLInputElement>(`li[data-step="${first}"] input[type="checkbox"]`)!.checked).toBe(false);
  });

  it("a step already done says so and can be undone the same way", () => {
    render();
    open();
    const first = shownId()!;
    click(q("[data-walk-done]"));
    click(q("[data-walk-previous]"));
    expect(shownId()).toBe(first);
    expect(q("[data-walk-done-status]").textContent).toContain("Marked done");
    click(q("[data-walk-done-status] button"));
    expect(calls.at(-1)).toEqual([first, false]);
    expect(q("[data-walk-done-status]")).toBeNull();
  });

  it("Ask a person opens the pharmacist question, built from the paper's words, on a medicine step", () => {
    render();
    open();
    while (shownId() !== "met") click(q("[data-walk-not-yet]"));
    const ask = q<HTMLButtonElement>("[data-walk-ask]");
    const panel = document.getElementById(ask.getAttribute("aria-controls")!)!;
    expect(ask.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    click(ask);
    expect(ask.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector("[data-ask-person]")!.getAttribute("data-ask-person")).toBe("pharmacist");
    expect(panel.querySelector("[data-ask-question]")!.textContent).toContain(ITEMS[0].source_quote);
    expect(panel.textContent).not.toContain("AI-TITLE");
    expect(panel.querySelector("[data-walk-211]")).not.toBeNull();
  });

  it("Ask a person on a warning sign repeats only what the paper says to do, never a later question", () => {
    render();
    open();
    click(q("[data-walk-ask]"));
    const panel = q("[data-walk-ask-panel]");
    expect(panel.textContent).toContain("call your clinic, or call 911");
    expect(panel.querySelector("[data-walk-211]")).toBeNull();
    expect(panel.querySelector("[data-ask-question]")).toBeNull();
  });

  it("a certified step still offers a person: call your clinic, and 211", () => {
    render({ meaning: { status: "done", byId: Object.fromEntries(ITEMS.map((i) => [i.id, result(i.id, { certified: true, model_verdict: "same" })])) } });
    open();
    while (shownId() !== "eye") click(q("[data-walk-not-yet]"));
    click(q("[data-walk-ask]"));
    expect(q("[data-walk-ask-panel]").textContent).toContain("Call your clinic");
    expect(q("[data-walk-211]")).not.toBeNull();
  });
});

describe("checks that land while walking (Codex review)", () => {
  it("a step a late check moves to an earlier group is still visited, exactly once", () => {
    render();
    open();
    const seen: string[] = [shownId()!];
    // "Limit sugary drinks" names no time, so it starts under "Check the date on your paper" (last). Certified, its
    // AI "when" ("Every day") moves it ahead of steps not yet seen.
    while (shownId() !== "a1c") { click(q("[data-walk-not-yet]")); seen.push(shownId()!); }
    render({ meaning: { status: "done", byId: { soda: result("soda", { certified: true, model_verdict: "same" }) } } });
    while (q("[data-walk-end]") === null) { click(q("[data-walk-not-yet]")); if (shownId()) seen.push(shownId()!); }
    expect(seen.filter((id) => id === "soda")).toHaveLength(1);
    expect(new Set(seen).size).toBe(ITEMS.length);
    expect(seen).toHaveLength(ITEMS.length);
  });

  it("stops reading aloud when the step's check changes mid-reading", () => {
    const certified = { status: "done" as const, byId: Object.fromEntries(ITEMS.map((i) => [i.id, result(i.id, { certified: true, model_verdict: "same" })])) };
    render({ meaning: certified });
    open();
    while (shownId() !== "eye") click(q("[data-walk-not-yet]"));
    click(q("[data-walk-speak]"));
    expect(spoken.join(" ")).toContain("PLAIN AI-TITLE Eye doctor will call");
    const cancels = (globalThis.speechSynthesis.cancel as ReturnType<typeof vi.fn>).mock.calls.length;
    render({ meaning: { status: "done", byId: { ...certified.byId, eye: result("eye", { flagged: true, model_verdict: "different" }) } } });
    expect((globalThis.speechSynthesis.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(cancels);
    expect(q("[data-walk-speak]").getAttribute("aria-pressed")).toBe("false");
  });

  it("Pip's cheer for a step just done never shows on the next step's screen", () => {
    render();
    open();
    while (shownId() !== "walk") click(q("[data-walk-not-yet]"));
    click(q("[data-walk-done]"));
    expect(card().querySelector('[data-pip="cheer"]')).toBeNull();
    expect(card().textContent).not.toContain("Nice, that's done");
  });

  it("says Done and Undo out loud, and keeps focus on the step after Undo", async () => {
    vi.useFakeTimers();
    render();
    open();
    click(q("[data-walk-done]"));
    act(() => { vi.advanceTimersByTime(100); });
    expect(q("[data-walk-status]").textContent).toBe("Marked done");
    click(q("[data-walk-previous]"));
    const undo = q<HTMLButtonElement>("[data-walk-done-status] button");
    undo.focus();
    expect(document.activeElement).toBe(undo);
    click(undo);
    act(() => { vi.advanceTimersByTime(100); });
    expect(q("[data-walk-status]").textContent).toBe("Not done after all");
    expect(document.activeElement).toBe(q("[data-walk-heading]"));
  });
});

describe("round 2 (Codex review)", () => {
  it("opening the walk stops a list row being read aloud", () => {
    render();
    const row = host.querySelector<HTMLLIElement>('li[data-step="eye"]')!;
    click(row.querySelector("button[aria-expanded]"));
    const speak = [...row.querySelectorAll("button")].find((b) => b.textContent?.includes("Read aloud"))!;
    click(speak);
    expect(speak.getAttribute("aria-pressed")).toBe("true");
    const cancels = (globalThis.speechSynthesis.cancel as ReturnType<typeof vi.fn>).mock.calls.length;
    open();
    expect((globalThis.speechSynthesis.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(cancels);
    click(q("[data-walk-exit]"));
    expect(speak.getAttribute("aria-pressed")).toBe("false");
  });

  it("the warning line comes after the paper's own words, never before them", () => {
    render();
    open();
    const quote = card().querySelector("[data-lead]")!;
    const line = q("[data-walk-warning]");
    expect(quote.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks each localized line with its language, and leaves the paper's words alone", () => {
    render({ language: "Vietnamese" });
    expect(q("[data-walk-open] span").getAttribute("lang")).toBe("vi-VN");
    open();
    expect(q("[data-walk-done] span[lang]").getAttribute("lang")).toBe("vi-VN");
    expect(q("[data-walk-progress] span[lang]").getAttribute("lang")).toBe("vi-VN");
    expect(q("[data-walk-status]").getAttribute("lang")).toBe("vi-VN");
    expect(card().querySelector("[data-lead]")!.closest("[lang]")).toBeNull();
  });
});

describe("warning pin and paper-first labels", () => {
  it("shows the warning pin on a warning step, and no Pip there", () => {
    render();
    open();
    expect(card().getAttribute("data-walk-group")).toBe("warning");
    expect(q("[data-walk-heading]").textContent).toContain("Warning sign from your paper");
    expect(q("[data-walk-warning]").textContent).toContain("911");
    expect(card().querySelector("[data-pip-slot]")).toBeNull();
    click(q("[data-walk-not-yet]"));
    expect(q("[data-walk-warning]")).toBeNull();
  });

  it("never drops the not-double-checked label: AI words only after the paper's own words", () => {
    render();
    open();
    for (let n = 0; n < ITEMS.length; n++) {
      const it = ITEMS.find((i) => i.id === shownId())!;
      const block = card().querySelector("[data-lead]")!;
      expect(block.getAttribute("data-lead")).toBe("quote");
      expect(block.firstElementChild!.hasAttribute("data-paper-quote")).toBe(true);
      expect(block.firstElementChild!.textContent).toContain("Copied word for word from your paper");
      expect(block.firstElementChild!.textContent).toContain(it.source_quote);
      if (it.title.startsWith("AI-")) {
        const secondary = block.querySelector("[data-secondary]")!;
        expect(secondary.textContent).toContain("Plain words (not double-checked yet)");
        expect(secondary.textContent).toContain(it.title);
        // Outside the paper-first block, the AI's words appear nowhere on the screen.
        const outside = card().textContent!.replace(block.textContent!, "");
        expect(outside).not.toContain(it.title);
        if (it.when) expect(outside).not.toContain(it.when);
      }
      click(q("[data-walk-not-yet]"));
    }
  });

  it("a flagged step keeps its may-not-match label", () => {
    render({ meaning: { status: "done", byId: { eye: result("eye", { flagged: true, model_verdict: "different" }) } } });
    open();
    while (shownId() !== "eye") click(q("[data-walk-not-yet]"));
    expect(card().getAttribute("data-seal")).toBe("recheck");
    expect(card().querySelector("[data-secondary]")!.textContent).toContain("may not match your paper");
  });

  it("read aloud uses the paper-first lines: never the unconfirmed explanation", () => {
    render();
    open();
    while (shownId() !== "met") click(q("[data-walk-not-yet]"));
    click(q("[data-walk-speak]"));
    expect(q("[data-walk-speak]").getAttribute("aria-pressed")).toBe("true");
    expect(spoken.join(" ")).toContain(ITEMS[0].source_quote);
    expect(spoken.join(" ")).not.toContain("PLAIN");
    expect(spoken.join(" ")).not.toContain("AI-TITLE");
  });
});

describe("Pip stays quiet on medicine, lab and warning steps", () => {
  it("no bubble and no cheer or hop on a quiet screen", () => {
    render();
    open();
    for (let n = 0; n < ITEMS.length; n++) {
      const it = ITEMS.find((i) => i.id === shownId())!;
      if (QUIET_KINDS.has(it.kind) || isWarning(it)) {
        expect(card().querySelector("[data-pip-bubble]")).toBeNull();
        expect(card().querySelector('[data-pip="arrive"], [data-pip="cheer"]')).toBeNull();
      }
      click(q("[data-walk-done]"));
    }
  });
});

describe("focus and keyboard", () => {
  it("moves focus to the step heading on open and on every change, and back to the button on exit", () => {
    render();
    open();
    expect(document.activeElement).toBe(q("[data-walk-heading]"));
    expect(document.activeElement!.textContent).toContain("Step 1 of");
    click(q("[data-walk-not-yet]"));
    expect(document.activeElement).toBe(q("[data-walk-heading]"));
    expect(document.activeElement!.textContent).toContain("Step 2 of");
    click(q("[data-walk-done]"));
    expect(document.activeElement!.textContent).toContain("Step 3 of");
    click(q("[data-walk-exit]"));
    expect(q("[data-walk-through]")).toBeNull();
    expect(document.activeElement).toBe(q("[data-walk-open]"));
  });

  it("brings each step to the top of the screen, instantly", () => {
    const scrolled: unknown[] = [];
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, o?: unknown) { if (this.hasAttribute("data-walk-through")) scrolled.push(o); } as Element["scrollIntoView"];
    render();
    open();
    click(q("[data-walk-not-yet]"));
    expect(scrolled).toEqual([{ block: "start" }, { block: "start" }]);
    Element.prototype.scrollIntoView = before;
  });

  it("Escape goes back to the list", () => {
    render();
    open();
    act(() => { q("[data-walk-heading]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(q("[data-walk-through]")).toBeNull();
    expect(document.activeElement).toBe(q("[data-walk-open]"));
  });

  it("every action is a real button", () => {
    render();
    open();
    for (const sel of ["[data-walk-done]", "[data-walk-not-yet]", "[data-walk-ask]", "[data-walk-speak]", "[data-walk-exit]"]) {
      expect(q(sel).tagName, sel).toBe("BUTTON");
      expect(q(sel).getAttribute("type"), sel).toBe("button");
    }
  });
});

describe("screen only", () => {
  it("keeps the full list in the page while walking (hidden on screen, printed as usual)", () => {
    render();
    open();
    expect(q("[data-walk-away]").classList.contains("walk-away")).toBe(true);
    expect(host.querySelectorAll("li[data-step]")).toHaveLength(ITEMS.length);
    click(q("[data-walk-exit]"));
    expect(q("[data-walk-away]")).toBeNull();
  });

  it("the stylesheet hides the walk-through in print and drops its slide under reduced motion", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/@media print\s*{[^}]*\.walk-away\s*{\s*display:\s*block !important;\s*}\s*\.walk-through\s*{\s*display:\s*none !important;/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.walk-card\s*{\s*animation:\s*none !important;/);
  });
});

describe("languages", () => {
  it("speaks the person's language on its own lines", () => {
    render({ language: "Spanish" });
    expect(q("[data-walk-open]").textContent).toBe("Guíeme paso a paso");
    open();
    expect(q("[data-walk-progress]").textContent).toBe(`Paso 1 de ${ITEMS.length}`);
    expect(q("[data-walk-done]").textContent).toContain("Hecho");
  });
});

describe("the walk-through's warning lines keep their English beside them until reviewed (Codex review of PR 93, round 4)", () => {
  const beside = (el: Element) => [...el.querySelectorAll('[data-english-beside][lang="en"]')].map((x) => x.textContent?.trim() ?? "").join(" ");
  for (const lang of LANGUAGES.filter((l) => l !== "English")) {
    it(lang, () => {
      render({ language: lang });
      open();
      expect(card().getAttribute("data-walk-group")).toBe("warning");
      const warning = q("[data-walk-warning]");
      expect(warning.textContent).toContain(WALK_LINES[lang].warningDo);
      expect(beside(warning)).toContain(WALK_LINES.English.warningDo);
      expect(beside(q("[data-walk-heading]"))).toContain(WALK_LINES.English.warningLabel);
      // The same directive in the Ask a person panel.
      expect(beside(q("[data-walk-ask-panel]"))).toContain(WALK_LINES.English.warningDo);
    });
  }

  it("a step's time group that is a safety line (Right away) keeps its English on the walk-through card", () => {
    // The paper's STOP list: a stop with no time words starts now, so this step is in the "Right away" group.
    const stop = step("ibu", "medication", "ibuprofen (ADVIL) 200 mg tablet. Avoid NSAIDs due to kidney function.", "AI-TITLE Stop ibuprofen", "");
    const items = [...ITEMS, stop];
    // Inside the language section, as CarePlanTool renders it (the app's own words come from the provider).
    act(() => root.render(<UiLangProvider language="Spanish">
      <CareSteps care={{ ...care, items }} items={items} removedItems={[]} checkFor={() => "unchecked"} meaning={{ status: "idle", byId: {} }} deviceRun={NO_DEVICE_RUN}
        deviceStatus="idle" done={{}} language="Spanish" photo={null} simpler={{ ok: false, onClick: () => {} }}
        onDone={() => {}} onRemove={() => {}} onUndoRemove={() => {}} />
    </UiLangProvider>));
    open();
    const seen: string[] = [];
    for (let n = 0; n < items.length; n++) {
      const when = q("[data-walk-when]");
      if (card().getAttribute("data-walk-group") === "today") seen.push(beside(when));
      click(q("[data-walk-not-yet]"));
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const b of seen) expect(b).toContain("Right away");
  });

  it("English shows the warning line once, with nothing beside it", () => {
    render();
    open();
    expect(q("[data-walk-warning]").querySelector("[data-english-beside]")).toBeNull();
  });
});
