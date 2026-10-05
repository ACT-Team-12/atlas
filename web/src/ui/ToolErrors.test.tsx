// @vitest-environment jsdom
/**
 * Lab results, prep, the quiz and feedback in another language (Codex review of PR 93, round 5): each threw the
 * route's English error and showed it. Now each shows a fixed line in the person's language and logs the server's
 * words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { ui, type Lang, type UiKey } from "@/lib/uiText";
import { LabResults } from "./LabResults";
import { PrepMode } from "./PrepMode";
import { Understand } from "./Understand";
import { Feedback } from "./Feedback";
import { UiLangProvider } from "./UiLang";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Reply = () => Promise<Response>;
let routes: Record<string, Reply>;
let root: Root, host: HTMLDivElement;
let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => { const r = routes[String(input)]; return r ? r() : Promise.resolve(json({}, 404)); }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const drain = () => new Promise((r) => setTimeout(r, 0));
function setValue(el: HTMLTextAreaElement | HTMLSelectElement, value: string, event: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}
async function press(label: string) {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(label));
  if (!b) throw new Error(`no button "${label}"`);
  await act(async () => { b.click(); await drain(); await drain(); });
}
const alertText = () => host.querySelector("[role=alert]")?.textContent ?? "";
const SERVER = "Something went wrong reading that document. Try again.";
const PAPER = "Glucose 130 mg/dL 70-99 H. Sodium 140 mmol/L 135-145. Do not eat after midnight before your procedure.";

/** A tool with its own language picker and text box (LabResults, PrepMode). */
async function ownPicker(lang: Lang, button: UiKey) {
  act(() => setValue(host.querySelector("select")!, lang, "change"));
  act(() => setValue(host.querySelector("textarea")!, PAPER, "input"));
  await press(ui(lang, button));
}

const FAILURES: [string, Reply, UiKey][] = [
  ["5xx", () => Promise.resolve(json({ error: SERVER }, 500)), "error.server"],
  ["4xx (rate limit)", () => Promise.resolve(json({ error: "You've made a lot of requests. Try again in about 10 minutes." }, 429)), "error.busy"],
  ["4xx (the AI declined)", () => Promise.resolve(json({ error: "The AI declined to read this report." }, 422)), "error.declined"],
  ["network failure", () => Promise.reject(new TypeError("Failed to fetch")), "error.network"],
];

describe("tools outside the main flow show failures in the person's language", () => {
  for (const [what, reply, key] of FAILURES) {
    it(`lab results, Vietnamese: ${what}`, async () => {
      routes = { "/api/results": reply };
      act(() => root.render(<LabResults />));
      await ownPicker("Vietnamese", "labs.show");
      expect(alertText()).toBe(ui("Vietnamese", key));
    });

    it(`prep, Chinese: ${what}`, async () => {
      routes = { "/api/prep": reply };
      act(() => root.render(<PrepMode />));
      await ownPicker("Chinese", "prep.build");
      expect(alertText()).toBe(ui("Chinese", key));
    });

    it(`quiz, Korean: ${what}`, async () => {
      routes = { "/api/understand": reply };
      const care = { source_text: PAPER, source_kind: "text" } as unknown as CarePlanResponse;
      const items = [{ id: "a", kind: "self_care", title: "T", source_quote: "Do not eat after midnight", grounded: true }] as unknown as VerifiedItem[];
      await act(async () => { root.render(<UiLangProvider language="Korean"><Understand care={care} items={items} language="Korean" /></UiLangProvider>); });
      await press(ui("Korean", "quiz.start"));
      expect(alertText()).toBe(ui("Korean", key));
    });

    it(`feedback, French: ${what}`, async () => {
      routes = { "/api/feedback": reply };
      act(() => root.render(<UiLangProvider language="French"><Feedback language="French" token="tok" /></UiLangProvider>));
      await press(ui("French", "fb.role.patient"));
      await press(ui("French", "fb.rating.5"));
      await press(ui("French", "fb.use.yes"));
      await press(ui("French", "fb.send"));
      expect(alertText()).toBe(ui("French", key));
    });
  }

  async function sendFeedback(reply: Reply) {
    routes = { "/api/feedback": reply };
    act(() => root.render(<UiLangProvider language="French"><Feedback language="French" token="tok" /></UiLangProvider>));
    for (const k of ["fb.role.patient", "fb.rating.5", "fb.use.yes", "fb.send"] as const) await press(ui("French", k));
  }

  it("feedback already saved (409) is a thank-you, not an error (Codex review, round 6)", async () => {
    await sendFeedback(() => Promise.resolve(json({ error: "We already have your answer for this plan. Thank you!" }, 409)));
    expect(alertText()).toBe("");
    expect(host.textContent).toContain(ui("French", "fb.thanks"));
  });

  it("an expired feedback link (403) says to make a new plan, and a save failure (503) says thank you anyway", async () => {
    await sendFeedback(() => Promise.resolve(json({ error: "This feedback link has expired. Make a new plan to rate it." }, 403)));
    expect(alertText()).toBe(ui("French", "fb.expired"));
    act(() => root.unmount());
    root = createRoot(host);
    await sendFeedback(() => Promise.resolve(json({ error: "We couldn't save that right now. Thank you anyway." }, 503)));
    expect(alertText()).toBe(ui("French", "fb.notSaved"));
  });

  it("the server's own words go to the console", async () => {
    routes = { "/api/results": () => Promise.resolve(json({ error: SERVER }, 500)) };
    act(() => root.render(<LabResults />));
    await ownPicker("Spanish", "labs.show");
    expect(logged.join("\n")).toContain(SERVER);
  });
});
