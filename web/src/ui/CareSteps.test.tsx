// @vitest-environment jsdom
/**
 * "Your steps" grouped by when (CareSteps.tsx), against the real component. The paper-first rule is the point:
 * an AI title or "when" the second check did not certify never shows without the paper's own words in front of it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOf, type Check } from "@/lib/paperFirst";
import type { MeaningResult } from "@/lib/meaning";
import type { MeaningState } from "@/lib/meaningRun";
import { NO_DEVICE_RUN, type DeviceRun, type DeviceStatus } from "@/lib/deviceRun";
import { SAMPLE_AVS } from "@/lib/sample";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { CareSteps } from "./CareSteps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A step of the sample paper. Titles and "when"s are deliberately distinctive so a leak is easy to find. */
function step(id: string, kind: VerifiedItem["kind"], quote: string, title: string, when: string, extra: Partial<VerifiedItem> = {}): VerifiedItem {
  const start = SAMPLE_AVS.indexOf(quote);
  if (start < 0) throw new Error(`not on the sample paper: ${quote}`);
  return {
    id, kind, title, when, source_quote: quote, plain_language: `PLAIN ${title}`, why: "",
    needs_clarification: false, question_for_clinic: "", grounded: true, span: { start, end: start + quote.length }, ...extra,
  };
}

const ITEMS: VerifiedItem[] = [
  step("met", "medication", "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.", "AI-TITLE Start metformin", "AI-WHEN with meals"),
  step("lis", "medication", "lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.", "AI-TITLE Take 2 lisinopril", "AI-WHEN once a day"),
  step("ibu", "medication", "ibuprofen (ADVIL) 200 mg tablet. Avoid NSAIDs due to kidney function.", "AI-TITLE Stop ibuprofen", "AI-WHEN Stop now",
    { needs_clarification: true, question_for_clinic: "Which pain medicines are safe for me instead?" }),
  step("a1c", "lab_test", "Hemoglobin A1c - due in 3 months", "AI-TITLE A1c test", "AI-WHEN in about 3 months"),
  step("bmp", "lab_test", "Basic metabolic panel - fasting, complete within 2 weeks at any Quest or Labcorp location", "AI-TITLE Fasting blood test", "AI-WHEN today"),
  step("eye", "referral", "Referral to Ophthalmology for diabetic eye exam. Their office will call you to schedule. If you have not heard from them in 10 days, call 404-555-0134.", "AI-TITLE Eye doctor will call", "AI-WHEN within 10 days"),
  step("walk", "self_care", "Walk 30 minutes, 5 days a week, as tolerated.", "AI-TITLE Walk 30 minutes", "AI-WHEN 5 days a week"),
  step("soda", "self_care", "Limit sugary drinks such as soda and sweet tea.", "AI-TITLE Cut back on soda", "AI-WHEN Every day"),
  step("w911", "warning_sign", "Call 911 or go to the nearest emergency room if you have chest pain, trouble breathing, or sudden weakness on one side of your body.", "AI-TITLE Chest pain", ""),
];

function careWith(items: VerifiedItem[], more: Partial<CarePlanResponse> = {}): CarePlanResponse {
  return {
    source_text: SAMPLE_AVS, source_kind: "text", items, refused: [], model: "test", has_warning_signs: items.some((i) => i.kind === "warning_sign"),
    questions_for_doctor: ["Do I need to call to book my 3-month visit?"], not_in_document: ["How long to keep taking metformin"],
    stats: { extracted: items.length, grounded: items.length, refused: 0, ms: 1200 }, ...more,
  };
}

const result = (id: string, r: Partial<MeaningResult>): MeaningResult => ({
  id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "unclear", what_differs: "", certified: false, ...r,
});

let host: HTMLDivElement;
let root: Root;
let calls: { done: [string, boolean][]; removed: string[] };

type RenderOpts = { items?: VerifiedItem[]; meaning?: MeaningState; device?: DeviceRun; deviceStatus?: DeviceStatus; care?: CarePlanResponse };
function render(o: RenderOpts = {}) {
  const items = o.items ?? ITEMS;
  const meaning = o.meaning ?? { status: "idle", byId: {} };
  const device = o.device ?? NO_DEVICE_RUN;
  const deviceStatus = o.deviceStatus ?? "idle";
  // The same rule as CarePlanTool's checkFor: this device disputing a step flags it; otherwise the meaning check decides.
  const checkFor = (id: string): Check => {
    if (deviceStatus === "done" && device.byId[id] && device.byId[id] !== "match") return "flagged";
    return meaning.status === "done" ? checkOf(meaning.byId[id]) : "unchecked";
  };
  act(() => root.render(
    <CareSteps care={o.care ?? careWith(items)} items={items} removedItems={[]} checkFor={checkFor} meaning={meaning} deviceRun={device}
      deviceStatus={deviceStatus} done={{}} language="English" photo={null} simpler={{ ok: false, onClick: () => {} }}
      onDone={(id, v) => calls.done.push([id, v])} onRemove={(id) => calls.removed.push(id)} onUndoRemove={() => {}} />,
  ));
}

const done = (ids: string[], r: Partial<MeaningResult>): MeaningState => ({ status: "done", byId: Object.fromEntries(ids.map((id) => [id, result(id, r)])) });
const ALL = ITEMS.map((i) => i.id);
const certifiedAll = () => done(ALL, { certified: true, model_verdict: "same" });
const rowOf = (id: string) => host.querySelector<HTMLLIElement>(`li[data-step="${id}"]`)!;
const toggleOf = (id: string) => rowOf(id).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const panelOf = (id: string) => document.getElementById(toggleOf(id).getAttribute("aria-controls")!)!;
const groupIds = (g: string) => [...host.querySelectorAll(`[data-when-group="${g}"] li[data-step]`)].map((li) => li.getAttribute("data-step"));

beforeEach(() => {
  calls = { done: [], removed: [] };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
  vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; rate = 1; onend: unknown; onerror: unknown; constructor(public text: string) {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/**
 * Every place an AI-written string of step `it` shows up: text nodes and attributes. For an uncertified step, each one
 * must sit inside the paper-first block, after the paper's own words.
 */
function assertNeverWithoutQuote(it: VerifiedItem) {
  for (const ai of [it.title, it.when].filter((s) => s.startsWith("AI-"))) {
    // Attributes (aria-label, title...) anywhere.
    for (const el of host.querySelectorAll("*")) {
      for (const a of el.getAttributeNames()) expect(el.getAttribute(a) ?? "", `${a} on <${el.tagName}>`).not.toContain(ai);
    }
    // Text: only inside the expanded panel's paper-first block, which starts with the quote.
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.includes(ai)) continue;
      const block = n.parentElement!.closest("[data-lead]");
      expect(block?.getAttribute("data-lead"), `"${ai}" outside the paper-first block`).toBe("quote");
      expect(block!.firstElementChild!.hasAttribute("data-paper-quote")).toBe(true);
      expect(block!.firstElementChild!.textContent).toContain(it.source_quote);
      expect(n.parentElement!.closest("button")).toBeNull();
    }
  }
}

describe("closed rows: certified leads with the AI's words, everything else with the paper's", () => {
  it("certified: the title and its when on the row", () => {
    render({ meaning: certifiedAll() });
    const btn = toggleOf("ibu");
    expect(btn.textContent).toContain("AI-TITLE Stop ibuprofen");
    expect(btn.textContent).toContain("Stop now");
    expect(btn.querySelector("[data-closed-row]")?.getAttribute("data-closed-row")).toBe("explanation");
  });

  const states: [string, RenderOpts][] = [
    ["still checking", { meaning: { status: "loading", byId: {} } }],
    ["never checked", {}],
    ["check failed", { meaning: { status: "error", byId: {} } }],
    ["not confirmed", { meaning: done(ALL, { model_verdict: "unclear" }) }],
    ["flagged by the second check", { meaning: done(ALL, { flagged: true, model_verdict: "different", what_differs: "paper says stop" }) }],
    ["certified, but this device disputes it", { meaning: certifiedAll(), deviceStatus: "done", device: { run: 1, ok: true, byId: Object.fromEntries(ALL.map((id) => [id, "differ" as const])) } }],
  ];
  it.each(states)("%s: the row shows the paper's words, and the AI's title never appears without them", (_, o) => {
    render(o);
    for (const it of ITEMS) {
      const btn = toggleOf(it.id);
      expect(btn.querySelector("[data-closed-row]")?.getAttribute("data-closed-row")).toBe("quote");
      expect(btn.textContent).toContain("Your paper says");
      expect(btn.textContent).not.toContain(it.title);
      expect(btn.textContent).not.toContain("AI-WHEN");
      // The row's quote is the start of the paper's own words.
      const shown = btn.querySelector("[data-paper-quote] .font-bold")!.textContent!.replace(/[“”]/g, "").replace(/…$/, "");
      expect(it.source_quote.replace(/\s+/g, " ").startsWith(shown)).toBe(true);
      assertNeverWithoutQuote(it);
    }
  });

  it("an uncertified row names the paper's own time words, never the AI's", () => {
    render();
    expect(toggleOf("bmp").textContent).toContain("“within 2 weeks”");
    expect(toggleOf("bmp").textContent).not.toContain("AI-WHEN");
  });

  it("a warning sign's row keeps the whole quote (never cut before 'call 911')", () => {
    render();
    expect(toggleOf("w911").textContent).toContain(ITEMS[8].source_quote);
    expect(toggleOf("w911").textContent).not.toContain("…");
  });
});

describe("time groups come from the paper's words", () => {
  it("uncertified: placed by the quote only; no time words means 'Check the date on your paper'", () => {
    render();
    expect(groupIds("today")).toEqual([]);
    expect(groupIds("soon")).toEqual(["bmp", "eye"]);
    expect(groupIds("daily")).toEqual(["met", "lis", "walk"]);
    expect(groupIds("later")).toEqual(["a1c"]);
    // ibuprofen's AI "Stop now" and soda's AI "Every day" do not place them.
    expect(groupIds("unclear")).toEqual(["ibu", "soda"]);
    expect(host.querySelector("#when-unclear")?.textContent).toContain("Check the date on your paper");
  });

  it("certified: the AI's when may place a step whose paper names no time; the paper still wins otherwise", () => {
    render({ meaning: certifiedAll() });
    expect(groupIds("today")).toEqual(["ibu"]);
    expect(groupIds("daily")).toEqual(["met", "lis", "walk", "soda"]);
    expect(groupIds("soon")).toEqual(["bmp", "eye"]); // bmp's AI "today" loses to the paper's "within 2 weeks"
    expect(groupIds("unclear")).toEqual([]);
  });

  it("warning signs are pinned above everything, in red, and in no time group", () => {
    render();
    const warn = host.querySelector("[data-warnings]")!;
    const steps = [...host.querySelectorAll("h3")].find((h) => h.textContent === "Your steps")!;
    expect(warn.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(warn.className).toContain("border-red");
    expect(warn.querySelector('li[data-step="w911"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-when-group] li[data-step="w911"]')).toHaveLength(0);
  });

  it("the warning box stays even if every warning step was removed (the paper still lists them)", () => {
    const items = ITEMS.filter((i) => i.kind !== "warning_sign");
    render({ items, care: careWith(items, { has_warning_signs: true }) });
    expect(host.querySelector("[data-warnings]")?.textContent).toContain("call 911");
  });
});

describe("one seal per step, and flagged steps open themselves", () => {
  it("seal states: checked twice, checked once, double-check this", () => {
    render({
      meaning: { status: "done", byId: { met: result("met", { certified: true }), lis: result("lis", { flagged: true, what_differs: "paper says 2 tablets" }) } },
    });
    expect(rowOf("met").dataset.seal).toBe("twice");
    expect(rowOf("ibu").dataset.seal).toBe("once");
    expect(rowOf("lis").dataset.seal).toBe("recheck");
    // The seal speaks in words too (never color alone): hidden text for the quiet ones, visible for the loud one.
    expect(toggleOf("met").textContent).toContain("Checked twice");
    expect(toggleOf("ibu").textContent).toContain("Checked once");
    expect(toggleOf("lis").querySelector("[data-seal-label]")?.textContent).toBe("Double-check this");
    expect(toggleOf("lis").querySelector("[data-seal-label]")?.className).not.toContain("sr-only");
    expect(toggleOf("met").querySelector("[data-seal-label]")?.className).toContain("sr-only");
  });

  it("a flagged step is open from the start, with the full peach wording; the others are closed", () => {
    render({ meaning: { status: "done", byId: { lis: result("lis", { flagged: true, what_differs: "paper says 2 tablets", unexpected_numbers: ["3"] }) } } });
    expect(toggleOf("lis").getAttribute("aria-expanded")).toBe("true");
    expect(panelOf("lis").hidden).toBe(false);
    expect(panelOf("lis").textContent).toContain("Double-check this one with your clinic");
    expect(panelOf("lis").textContent).toContain("Paper says 2 tablets");
    expect(panelOf("lis").textContent).toContain("Number not in your paper: 3");
    expect(toggleOf("met").getAttribute("aria-expanded")).toBe("false");
    expect(panelOf("met").hidden).toBe(true);
    // The person can still close it.
    act(() => toggleOf("lis").click());
    expect(panelOf("lis").hidden).toBe(true);
  });

  it("a step this device disputes opens itself with the device's wording", () => {
    render({ deviceStatus: "done", device: { run: 1, ok: true, byId: { eye: "missing", met: "match" } } });
    expect(panelOf("eye").hidden).toBe(false);
    expect(panelOf("eye").textContent).toContain("could not find these words in your paper");
    expect(panelOf("met").hidden).toBe(true);
    expect(panelOf("met").querySelector('[data-device-check="match"]')).not.toBeNull();
  });
});

describe("the expanded step", () => {
  it("uncertified: 'Your paper says' first, then the explanation with its caveat", () => {
    render();
    act(() => toggleOf("bmp").click());
    const block = panelOf("bmp").querySelector("[data-lead]")!;
    expect(block.getAttribute("data-lead")).toBe("quote");
    expect(block.firstElementChild!.textContent).toContain("Your paper says:");
    expect(block.querySelector("[data-explanation]")!.textContent).toContain("not double-checked");
  });

  it("certified: the explanation, then the paper's words", () => {
    render({ meaning: certifiedAll() });
    act(() => toggleOf("bmp").click());
    const block = panelOf("bmp").querySelector("[data-lead]")!;
    expect(block.getAttribute("data-lead")).toBe("explanation");
    expect(block.querySelector("[data-paper-quote]")!.textContent).toContain(ITEMS[4].source_quote);
  });

  it("read aloud carries the explanation only when certified", () => {
    render();
    act(() => toggleOf("bmp").click());
    act(() => [...panelOf("bmp").querySelectorAll("button")].find((b) => b.textContent?.includes("Read aloud"))!.click());
    const said = (speechSynthesis.speak as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { text: string }).text).join("\n");
    expect(said).toContain(ITEMS[4].source_quote);
    expect(said).not.toContain("AI-TITLE");
    expect(said).not.toContain("PLAIN");
  });

  it("Remind me never puts an uncertified title or explanation in the calendar link", () => {
    render();
    act(() => toggleOf("eye").click());
    const link = panelOf("eye").querySelector<HTMLAnchorElement>('a[href^="https://calendar.google.com"]')!;
    const href = decodeURIComponent(link.href.replace(/\+/g, " "));
    expect(href).toContain("Referral from your paper");
    expect(href).toContain("Their office will call you to schedule");
    expect(href).not.toContain("AI-TITLE");
    expect(href).not.toContain("PLAIN");
  });

  it("done and Remove call back with the step", () => {
    render();
    act(() => rowOf("walk").querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(calls.done).toEqual([["walk", true]]);
    act(() => toggleOf("walk").click());
    const n = rowOf("walk").querySelector('input[type="checkbox"]')!.getAttribute("aria-label")!.match(/\d+/)![0];
    act(() => panelOf("walk").querySelector<HTMLButtonElement>(`button[aria-label="Remove step ${n}"]`)!.click());
    expect(calls.removed).toEqual(["walk"]);
  });
});

describe("Ask your clinic: one list", () => {
  it("collects every step question (with the paper line it is about) and the questions for the doctor", () => {
    render();
    const list = host.querySelector("[data-ask-clinic]")!;
    expect(list.querySelector("h3")?.textContent).toBe("Ask your clinic (2)");
    const li = [...list.querySelectorAll("li")];
    expect(li[0].textContent).toContain("Which pain medicines are safe for me instead?");
    expect(li[0].querySelector("[data-paper-quote]")?.textContent).toContain("ibuprofen (ADVIL) 200 mg tablet");
    expect(li[1].textContent).toBe("Do I need to call to book my 3-month visit?");
    // The step row says it has a question.
    expect(toggleOf("ibu").textContent).toContain("? Ask");
    expect(toggleOf("met").textContent).not.toContain("? Ask");
  });

  it("is left out when there are no questions", () => {
    const items = ITEMS.map((i) => ({ ...i, needs_clarification: false }));
    render({ items, care: careWith(items, { questions_for_doctor: [] }) });
    expect(host.querySelector("[data-ask-clinic]")).toBeNull();
  });
});

describe("accessibility", () => {
  it("every step is a disclosure button that controls its own panel; groups are headed", () => {
    render();
    const toggles = [...host.querySelectorAll<HTMLButtonElement>("li[data-step] > div > button[aria-expanded]")];
    expect(toggles).toHaveLength(ITEMS.length);
    for (const b of toggles) {
      const panel = document.getElementById(b.getAttribute("aria-controls")!);
      expect(panel).not.toBeNull();
      expect(panel!.hidden).toBe(b.getAttribute("aria-expanded") === "false");
      expect(b.closest("li")!.contains(panel)).toBe(true);
    }
    // The done box is its own control, not nested inside the disclosure button.
    expect(host.querySelectorAll("button input, button button")).toHaveLength(0);
    const h4 = [...host.querySelectorAll("[data-when-group] > h4")].map((h) => h.id);
    expect(h4).toEqual(["when-soon", "when-daily", "when-later", "when-unclear"]);
    for (const s of host.querySelectorAll("section[aria-labelledby]")) expect(document.getElementById(s.getAttribute("aria-labelledby")!)).not.toBeNull();
    // Step numbers follow the order on screen: warnings first, then the groups.
    const labels = [...host.querySelectorAll('input[type="checkbox"]')].map((c) => c.getAttribute("aria-label"));
    expect(labels).toEqual(ITEMS.map((_, i) => `Mark step ${i + 1} done`));
    expect(rowOf("w911").querySelector("input")!.getAttribute("aria-label")).toBe("Mark step 1 done");
  });
});
