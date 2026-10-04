// @vitest-environment jsdom
/**
 * "Get ready for your procedure", concise groups (PrepMode.tsx, PrepTimeline), against the real component and the real
 * timeline code (prepTimeline.ts). Groups come in order with only the next one open; must-see steps ("do not", "stop",
 * when to call) are never folded; a step is timed only by its own paper line; the AI's words never show without the
 * paper's sentence before them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrepTimeline, type PrepModelItem, type PrepResponse, type PrepStep } from "@/lib/prepTimeline";
import { SAMPLE_PREP } from "@/lib/samplePrep";
import { SLOTS } from "@/lib/prepTime";
import { allSteps, prepMustSee, type MeaningState } from "@/lib/prepView";
import type { MeaningResult } from "@/lib/meaning";
import { PrepTimeline } from "./PrepMode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One instruction as the AI returns it, quoting a line of the sample paper. Its explanation is easy to find. */
const it_ = (kind: PrepModelItem["kind"], quote: string, tag: string): PrepModelItem => {
  if (!SAMPLE_PREP.includes(quote)) throw new Error(`not on the sample paper: ${quote}`);
  return { kind, source_quote: quote, plain_language: `AI-PLAIN ${tag}`, ai_slot: "not_stated" };
};

const ITEMS: PrepModelItem[] = [
  it_("medicine", "Stop taking iron pills and fish oil 7 days before your procedure.", "iron"),
  it_("food_drink", "Starting 3 days before your procedure, do not eat nuts, seeds, popcorn, or raw vegetables.", "nuts"),
  it_("food_drink", "The day before your procedure, drink only clear liquids all day: water, clear broth, apple juice, and plain gelatin.", "clear"),
  it_("bowel_prep", "Take 2 bisacodyl tablets at 3 PM.", "bisacodyl"),
  it_("bowel_prep", "At 5 PM the evening before your procedure, drink the first half of the bowel prep (8 ounces every 15 minutes until it is gone).", "first half"),
  it_("bowel_prep", "5 hours before your procedure, drink the second half of the bowel prep.", "second half"),
  it_("food_drink", "Stop drinking all liquids 2 hours before your procedure.", "stop drinking"),
  it_("medicine", "The morning of your procedure, take your blood pressure pill with a small sip of water.", "bp pill"),
  it_("arrival", "Arrive at 7:00 AM at Midtown Endoscopy Center, 2nd floor, 100 Sample Street.", "arrive"),
  it_("bring", "Bring your photo ID, insurance card, and a list of all your medicines.", "bring"),
  it_("ride", "An adult must drive you home after your procedure.", "ride"),
  it_("call", "Call 404-555-0199 if you cannot finish the prep, or if you have bad stomach pain or vomiting.", "call"),
];

const RES: PrepResponse = { ...buildPrepTimeline(SAMPLE_PREP, ITEMS), model: "test", ms: 1 };
const STEPS = allSteps(RES);

const result = (id: string, r: Partial<MeaningResult>): MeaningResult => ({
  id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same", what_differs: "", certified: true, ...r,
});
const certifiedAll: MeaningState = { status: "done", byId: Object.fromEntries(STEPS.map((s) => [s.id, result(s.id, {})])) };

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
  vi.unstubAllGlobals();
});

const render = (meaning: MeaningState = { status: "idle", byId: {} }, res: PrepResponse = RES) => act(() => root.render(<PrepTimeline res={res} meaning={meaning} />));
const groups = () => [...host.querySelectorAll<HTMLLIElement>("li[data-prep-group]")];
const groupToggle = (g: HTMLElement) => g.querySelector<HTMLButtonElement>(":scope > h3 > button[aria-expanded]")!;
const stepLi = (id: string) => host.querySelector<HTMLLIElement>(`li[data-prep-step="${id}"]`)!;
const stepToggle = (id: string) => stepLi(id).querySelector<HTMLButtonElement>(":scope > button[aria-expanded]")!;
const stepPanel = (id: string) => document.getElementById(stepToggle(id).getAttribute("aria-controls")!)!;
const byQuote = (start: string) => STEPS.find((s) => s.source_quote.startsWith(start))!;
/** Visible means neither it nor any parent is hidden. */
const visible = (el: Element | null) => { for (let e = el; e; e = e.parentElement) if ((e as HTMLElement).hidden) return false; return !!el; };

/** Every AI explanation: only inside an opened step panel, after the paper's full sentence; never on a row or attribute. */
function assertAiNeverWithoutQuote(steps: PrepStep[]) {
  // Walk the DOM once; the attribute check does not depend on the step, so it runs once too.
  for (const el of host.querySelectorAll("*")) {
    for (const a of el.getAttributeNames()) expect(el.getAttribute(a) ?? "", `${a} on <${el.tagName}>`).not.toContain("AI-PLAIN");
  }
  const texts: Node[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  expect(texts.length).toBeGreaterThan(0);
  for (const s of steps) {
    const ai = `AI-PLAIN ${ITEMS.find((i) => SAMPLE_PREP.includes(i.source_quote) && s.source_quote.includes(i.source_quote))!.plain_language.slice(9)}`;
    for (const n of texts) {
      if (!n.textContent?.includes(ai)) continue;
      const el = n.parentElement!;
      expect(el.closest("button"), `"${ai}" on a closed row`).toBeNull();
      const panel = el.closest("[data-prep-panel]")!;
      expect(panel, `"${ai}" outside a step panel`).not.toBeNull();
      const quote = panel.querySelector("[data-paper-quote]")!;
      expect(quote.textContent).toBe(s.source_quote);
      expect(quote.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  }
}

describe("time groups: in order, only the next one open", () => {
  it("groups follow the timeline order (days before ... after), each placed by its own line", () => {
    render();
    const slots = groups().map((g) => g.dataset.prepGroup);
    expect(slots).toEqual(SLOTS.filter((s) => slots.includes(s)));
    expect(slots).toEqual(["days_before", "day_before", "evening_before", "hours_before", "morning_of", "arrival", "after"]);
    expect(groups().map((g) => g.querySelector("h3 .display")!.textContent)).toEqual([
      "Days before", "The day before", "The evening before", "In the hours before your procedure", "The morning of", "When you arrive", "After your procedure",
    ]);
  });

  it("only the first group (the next one ahead) is open by default; a tap opens another", () => {
    render();
    expect(groups().map((g) => groupToggle(g).getAttribute("aria-expanded"))).toEqual(["true", "false", "false", "false", "false", "false", "false"]);
    const morning = groups().find((g) => g.dataset.prepGroup === "morning_of")!;
    const bp = byQuote("The morning of your procedure, take your blood pressure pill");
    expect(visible(stepLi(bp.id))).toBe(false);
    expect(groupToggle(morning).textContent).toContain("1 step");
    // A group with nothing must-see folds whole: no extra line under it.
    expect(morning.querySelector("[data-folded-count]")).toBeNull();
    // A closed group showing a must-see step says more sit behind its heading.
    const hours = groups().find((g) => g.dataset.prepGroup === "hours_before")!;
    expect(hours.querySelector("[data-folded-count]")!.textContent).toContain("+ 1 more step here");
    act(() => groupToggle(morning).click());
    expect(groupToggle(morning).getAttribute("aria-expanded")).toBe("true");
    expect(visible(stepLi(bp.id))).toBe(true);
    act(() => groupToggle(morning).click());
    expect(visible(stepLi(bp.id))).toBe(false);
  });

  it("a closed group says how many steps it holds", () => {
    render();
    const after = groups().find((g) => g.dataset.prepGroup === "after")!;
    expect(groupToggle(after).textContent).toContain("1 step");
  });
});

describe("must-see steps are never folded", () => {
  it("'do not', 'stop' and when-to-call lines stay visible, whole and red, in every closed group", () => {
    render();
    const must = STEPS.filter(prepMustSee);
    expect(must.map((s) => s.source_quote)).toEqual(expect.arrayContaining([
      "Stop taking iron pills and fish oil 7 days before your procedure.",
      "Starting 3 days before your procedure, do not eat nuts, seeds, popcorn, or raw vegetables.",
      "Stop drinking all liquids 2 hours before your procedure.",
      // A limit ("only", "until") is a warning too: drinking anything but clear liquids can cancel the procedure.
      "The day before your procedure, drink only clear liquids all day: water, clear broth, apple juice, and plain gelatin.",
      "Call 404-555-0199 if you cannot finish the prep, or if you have bad stomach pain or vomiting.",
    ]));
    for (const s of must) {
      const li = stepLi(s.id);
      expect(visible(li), s.source_quote).toBe(true);
      expect(li.className).toContain("border-red");
      // The whole sentence on the row: never shortened before "do not" or the number to call.
      expect(stepToggle(s.id).querySelector("[data-paper-quote]")!.textContent).toBe(`“${s.source_quote}”`);
    }
    // The "hours before" group is closed, and its stop-drinking step still shows.
    const hours = groups().find((g) => g.dataset.prepGroup === "hours_before")!;
    expect(groupToggle(hours).getAttribute("aria-expanded")).toBe("false");
    expect(visible(stepLi(byQuote("Stop drinking all liquids").id))).toBe(true);
    expect(visible(stepLi(byQuote("5 hours before your procedure").id))).toBe(false);
    // Not every step is loud: plain actions still fold.
    expect(prepMustSee(byQuote("Take 2 bisacodyl tablets"))).toBe(false);
    expect(prepMustSee(byQuote("Bring your photo ID"))).toBe(false);
    expect(prepMustSee({ kind: "other", source_quote: "If you have chest pain, go to the emergency room." })).toBe(true);
  });

  it("a call step stays visible even when the AI labels it something else (Codex review)", () => {
    const paper = "THE EVENING BEFORE\n- Contact your clinic the evening before your procedure if your temperature reaches 101 degrees.\n- Pack a bag the evening before your procedure.\n\nTHE DAY BEFORE\n- Buy the prep kit the day before your procedure.";
    const res = { ...buildPrepTimeline(paper, [
      { kind: "other", source_quote: "Contact your clinic the evening before your procedure if your temperature reaches 101 degrees.", plain_language: "", ai_slot: "not_stated" },
      { kind: "other", source_quote: "Pack a bag the evening before your procedure.", plain_language: "", ai_slot: "not_stated" },
      { kind: "other", source_quote: "Buy the prep kit the day before your procedure.", plain_language: "", ai_slot: "not_stated" },
    ]), model: "t", ms: 1 };
    render(undefined, res);
    const evening = groups().find((g) => g.dataset.prepGroup === "evening_before")!;
    expect(groupToggle(evening).getAttribute("aria-expanded")).toBe("false");
    const [contact, pack] = res.timeline.find((g) => g.slot === "evening_before")!.steps;
    expect(visible(stepLi(contact.id))).toBe(true);
    expect(visible(stepLi(pack.id))).toBe(false);
    expect(prepMustSee({ kind: "other", source_quote: "Questions? 404-555-0199." })).toBe(true);
    expect(prepMustSee({ kind: "other", source_quote: "Llame a la clínica si tiene fiebre." })).toBe(true);
  });

  it("going for care is must-see whatever the model's kind (Codex review, round 3)", () => {
    for (const q of [
      "After your procedure, seek immediate medical attention if you have chest pain.",
      "If you are bleeding a lot, go to the hospital.",
      "Get medical help right away if you feel faint.",
      "Busque atención médica inmediatamente si tiene dolor.",
      "Allez à l'hôpital si vous saignez.",
    ]) expect(prepMustSee({ kind: "other", source_quote: q }), q).toBe(true);
    expect(prepMustSee({ kind: "other", source_quote: "Bring your photo ID and insurance card." })).toBe(false);
  });
});

describe("Ask your clinic when: one list", () => {
  it("holds every step whose own line names no day, always open, with the reason in the step", () => {
    render();
    const ask = host.querySelector("[data-ask-when]")!;
    expect(ask.querySelector("h3")!.textContent).toBe(`Ask your clinic when (${RES.ask.length})`);
    const ids = [...ask.querySelectorAll("li[data-prep-step]")].map((li) => li.getAttribute("data-prep-step"));
    expect(ids).toEqual(RES.ask.map((s) => s.id));
    // "at 3 PM" names no day: not placed, even though it sits under THE DAY BEFORE on the paper.
    const bis = byQuote("Take 2 bisacodyl tablets at 3 PM.");
    expect(bis.slot).toBeNull();
    expect(ask.contains(stepLi(bis.id))).toBe(true);
    for (const li of ask.querySelectorAll("li[data-prep-step]")) expect(visible(li)).toBe(true);
    act(() => stepToggle(bis.id).click());
    expect(stepPanel(bis.id).textContent).toContain("Your paper gives a time but not which day.");
    expect(groups().some((g) => g.contains(stepLi(bis.id)))).toBe(false);
  });

  it("Copy puts each step's own paper sentence on the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render();
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy these questions")!.click(); });
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    for (const s of RES.ask) expect(text).toContain(`Your paper says: "${s.source_quote}"`);
    expect(text).not.toContain("AI-PLAIN");
  });

  it.each([
    ["denied", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }],
    ["missing", {}],
  ])("Copy says so when the clipboard is %s (Codex review)", async (_, nav) => {
    vi.stubGlobal("navigator", nav);
    render();
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy these questions")!.click(); });
    expect(host.querySelector("[data-ask-when] [role=status]")!.textContent).toMatch(/^Couldn't copy/);
  });
});

describe("the AI's words: never on a closed row, never without the paper's sentence", () => {
  const states: [string, MeaningState][] = [
    ["still checking", { status: "loading", byId: {} }],
    ["check failed", { status: "error", byId: {} }],
    ["not confirmed", { status: "done", byId: Object.fromEntries(STEPS.map((s) => [s.id, result(s.id, { certified: false, model_verdict: "unclear" })])) }],
    ["flagged", { status: "done", byId: Object.fromEntries(STEPS.map((s) => [s.id, result(s.id, { certified: false, flagged: true })])) }],
  ];
  it.each(states)("%s: no AI explanation anywhere, even with every row opened", (_, m) => {
    render(m);
    for (const g of groups()) if (groupToggle(g).getAttribute("aria-expanded") === "false") act(() => groupToggle(g).click());
    for (const s of STEPS) act(() => stepToggle(s.id).click());
    expect(host.textContent).not.toContain("AI-PLAIN");
    for (const s of STEPS) expect(stepToggle(s.id).querySelector("[data-closed-row]")!.textContent).toMatch(/your paper says/i);
  });

  it("certified: closed rows still carry only the paper's words; the explanation shows inside, after the sentence", () => {
    render(certifiedAll);
    for (const s of STEPS) expect(stepToggle(s.id).textContent).not.toContain("AI-PLAIN");
    assertAiNeverWithoutQuote(STEPS);
    for (const g of groups()) if (groupToggle(g).getAttribute("aria-expanded") === "false") act(() => groupToggle(g).click());
    for (const s of STEPS) act(() => stepToggle(s.id).click());
    expect(host.textContent).toContain("AI-PLAIN bisacodyl");
    assertAiNeverWithoutQuote(STEPS);
    // A "do not" / "stop" line never gets an explanation, certified or not.
    expect(stepPanel(byQuote("Stop drinking all liquids").id).textContent).not.toContain("AI-PLAIN");
  });

  it("an uncertified closed row's words are the start of the paper's own sentence", () => {
    render();
    for (const s of STEPS.filter((x) => !prepMustSee(x))) {
      const shown = stepToggle(s.id).querySelector("[data-paper-quote]")!.textContent!.replace(/[“”]/g, "").replace(/…$/, "");
      expect(s.source_quote.replace(/\s+/g, " ").startsWith(shown)).toBe(true);
    }
  });

  it("a placed row names the time words from its own line, never the AI's guess", () => {
    render();
    const iron = byQuote("Stop taking iron pills");
    expect(stepToggle(iron.id).textContent).toContain("“7 days before your procedure”");
  });
});

describe("accessibility", () => {
  it("group headings hold disclosure buttons; every step is a disclosure for its own panel", () => {
    render();
    const check = () => {
      for (const g of groups()) {
        const b = groupToggle(g);
        expect(b.parentElement!.tagName).toBe("H3");
        const region = document.getElementById(b.getAttribute("aria-controls")!)!;
        expect(region.tagName).toBe("UL");
        // The controlled region is hidden exactly when the heading says collapsed (Codex review).
        expect(region.hidden).toBe(b.getAttribute("aria-expanded") === "false");
        // Open: every step of the group is in it, in paper order.
        if (!region.hidden) expect([...region.querySelectorAll("li[data-prep-step]")].map((li) => li.getAttribute("data-prep-step"))).toEqual(RES.timeline.find((x) => x.slot === g.dataset.prepGroup)!.steps.map((s) => s.id));
      }
    };
    check();
    for (const g of groups()) act(() => groupToggle(g).click());
    check();
    const toggles = [...host.querySelectorAll<HTMLButtonElement>("li[data-prep-step] > button[aria-expanded]")];
    expect(toggles).toHaveLength(STEPS.length);
    for (const b of toggles) {
      const panel = document.getElementById(b.getAttribute("aria-controls")!)!;
      expect(panel.hidden).toBe(b.getAttribute("aria-expanded") === "false");
      expect(b.closest("li")!.contains(panel)).toBe(true);
    }
    expect(host.querySelector("ol")!.getAttribute("aria-label")).toBe("Your prep timeline");
    expect(document.getElementById(host.querySelector("[data-ask-when]")!.getAttribute("aria-labelledby")!)?.tagName).toBe("H3");
    expect(host.querySelectorAll("button button")).toHaveLength(0);
  });
});
