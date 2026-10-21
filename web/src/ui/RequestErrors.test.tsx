// @vitest-environment jsdom
/**
 * A failed read or plan in another language (Codex review of PR 93, round 4): the routes answer with fixed English
 * words ("Something went wrong building the plan. Try again."), and the tool used to show them as they came. Now the
 * person reads a fixed line in their language, and the server's words go to the console only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse } from "@/lib/schema";
import { ui, type Lang, type UiKey } from "@/lib/uiText";
import { CarePlanTool } from "./CarePlanTool";

vi.mock("@/lib/deviceChecker", () => ({ loadDeviceChecker: () => Promise.reject(new Error("no wasm in tests")), sameSpan: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE = JSON.parse(readFileSync(join(__dirname, "../../../mobile/ios/ATLASTests/Fixtures/extract_sample_live.json"), "utf8")) as CarePlanResponse;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Reply = () => Promise<Response>;
const ok = (body: unknown): Reply => () => Promise.resolve(json(body));
const fail = (status: number, error: string): Reply => () => Promise.resolve(json({ error }, status));
const offline: Reply = () => Promise.reject(new TypeError("Failed to fetch"));

let root: Root;
let host: HTMLDivElement;
let routes: Record<string, Reply>;
let logged: string[];

beforeEach(() => {
  localStorage.clear();
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const r = routes[String(input)];
    return r ? r() : Promise.reject(new Error(`no ${String(input)} in this test`));
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const drain = () => new Promise((r) => setTimeout(r, 0));
function setValue(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (label: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(label));
  if (!b) throw new Error(`no button "${label}"`);
  return b;
};
const alertText = () => host.querySelector("[role=alert]")?.textContent ?? "";

async function read(lang: Lang) {
  act(() => root.render(<CarePlanTool />));
  act(() => host.querySelector<HTMLInputElement>(`input[name="read-in-language"][value="${lang}"]`)!.click());
  act(() => setValue(host.querySelector<HTMLTextAreaElement>("#try textarea")!, SAMPLE.source_text));
  await act(async () => { button(ui(lang, "paper.read")).click(); await drain(); await drain(); await drain(); });
}

async function plan(lang: Lang) {
  await read(lang);
  await act(async () => { button(ui(lang, "barrier.transport")).click(); await drain(); });
  await act(async () => { button(ui(lang, "needs.makePlan")).click(); await drain(); await drain(); await drain(); });
}

const ROUTE_ENGLISH = "Something went wrong reading that document. Try again.";

describe("a failed read shows a fixed line in the person's language, never the server's English", () => {
  const cases: [string, () => Record<string, Reply>, UiKey][] = [
    ["4xx (the AI could not read it)", () => ({ "/api/extract/stream": () => Promise.resolve(new Response(null, { status: 404 })), "/api/extract": fail(422, "Could not read any text from that document.") }), "error.cantRead"],
    ["4xx on the stream itself (bad request)", () => ({ "/api/extract/stream": fail(400, "Invalid request.") }), "error.badRequest"],
    ["5xx", () => ({ "/api/extract/stream": () => Promise.resolve(new Response(null, { status: 404 })), "/api/extract": fail(500, ROUTE_ENGLISH) }), "error.server"],
    ["network failure", () => ({ "/api/extract/stream": offline, "/api/extract": offline }), "error.network"],
    ["rate limit", () => ({ "/api/extract/stream": fail(429, "You've made a lot of requests. Try again in about 10 minutes.") }), "error.busy"],
  ];
  for (const lang of ["Korean", "Amharic"] as const) {
    for (const [what, make, key] of cases) {
      it(`${lang}: ${what}`, { timeout: 30_000 }, async () => {
        routes = make();
        await read(lang);
        expect(alertText()).toBe(ui(lang, key));
        expect(alertText()).not.toMatch(/[A-Za-z]{3,} [A-Za-z]{3,}/); // no English sentence at all
      });
    }
  }

  it("the server's own words are kept for the console", { timeout: 30_000 }, async () => {
    routes = { "/api/extract/stream": () => Promise.resolve(new Response(null, { status: 404 })), "/api/extract": fail(500, ROUTE_ENGLISH) };
    await read("Spanish");
    expect(logged.join("\n")).toContain(ROUTE_ENGLISH);
  });
});

describe("a failed plan shows a fixed line in the person's language, never the server's English", () => {
  const readOk = { "/api/extract/stream": () => Promise.resolve(new Response(null, { status: 404 })), "/api/extract": ok(SAMPLE), "/api/meaning": ok({ results: [] }) };
  const cases: [string, Reply, UiKey][] = [
    ["4xx (nothing to plan for)", fail(400, "Pick at least one thing that gets in the way, or add your visit paper first."), "error.planNeeds"],
    ["4xx (the AI declined)", fail(422, "The AI declined to build this plan."), "error.cantPlan"],
    ["5xx", fail(500, "Something went wrong building the plan. Try again."), "error.server"],
    ["5xx with a body that is not JSON", () => Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502 })), "error.server"],
    ["503 (no AI key)", fail(503, "Server is missing its AI key. Tell the ATLAS team."), "error.unavailable"],
    ["network failure", offline, "error.network"],
  ];
  for (const lang of ["Vietnamese", "French"] as const) {
    for (const [what, reply, key] of cases) {
      it(`${lang}: ${what}`, { timeout: 30_000 }, async () => {
        routes = { ...readOk, "/api/plan": reply };
        await plan(lang);
        expect(alertText()).toBe(ui(lang, key));
        expect(alertText()).not.toMatch(/Something went wrong|Pick at least|The AI|Server is|Failed to fetch|Bad gateway/);
      });
    }
  }
});
