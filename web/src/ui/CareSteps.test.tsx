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
import { UiLangProvider } from "./UiLang";

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

type RenderOpts = { items?: VerifiedItem[]; meaning?: MeaningState; device?: DeviceRun; deviceStatus?: DeviceStatus; care?: CarePlanResponse; ui?: { language: string; paperLang: string } };
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
  const steps = (
    <CareSteps care={o.care ?? careWith(items)} items={items} removedItems={[]} checkFor={checkFor} meaning={meaning} deviceRun={device}
      deviceStatus={deviceStatus} done={{}} language="English" photo={null} simpler={{ ok: false, onClick: () => {} }}
      onDone={(id, v) => calls.done.push([id, v])} onRemove={(id) => calls.removed.push(id)} onUndoRemove={() => {}} />
  );
  act(() => root.render(o.ui ? <UiLangProvider language={o.ui.language} paperLang={o.ui.paperLang}>{steps}</UiLangProvider> : steps));
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
      expect(btn.textContent).not.toContain(it.title);
      expect(btn.textContent).not.toContain("AI-WHEN");
      if (btn.getAttribute("aria-expanded") === "true") {
        // Open (a flagged step opens itself): the row does not repeat the quote; the panel leads with all of it.
        expect(btn.querySelector("[data-paper-quote]")).toBeNull();
        const first = panelOf(it.id).querySelector("[data-lead]")!.firstElementChild!;
        expect(first.hasAttribute("data-paper-quote")).toBe(true);
        expect(first.textContent).toContain(it.source_quote);
      } else {
        expect(btn.textContent).toContain("From your paper");
        // The row's quote is the start of the paper's own words.
        const shown = btn.querySelector("[data-paper-quote] .font-bold")!.textContent!.replace(/[“”]/g, "").replace(/…$/, "");
        expect(it.source_quote.replace(/\s+/g, " ").startsWith(shown)).toBe(true);
      }
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
    // ibuprofen sits under the paper's own "STOP taking these medications:" heading: a stop starts now (stopNowFromPaper).
    expect(groupIds("today")).toEqual(["ibu"]);
    expect(groupIds("soon")).toEqual(["bmp"]);
    expect(groupIds("daily")).toEqual(["met", "lis", "walk"]);
    expect(groupIds("later")).toEqual(["a1c"]);
    // soda's AI "Every day" does not place it.
    // The referral's "in 10 days" sits after "If you have not heard": a negated clause is never placed.
    expect(groupIds("unclear")).toEqual(["eye", "soda"]);
    expect(host.querySelector("#when-unclear")?.textContent).toContain("Check the date on your paper");
  });

  it("certified: the AI's when may place a step whose paper names no time; the paper still wins otherwise", () => {
    render({ meaning: certifiedAll() });
    expect(groupIds("today")).toEqual(["ibu"]);
    expect(groupIds("daily")).toEqual(["met", "lis", "walk", "soda"]);
    expect(groupIds("soon")).toEqual(["bmp"]); // bmp's AI "today" loses to the paper's "within 2 weeks"
    // The paper names a time for the referral, but in a negated clause: even certified, the AI's when does not override it.
    expect(groupIds("unclear")).toEqual(["eye"]);
  });

  it("a quote with warning words is pinned even when the model called it something else (the kind only adds caution)", () => {
    const mislabeled = ITEMS.map((i) => (i.id === "w911" ? { ...i, kind: "self_care" as const } : i));
    render({ items: mislabeled, care: careWith(mislabeled, { has_warning_signs: false }) });
    expect([...host.querySelectorAll("[data-warnings] li[data-step]")].map((li) => li.getAttribute("data-step"))).toEqual(["w911"]);
    expect(host.querySelector('[data-when-group] li[data-step="w911"]')).toBeNull();
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

  it("a disagreement that lands after the steps are shown is announced politely, by the paper's words", async () => {
    render({ meaning: { status: "loading", byId: {} } });
    const status = host.querySelector('[data-flagged-status]')!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(status.textContent).toBe("");
    render({ meaning: { status: "done", byId: { bmp: result("bmp", { flagged: true }) } } });
    expect(host.querySelector('[data-flagged-status]')).toBe(status); // the same region, still mounted
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(status.textContent).toContain("1 step needs a second look, opened below");
    expect(status.textContent).toContain("Basic metabolic panel");
    expect(status.textContent).not.toContain("AI-TITLE");
  });

  it("in another language, the announcement's quotes and the row's timing words carry the paper's language (Codex round 8 of PR 93)", async () => {
    const ui = { language: "Spanish", paperLang: "en" };
    render({ ui, meaning: { status: "loading", byId: {} } });
    render({ ui, meaning: { status: "done", byId: { bmp: result("bmp", { flagged: true }) } } });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    const quoted = host.querySelector('[data-flagged-status] [lang="en"]');
    expect(quoted?.textContent).toContain("Basic metabolic panel");
    // A row led by the paper's words shows the paper's timing words, in the paper's language.
    const timing = [...host.querySelectorAll('[lang="en"]')].map((e) => e.textContent ?? "").filter((t) => t.startsWith("\u201c"));
    expect(timing.length).toBeGreaterThan(0);
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
  it("uncertified: the paper's words first, labelled as copied word for word, then the explanation, labelled not double-checked", () => {
    render();
    act(() => toggleOf("bmp").click());
    const block = panelOf("bmp").querySelector("[data-lead]")!;
    expect(block.getAttribute("data-lead")).toBe("quote");
    expect(block.firstElementChild!.textContent).toContain("Copied word for word from your paper");
    expect(block.firstElementChild!.textContent).toContain(ITEMS[4].source_quote);
    expect(block.querySelector("[data-explanation]")!.textContent).toContain("Plain words (not double-checked yet)");
    expect(block.textContent).not.toContain("If it and your paper differ");
  });

  it.each([
    ["never checked", {} as RenderOpts],
    ["not confirmed", { meaning: done(ALL, { model_verdict: "unclear" }) }],
    ["flagged", { meaning: done(ALL, { flagged: true, model_verdict: "different" }) }],
  ])("%s, open: the paper's line shows once, in full, before any AI word", (_, o) => {
    render(o);
    for (const it of ITEMS) {
      if (toggleOf(it.id).getAttribute("aria-expanded") !== "true") act(() => toggleOf(it.id).click());
      // Visible text only (a closed sub-panel such as "Ask your pharmacist" is hidden until asked for).
      const visible = (el: Element): string => [...el.childNodes].map((c) => c.nodeType === Node.TEXT_NODE ? c.textContent : c instanceof HTMLElement && c.hidden ? "" : visible(c as Element)).join("");
      const text = visible(rowOf(it.id)).replace(/\s+/g, " ");
      const quote = it.source_quote.replace(/\s+/g, " ");
      expect(text.split(quote).length - 1, it.id).toBe(1);
      expect(text.indexOf(quote)).toBeGreaterThanOrEqual(0);
      for (const ai of [it.title, it.when, it.plain_language].filter(Boolean)) {
        const at = text.indexOf(ai);
        if (at >= 0) expect(at, `${ai} before the quote`).toBeGreaterThan(text.indexOf(quote));
      }
    }
  });

  it("checked once: the long reason waits behind a small 'Why?'", () => {
    render({ meaning: done(ALL, { model_verdict: "unclear" }), deviceStatus: "done", device: { run: 1, ok: true, byId: { bmp: "match" } } });
    act(() => toggleOf("bmp").click());
    const why = panelOf("bmp").querySelector<HTMLDetailsElement>("details[data-seal-text='once']")!;
    expect(why.open).toBe(false);
    expect(why.querySelector("summary")!.textContent).toContain("Why?");
    expect(why.textContent).toContain("Our second check couldn't confirm this one.");
    expect(why.querySelector('[data-device-check="match"]')).not.toBeNull();
    // Honest: never says the plain words were checked.
    expect(why.textContent).toContain("not double-checked yet");
  });

  it("an unconfirmed medicine step offers 'Ask your pharmacist' with a question in the paper's words only", () => {
    render({ meaning: done(ALL, { model_verdict: "unclear" }) });
    act(() => toggleOf("lis").click());
    const btn = panelOf("lis").querySelector<HTMLButtonElement>("button[data-ask-person]")!;
    expect(btn.textContent).toContain("Ask your pharmacist");
    const panel = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    act(() => btn.click());
    expect(panel.hidden).toBe(false);
    const q = panel.querySelector("[data-ask-question]")!.textContent!;
    expect(q).toBe(`My paper says: "${ITEMS[1].source_quote}" Can you confirm what I should take?`);
    for (const w of ["AI-TITLE", "AI-WHEN", "PLAIN"]) expect(panel.textContent).not.toContain(w);
  });

  it("an unconfirmed lab or referral step offers 'Ask your clinic'; a warning sign offers neither", () => {
    render();
    act(() => toggleOf("eye").click());
    expect(panelOf("eye").querySelector("button[data-ask-person]")!.textContent).toContain("Ask your clinic");
    act(() => toggleOf("w911").click());
    expect(panelOf("w911").querySelector("button[data-ask-person]")).toBeNull();
  });

  it("certified: unchanged, the seal text stays in view and no 'Why?' or 'Ask' is needed", () => {
    render({ meaning: certifiedAll() });
    act(() => toggleOf("bmp").click());
    act(() => toggleOf("lis").click());
    expect(panelOf("lis").querySelector("button[data-ask-person]")).toBeNull();
    expect(panelOf("bmp").querySelector("details")).toBeNull();
    expect(panelOf("bmp").querySelector("[data-seal-text='twice']")!.textContent).toContain("Checked twice");
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
    render({ meaning: certifiedAll() });
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

  it("paper first: an unconfirmed step's AI question never shows or copies; the paper's words stand in", () => {
    // The reading also carries the step's question in its general list (older readings did): it must not leak there.
    const care = careWith(ITEMS, { questions_for_doctor: ["Which pain medicines are safe for me instead?", "Do I need to call to book my 3-month visit?"] });
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } } });
    render({ care });
    const list = host.querySelector("[data-ask-clinic]")!;
    expect(list.textContent).not.toContain("Which pain medicines are safe for me instead?");
    expect(list.textContent).toContain('My paper says: "ibuprofen (ADVIL) 200 mg tablet. Avoid NSAIDs due to kidney function."');
    expect(list.querySelector("h3")?.textContent).toBe("Ask your clinic (2)");
    act(() => list.querySelector<HTMLButtonElement>("button")!.click());
    expect(copied).not.toContain("Which pain medicines");
    expect(copied).toContain("ibuprofen (ADVIL)");
    expect(host.textContent).not.toContain("Which pain medicines are safe for me instead?");
  });

  it("lists a certified step's question once, even when the reading repeats it in the general list", () => {
    const care = careWith(ITEMS, { questions_for_doctor: ["Which pain medicines are safe for me instead?", "Do I need to call to book my 3-month visit?"] });
    render({ care, meaning: certifiedAll() });
    const list = host.querySelector("[data-ask-clinic]")!;
    expect(list.textContent!.split("Which pain medicines are safe for me instead?").length - 1).toBe(1);
    expect(list.querySelector("h3")?.textContent).toBe("Ask your clinic (2)");
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
    expect(h4).toEqual(["when-today", "when-soon", "when-daily", "when-later", "when-unclear"]);
    for (const s of host.querySelectorAll("section[aria-labelledby]")) expect(document.getElementById(s.getAttribute("aria-labelledby")!)).not.toBeNull();
    // Step numbers follow the order on screen: warnings first, then the groups.
    const labels = [...host.querySelectorAll('input[type="checkbox"]')].map((c) => c.getAttribute("aria-label"));
    expect(labels).toEqual(ITEMS.map((_, i) => `Mark step ${i + 1} done`));
    expect(rowOf("w911").querySelector("input")!.getAttribute("aria-label")).toBe("Mark step 1 done");
  });
});
