// @vitest-environment jsdom
/**
 * "Your medicine changes" (MedicineChanges.tsx) against the real components: its place in "Your steps", its list
 * semantics, the strike-through said in words, the links to each step, and that no AI words ever reach it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOf, type Check } from "@/lib/paperFirst";
import type { MeaningState } from "@/lib/meaningRun";
import { NO_DEVICE_RUN } from "@/lib/deviceRun";
import { SAMPLE_AVS } from "@/lib/sample";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { CareSteps } from "./CareSteps";
import { HandoffSheetBody } from "./HandoffSheet";
import { MedicineChanges } from "./MedicineChanges";
import { UiLangProvider } from "./UiLang";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The saved live /api/extract response for the sample paper (the same fixture the phone apps test with). */
const LIVE = JSON.parse(readFileSync(resolve(__dirname, "../../../mobile/ios/ATLASTests/Fixtures/extract_sample_live.json"), "utf8")) as CarePlanResponse;

function step(id: string, kind: VerifiedItem["kind"], quote: string, paper = SAMPLE_AVS): VerifiedItem {
  const start = paper.indexOf(quote);
  return {
    id, kind, title: `AI-TITLE ${id}`, when: `AI-WHEN ${id}`, source_quote: quote, plain_language: `AI-PLAIN ${id}`, why: "",
    needs_clarification: false, question_for_clinic: "", grounded: true, span: start < 0 ? null : { start, end: start + quote.length },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { f(0); return 0; });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function renderSteps(care: CarePlanResponse, meaning: MeaningState = { status: "idle", byId: {} }) {
  const checkFor = (id: string): Check => (meaning.status === "done" ? checkOf(meaning.byId[id]) : "unchecked");
  act(() => root.render(
    <CareSteps care={care} items={care.items} removedItems={[]} checkFor={checkFor} meaning={meaning} deviceRun={NO_DEVICE_RUN}
      deviceStatus="idle" done={{}} language="English" photo={null} simpler={{ ok: false, onClick: () => {} }}
      onDone={() => {}} onRemove={() => {}} onUndoRemove={() => {}} />,
  ));
}

const card = () => host.querySelector<HTMLElement>("[data-med-changes]");
const rowIds = (row: string) => [...host.querySelectorAll(`[data-med-row="${row}"] li[data-med]`)].map((li) => li.getAttribute("data-med"));

describe("Your medicine changes, on the sample paper's saved live reading", () => {
  it("sorts Stop, then Change, then Start, from the paper's headings", () => {
    renderSteps(LIVE);
    expect(card()).not.toBeNull();
    expect([...card()!.querySelectorAll("[data-med-row]")].map((s) => s.getAttribute("data-med-row"))).toEqual(["stop", "change", "start"]);
    expect(rowIds("stop")).toEqual(["item-2"]);
    expect(rowIds("change")).toEqual(["item-1"]);
    expect(rowIds("start")).toEqual(["item-0"]);
    // No Keep row: the sample paper never says to continue anything. Nothing needs asking either.
    expect(host.querySelector('[data-med-row="keep"]')).toBeNull();
    expect(host.querySelector('[data-med-row="ask"]')).toBeNull();
  });

  it("sits above the time groups, inside \"Your steps\"", () => {
    renderSteps(LIVE);
    const firstGroup = host.querySelector("[data-when-group]")!;
    expect(card()!.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("strikes the old dose and says it in words, both doses copied from the line", () => {
    renderSteps(LIVE);
    const li = host.querySelector('li[data-med="item-1"]')!;
    const dose = li.querySelector("[data-med-dose]")!;
    expect(dose.querySelector("del")!.textContent).toBe("10 mg");
    expect(dose.querySelector("strong")!.textContent).toBe("20 mg");
    // Not color or a line alone: the words a screen reader reads out.
    expect(dose.textContent).toContain("was 10 mg, now 20 mg");
    expect(host.querySelectorAll("[data-med-changes] del")).toHaveLength(1);
  });

  it("shows the paper's own words for every line, labelled as copied, and the name only as the paper starts the line", () => {
    renderSteps(LIVE);
    for (const it of LIVE.items.filter((i) => i.kind === "medication")) {
      const li = host.querySelector(`li[data-med="${it.id}"]`)!;
      const q = li.querySelector("[data-paper-quote]")!;
      expect(q.textContent).toContain("Copied word for word from your paper");
      expect(q.textContent).toContain(`“${it.source_quote}”`);
    }
    expect([...host.querySelectorAll("[data-med-name]")].map((n) => n.textContent)).toEqual(["ibuprofen (ADVIL)", "lisinopril", "metformin (GLUCOPHAGE)"]);
  });

  it("never shows the AI's title, when or explanation, even when certified", () => {
    const items = LIVE.items.map((i) => ({ ...i, title: `AI-TITLE ${i.id}`, when: `AI-WHEN ${i.id}`, plain_language: `AI-PLAIN ${i.id}` }));
    const meaning: MeaningState = {
      status: "done",
      byId: Object.fromEntries(items.map((i) => [i.id, { id: i.id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same" as const, what_differs: "", certified: true }])),
    };
    renderSteps({ ...LIVE, items }, meaning);
    expect(card()!.textContent).not.toMatch(/AI-(TITLE|WHEN|PLAIN)/);
    for (const el of card()!.querySelectorAll("*")) for (const a of el.getAttributeNames()) expect(el.getAttribute(a)).not.toMatch(/AI-/);
  });
});

describe("semantics and links", () => {
  it("is a labelled region of headed lists", () => {
    renderSteps(LIVE);
    const c = card()!;
    expect(c.tagName).toBe("SECTION");
    expect(document.getElementById(c.getAttribute("aria-labelledby")!)!.textContent).toBe("Your medicine changes");
    for (const row of c.querySelectorAll("[data-med-row]")) {
      expect(row.tagName).toBe("SECTION");
      const h = document.getElementById(row.getAttribute("aria-labelledby")!)!;
      expect(h.tagName).toBe("H5");
      expect(row.querySelector(":scope > ul > li")).not.toBeNull();
    }
    expect(document.getElementById(c.querySelector('[data-med-row="stop"]')!.getAttribute("aria-labelledby")!)!.textContent).toContain("Stop");
    // The marks are decoration; the row's name is in words.
    for (const mark of c.querySelectorAll("h5 > span:first-child")) expect(mark.getAttribute("aria-hidden")).toBe("true");
  });

  it("links every line to its step, which opens and takes focus", () => {
    renderSteps(LIVE);
    const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-med-go]")];
    expect(links).toHaveLength(3);
    for (const a of links) expect(document.getElementById(a.getAttribute("href")!.slice(1))).not.toBeNull();
    const go = host.querySelector<HTMLAnchorElement>('[data-med-go="item-1"]')!;
    const toggle = document.getElementById("step-item-1")!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => go.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggle);
    // Open, the focused button still names its step, not just "Medicine Checked once" (Codex round 2).
    expect(toggle.textContent).toContain("lisinopril 10 mg tablet");
  });
});

describe("lines the words do not settle", () => {
  const paper = "Medicines:\nDo not stop taking metoprolol 25 mg.\nIncrease your lisinopril dose to 20 mg once daily.\nTake 1 tablet of vitamin D daily.";
  const items = [
    step("neg", "medication", "Do not stop taking metoprolol 25 mg.", paper),
    step("one", "medication", "Increase your lisinopril dose to 20 mg once daily.", paper),
    step("none", "medication", "Take 1 tablet of vitamin D daily.", paper),
  ];

  it("go to Ask your pharmacist, with a note, never into Stop", () => {
    act(() => root.render(<MedicineChanges items={items} paper={paper} />));
    expect(rowIds("ask")).toEqual(["neg", "none"]);
    expect(rowIds("stop")).toEqual([]);
    expect(host.querySelector('[data-med-row="ask"] [data-med-row-note]')!.textContent).toContain("Ask your pharmacist");
  });

  it("a change with only the new dose on the line shows the quote alone, no strike-through", () => {
    act(() => root.render(<MedicineChanges items={items} paper={paper} />));
    expect(rowIds("change")).toEqual(["one"]);
    expect(host.querySelector("del")).toBeNull();
    expect(host.querySelector("[data-med-dose]")).toBeNull();
  });

  it("no medicine steps: no card at all", () => {
    act(() => root.render(<MedicineChanges items={[step("walk", "self_care", "Walk 30 minutes, 5 days a week, as tolerated.")]} paper={SAMPLE_AVS} />));
    expect(host.querySelector("[data-med-changes]")).toBeNull();
  });
});

describe("printed handoff sheet", () => {
  it("carries the same rows, the paper's words and the dose in words", () => {
    const html = renderToStaticMarkup(<HandoffSheetBody items={LIVE.items} plan={null} questions={[]} language="English" paper={LIVE.source_text} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meds = doc.querySelector("[data-sheet-meds]")!;
    expect([...meds.querySelectorAll(":scope > li")].map((li) => li.getAttribute("data-med-row"))).toEqual(["stop", "change", "start"]);
    expect(meds.textContent).toContain("was 10 mg, now 20 mg");
    expect(meds.querySelector("del")!.textContent).toBe("10 mg");
    expect(meds.textContent).not.toMatch(/Stop ibuprofen \(Advil\)|Take more lisinopril|Start metformin/);
  });
});

describe("in another language, medicine names and doses keep the paper's language (Codex round 9 of PR 93)", () => {
  const inPaperLang = (el: Element | null) => !!el && (el.querySelector('[lang="en"]') !== null || el.closest('[lang="en"]') !== null);
  it("on screen", () => {
    act(() => root.render(<UiLangProvider language="Spanish" paperLang="en"><MedicineChanges items={LIVE.items} paper={LIVE.source_text} /></UiLangProvider>));
    const names = [...host.querySelectorAll("[data-med-name]")];
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(inPaperLang(n), n.textContent ?? "").toBe(true);
    const dose = host.querySelector("[data-med-dose]")!;
    expect(dose.querySelector('del [lang="en"]')?.textContent).toBe("10 mg");
    expect(dose.querySelector('strong [lang="en"]')?.textContent).toBe("20 mg");
  });
  it("on the printed sheet", () => {
    const html = renderToStaticMarkup(<UiLangProvider language="Spanish" paperLang="en"><HandoffSheetBody items={LIVE.items} plan={null} questions={[]} language="Spanish" paper={LIVE.source_text} /></UiLangProvider>);
    const meds = new DOMParser().parseFromString(html, "text/html").querySelector("[data-sheet-meds]")!;
    expect(meds.querySelector('del [lang="en"]')?.textContent).toBe("10 mg");
    expect([...meds.querySelectorAll("b")].some((b) => b.querySelector('[lang="en"]') !== null)).toBe(true);
  });
});
