// @vitest-environment jsdom
/**
 * The plan screen, "Start with 3 calls", against the real component and the live demo plan (sample paper near 30303,
 * mobile/ios/ATLASTests/Fixtures). Checks the top three, the one-line rows, opening and closing them, accessibility
 * attributes, and that read aloud, Send to family and print still carry the whole plan.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { speechLines } from "@/lib/speechText";
import { planStepQuotes } from "@/lib/planQuotes";
import { STORE_KEY } from "@/lib/savedPlans";
import { CarePlanTool } from "./CarePlanTool";

vi.mock("@/lib/deviceChecker", () => ({ loadDeviceChecker: () => Promise.reject(new Error("no wasm in tests")), sameSpan: () => false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIX = join(process.cwd(), "../mobile/ios/ATLASTests/Fixtures");
const CARE = JSON.parse(readFileSync(join(FIX, "extract_sample_live.json"), "utf8")) as CarePlanResponse;
const PLAN = JSON.parse(readFileSync(join(FIX, "plan_sample_30303_live.json"), "utf8")) as PlanResponse;
const fresh = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

let root: Root;
let host: HTMLDivElement;
let speech: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };

const ready = (body: unknown) => ({ ok: true, status: 200, body: null, headers: new Headers(), json: async () => body }) as unknown as Response;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/extract/stream") return Promise.resolve(new Response(null, { status: 404 }));
    if (url === "/api/extract") return Promise.resolve(ready(fresh(CARE)));
    if (url === "/api/meaning") return Promise.resolve(ready({ results: [] }));
    if (url === "/api/plan") return Promise.resolve(ready(fresh(PLAN)));
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  speech = { speak: vi.fn(), cancel: vi.fn() };
  vi.stubGlobal("speechSynthesis", speech);
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<CarePlanTool />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const drain = () => new Promise((r) => setTimeout(r, 0));
const byText = (t: string, scope: ParentNode = host) => {
  const el = [...scope.querySelectorAll("button")].find((b) => b.textContent?.includes(t));
  if (!el) throw new Error(`no button "${t}"`);
  return el as HTMLButtonElement;
};
function typeInto(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function planReady() {
  act(() => typeInto(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="After-visit summary text"]')!, CARE.source_text));
  await act(async () => { byText("Read my paper").click(); await drain(); await drain(); });
  act(() => byText("Getting there").click());
  act(() => byText("Paying for the visit").click());
  await act(async () => { byText("Make my plan").click(); await drain(); await drain(); });
  const card = host.querySelector<HTMLElement>("#step-3");
  if (!card) throw new Error("no plan card");
  return card;
}

/** Folded: inside a closed fold (class plan-shut) or a hidden panel. */
const isFolded = (el: Element) => !!el.closest(".plan-shut, [hidden]");
const shut = (el: Element) => el.classList.contains("plan-shut");
const topList = (card: Element) => card.querySelector('[aria-labelledby="plan-top-title"] ol')!;
const rows = (card: Element) => [...card.querySelectorAll<HTMLLIElement>('[aria-labelledby="plan-rows-title"] ol > li')];
const rowToggle = (row: Element) => row.querySelector<HTMLButtonElement>("h5 > button")!;

// Each test renders the whole plan screen from a recorded live plan in jsdom (1 to 4 s alone). Under the full parallel
// suite on a small machine some crossed vitest's 5 s default, so this block gets an explicit, generous timeout.
describe("plan screen: start with 3 calls", { timeout: 30_000 }, () => {
  it("opens with the summary, the suggestions label, the top 3 and the needs-a-person note, none of them folded", async () => {
    const card = await planReady();
    const label = [...card.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Suggestions from ATLAS, not your paper"))!;
    expect(label).toBeTruthy();
    expect(isFolded(label)).toBe(false);
    expect(card.textContent).toContain(PLAN.summary);
    const heading = card.querySelector("#plan-top-title")!;
    expect(heading.tagName).toBe("H4");
    expect(heading.textContent).toBe("Start with these 3");
    const tops = [...topList(card).querySelectorAll(":scope > li")];
    expect(tops.map((li) => li.querySelector("h5")?.textContent)).toEqual(["Mercy Care at Gateway Center", "Mercy Care Decatur Street", "Georgia Medicaid: how to apply"]);
    // One big action each: a call for the clinics (verified numbers), Apply online for the Medicaid page.
    expect(tops.map((li) => li.querySelector("a.block")?.textContent)).toEqual(["Call 404-880-3719", "Call 678-843-8600", "Apply online ↗"]);
    // The person picked 2 barriers (getting there, paying); the plan has 6 steps. The count is out of the 2.
    expect(tops.map((li) => li.querySelector("p")?.textContent?.trim())).toEqual(Array(3).fill("Helps with 1 of the 2 problems you named: Paying for the visit, lab or medicine"));
    expect(card.textContent).not.toMatch(/of your 6 problems/);
    expect(tops[0].textContent).toContain("Paying for the visit, lab or medicine");
    expect(tops[2].textContent).toContain("Verified on the official page");
    const person = [...card.querySelectorAll("p")].find((p) => p.textContent === "This needs a person too")!;
    expect(person).toBeTruthy();
    expect(isFolded(person)).toBe(false);
    expect(card.textContent).toContain(PLAN.ask_a_person_reason);
    // First screen: the note comes right after the summary, before the actions and the three calls.
    const note = person.closest("div")!;
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows([...card.querySelectorAll("p")].find((p) => p.textContent === PLAN.summary)!, note)).toBe(true);
    expect(follows(note, card.querySelector(".plan-dock")!)).toBe(true);
    expect(follows(note, heading)).toBe(true);
  });

  it("shows each program once at the top, even when several problems use it", async () => {
    const plan = fresh(PLAN);
    plan.steps[3].resource_ids.push("georgia-gateway"); // used by two steps now
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/plan") return Promise.resolve(ready(plan));
      if (url === "/api/extract") return Promise.resolve(ready(fresh(CARE)));
      if (url === "/api/meaning") return Promise.resolve(ready({ results: [] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const card = await planReady();
    const names = [...topList(card).querySelectorAll("h5")].map((h) => h.textContent);
    expect(names[0]).toContain("Georgia Gateway");
    expect(new Set(names).size).toBe(names.length);
    // Gateway now helps with both problems the person named (paying, getting there), so it leads.
    expect(topList(card).querySelectorAll(":scope > li")[0].textContent).toContain("Helps with 2 of the 2 problems you named");
  });

  it("lists every plan step as one line, folded, with a heading button that opens and closes it", async () => {
    const card = await planReady();
    expect(card.querySelector("#plan-rows-title")?.textContent).toBe("Your plan, 6 steps");
    const list = rows(card);
    expect(list).toHaveLength(PLAN.steps.length);
    list.forEach((row, i) => {
      const t = rowToggle(row);
      expect(t.textContent).toContain(PLAN.steps[i].title);
      expect(t.getAttribute("aria-expanded")).toBe("false");
      const body = document.getElementById(t.getAttribute("aria-controls")!)!;
      expect(body).toBeTruthy();
      expect(shut(body)).toBe(true);
      expect(body.classList.contains("plan-fold")).toBe(true); // printed in full
    });
    const t = rowToggle(list[0]);
    const body = document.getElementById(t.getAttribute("aria-controls")!)!;
    act(() => t.click());
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(shut(body)).toBe(false);
    expect(body.textContent).toContain(PLAN.steps[0].action);
    expect(body.textContent).toContain("Best option");
    act(() => t.click());
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(shut(body)).toBe(true);
  });

  it("keeps the paper's own words right next to the plan text, and puts the why and the verified quotes behind Why this?", async () => {
    const card = await planReady();
    const row = rows(card)[0];
    act(() => rowToggle(row).click());
    const body = document.getElementById(rowToggle(row).getAttribute("aria-controls")!)!;
    const quotes = planStepQuotes(PLAN.steps[0], CARE.items);
    expect(quotes.length).toBeGreaterThan(0);
    const shown = [...body.querySelectorAll("[data-paper-quote]")].filter((q) => !isFolded(q)).map((q) => q.textContent);
    for (const q of quotes) expect(shown.some((s) => s?.includes(q))).toBe(true);
    const why = byText("Why this?", body);
    const whyBody = document.getElementById(why.getAttribute("aria-controls")!)!;
    expect(why.getAttribute("aria-expanded")).toBe("false");
    expect(shut(whyBody)).toBe(true);
    act(() => why.click());
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(shut(whyBody)).toBe(false);
    expect(whyBody.textContent).toContain(PLAN.steps[0].why);
    // One seal per program, with the line quoted from its official page.
    const gateway = PLAN.resources["georgia-gateway"];
    if (gateway.type !== "program") throw new Error("fixture changed");
    expect(whyBody.textContent).toContain(gateway.program.evidence_quote);
    expect(whyBody.textContent).toContain("Verified on the official page");
  });

  it("other options and Book it now are reachable inside the row", async () => {
    const card = await planReady();
    const row = rows(card)[0]; // three programs: one best, two others
    act(() => rowToggle(row).click());
    const more = byText("2 other options", row);
    const moreBody = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(shut(moreBody)).toBe(true);
    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(moreBody.textContent).toContain("Grady Health System Financial Assistance Program");
    const book = byText("Book it now", card);
    expect(book.closest("li")).toBe(rows(card).find((r) => r.contains(book)));
  });

  it("ticks a problem off, says so, and saves the tick with the plan", async () => {
    const card = await planReady();
    const box = rows(card)[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.getAttribute("aria-label")).toBe(`Done: ${PLAN.steps[1].title}`);
    act(() => box.click());
    expect(box.checked).toBe(true);
    expect(rowToggle(rows(card)[1]).textContent).toContain("done");
    const saved = JSON.parse(localStorage.getItem(STORE_KEY)!);
    expect(saved.plans[0].done["plan:1"]).toBe(true);
  });

  it("What to say opens Book it now's lines for that place, as a disclosure", async () => {
    const card = await planReady();
    const first = topList(card).querySelector("li")!;
    const say = byText("What to say", first);
    const panel = document.getElementById(say.getAttribute("aria-controls")!)!;
    expect(say.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    act(() => say.click());
    expect(say.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("Hi, I'm calling about Mercy Care at Gateway Center.");
    expect(panel.textContent).toContain("I'm worried about the cost.");
  });

  it("puts the plan's actions in one labelled group: Listen, Call me, Send, Print, Handoff", async () => {
    const card = await planReady();
    const dock = card.querySelector('[role="group"][aria-label="Plan actions"]')!;
    expect(dock.classList.contains("plan-dock")).toBe(true);
    for (const t of ["Read it out loud", "Send to family", "Print for the next visit", "Print a handoff sheet"]) expect(dock.contains(byText(t))).toBe(true);
    // Phones show one word (the long words are hidden there by CSS), wider screens the full words.
    expect(byText("Read it out loud").querySelector(".md\\:hidden")?.textContent).toBe("Listen");
  });

  it("Call me with my plan is in the bar when calls are on (as in production), with its full name on wide screens", async () => {
    const plan = { ...fresh(PLAN), speak_token: "signed" };
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/plan") return Promise.resolve(ready(plan));
      if (url === "/api/extract") return Promise.resolve(ready(fresh(CARE)));
      if (url === "/api/meaning") return Promise.resolve(ready({ results: [] }));
      if (url === "/api/call/config") return Promise.resolve(ready({ enabled: true, languages: ["English"] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const card = await planReady();
    await act(async () => { await drain(); });
    const dock = card.querySelector(".plan-dock")!;
    const call = byText("Call me with my plan", dock);
    expect(call.querySelector(".md\\:hidden")?.textContent).toBe("Call me");
    // Bar order: Listen, Call me, Send, Print, Handoff.
    const names = [...dock.querySelectorAll(":scope > button")].map((b) => b.querySelector(".md\\:hidden")?.textContent);
    expect(names).toEqual(["Listen", "Call me", "Send", "Print", "Handoff"]);
    expect(call.getAttribute("aria-expanded")).toBe("false");
  });

  it("read aloud still says the whole plan: every step and the paper's words", async () => {
    await planReady();
    act(() => byText("Read it out loud").click());
    const said = speech.speak.mock.calls.map(([u]) => (u as { text: string }).text);
    expect(said).toEqual(speechLines(PLAN, CARE.items.filter((i) => i.grounded)));
    for (const s of PLAN.steps) expect(said.join("\n")).toContain(`${s.title}. ${s.action}`);
  });

  it("Send to family still sends the whole plan", async () => {
    await planReady();
    act(() => byText("Send to family").click());
    const text = host.querySelector<HTMLTextAreaElement>("textarea[readonly]")!.value;
    expect(text).toContain(PLAN.summary);
    for (const s of PLAN.steps) {
      expect(text).toContain(s.title);
      expect(text).toContain(s.action);
    }
  });

  it("print: every step, its why, the paper's words and every option are in the page, folded parts marked to print", async () => {
    const card = await planReady();
    const all = card.textContent!;
    for (const s of PLAN.steps) {
      for (const t of [s.title, s.action, s.why, ...planStepQuotes(s, CARE.items)]) expect(all).toContain(t);
      for (const id of s.resource_ids) {
        const r = PLAN.resources[id];
        expect(all).toContain(r.type === "clinic" ? r.clinic.name : r.program.name);
      }
    }
    // Everything folded in the rows is in a .plan-fold, which the print stylesheet shows.
    expect(card.querySelectorAll('[aria-labelledby="plan-rows-title"] [hidden]')).toHaveLength(0);
    const folds = card.querySelectorAll('[aria-labelledby="plan-rows-title"] .plan-shut');
    expect(folds.length).toBeGreaterThan(0);
    for (const el of folds) expect(el.classList.contains("plan-fold")).toBe(true);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\s+/g, " ");
    expect(css).toContain(".plan-fold.plan-shut { display: none; }");
    expect(css).toContain(".plan-fold.plan-shut { display: block !important; }");
    // Print hides every button under #try; each step title is inside its row button, so that button is printed.
    for (const row of rows(card)) expect(row.querySelector(".plan-rowhead > button")).not.toBeNull();
    expect(css).toContain("#try .plan-rowhead > button { display: flex !important; }");
  });
});
