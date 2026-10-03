// @vitest-environment jsdom
/**
 * Late replies against the real component: each request is held open (a deferred fetch) while the person
 * changes something, then released, and the test checks what reached the screen.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { CarePlanTool } from "./CarePlanTool";

vi.mock("@/lib/deviceChecker", () => ({ loadDeviceChecker: () => Promise.reject(new Error("no wasm in tests")), sameSpan: () => false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred = { promise: Promise<Response>; resolve: (r: Response) => void };
function deferred(): Deferred {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A reply whose body is ready at once (microtasks only), so the test controls exactly when it is handled. */
const ready = (body: unknown, status = 200) => ({ ok: status < 400, status, body: null, headers: new Headers(), json: async () => body }) as unknown as Response;

const PAPER = "Take one tablet of metformin 500 mg twice a day with food. Come back in two weeks.";

function careFor(text: string, title = "Metformin"): CarePlanResponse {
  return {
    source_text: text, source_kind: "text", model: "test", has_warning_signs: false,
    items: [{ id: "c1", kind: "medication", title, plain_language: "Take it twice a day.", when: "twice a day", source_quote: "metformin 500 mg twice a day", grounded: true } as CarePlanResponse["items"][number]],
    refused: [], questions_for_doctor: [], not_in_document: [],
    stats: { extracted: 1, grounded: 1, refused: 0, ms: 10 },
  };
}

function planFor(summary: string): PlanResponse {
  return {
    summary, steps: [], resources: {}, located: { by: "device", label: "Near your current location" },
    ask_a_person: false, ask_a_person_reason: "", model: "test",
    stats: { steps: 0, candidates: 0, dropped_refs: 0 },
  } as unknown as PlanResponse;
}

let root: Root;
let host: HTMLDivElement;
let pending: Record<string, Deferred[]>;
let fetchCalls: { url: string; body: Record<string, unknown> }[];
let geo: { lat: number; lng: number };
let phone = false;
let scrolls: string[];

function hold(url: string) {
  const d = deferred();
  (pending[url] ??= []).push(d);
  return d;
}

beforeEach(() => {
  pending = {}; fetchCalls = []; scrolls = []; phone = false;
  geo = { lat: 33.75, lng: -84.39 };
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url === "/api/extract/stream") return Promise.resolve(new Response(null, { status: 404 })); // older deploy: use the plain route
    if (url === "/api/meaning") return Promise.resolve(json({ results: [] }));
    const queue = pending[url];
    if (queue?.length) return queue.shift()!.promise;
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("min-width: 48rem") ? phone : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: geo.lat, longitude: geo.lng } }) },
  });
  Element.prototype.scrollIntoView = function (this: Element) { scrolls.push(this.id); };
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

const byText = (t: string) => {
  const el = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(t));
  if (!el) throw new Error(`no button "${t}"`);
  return el as HTMLButtonElement;
};
const screenText = () => host.textContent ?? "";

/** Types into a React-controlled field the way a browser does (native setter, then an input event). */
function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const paperBox = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="After-visit summary text"]')!;
const noteBox = () => host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="e.g. no car"]')!;

/** Lets every awaited step of a released request run. */
async function drain() {
  await new Promise((r) => setTimeout(r, 0));
}

/** Runs only queued microtasks: a ready reply is handled, but React's scheduled render (a macrotask) is not. */
async function microtasks() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/**
 * Runs `fn` outside act(), the way a browser callback (geolocation, a timer) runs: React schedules the
 * resulting render as a later task instead of flushing it, which leaves the window a late reply can land in.
 */
async function outsideReact(fn: () => Promise<void> | void) {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try { await fn(); } finally { g.IS_REACT_ACT_ENVIRONMENT = true; }
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); // now let React catch up
}

async function release(d: Deferred, r: Response) {
  await act(async () => { d.resolve(r); await drain(); });
}

describe("device location changes while the plan is being built", () => {
  it("drops the plan for the old position and says why", async () => {
    act(() => byText("Getting there").click());
    act(() => byText("Or use my location").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    expect(fetchCalls.at(-1)?.body.location).toEqual({ lat: 33.75, lng: -84.39 });

    // The person refreshes their location: a different place, same "device" source.
    geo = { lat: 34.05, lng: -84.6 };
    act(() => byText("Using your location").click());
    await release(req, ready(planFor("Plan for the OLD position")));

    expect(screenText()).not.toContain("Plan for the OLD position");
    expect(screenText()).toContain("You changed your answers, so we stopped building the plan.");
  });
});


describe("a reply landing after a change, before React has re-rendered for it", () => {
  it("plan: a new device position arrives (a browser callback, not a click) and the old plan is not shown or saved", async () => {
    act(() => byText("Getting there").click());
    act(() => byText("Or use my location").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());

    // The next position is delivered later by the browser, outside any React event.
    let deliver: ((p: { coords: { latitude: number; longitude: number } }) => void) | null = null;
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: typeof deliver) => { deliver = ok; } } });
    act(() => byText("Using your location").click());
    expect(deliver).not.toBeNull();

    await outsideReact(async () => {
      deliver!({ coords: { latitude: 34.05, longitude: -84.6 } }); // React schedules this render; it has not run
      req.resolve(ready(planFor("Plan for the OLD position")));
      await microtasks(); // the reply is handled now, before that render and its effects
    });

    expect(screenText()).not.toContain("Plan for the OLD position");
    expect(screenText()).toContain("You changed your answers, so we stopped building the plan.");
    expect(Object.values({ ...localStorage }).join("")).not.toContain("Plan for the OLD position");
    expect(byText("Make my plan").disabled).toBe(false);
  });

  it("plan: an unchanged request still lands through the same path", async () => {
    act(() => byText("Getting there").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    await outsideReact(async () => { req.resolve(ready(planFor("Plan for the CURRENT answers"))); await microtasks(); });
    expect(screenText()).toContain("Plan for the CURRENT answers");
    expect(Object.values({ ...localStorage }).join("")).toContain("Plan for the CURRENT answers"); // so the save check above can see a save
  });

  it("plan: the note changes while the reply is on its way, and the old plan is dropped", async () => {
    act(() => byText("Getting there").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    await act(async () => {
      typeInto(noteBox(), "I work mornings");
      req.resolve(ready(planFor("Plan for the OLD answers")));
      await drain();
    });
    expect(screenText()).not.toContain("Plan for the OLD answers");
    expect(screenText()).toContain("You changed your answers, so we stopped building the plan.");
  });

  it("read: the paper changes while the reading is on its way, and the old reading is not shown or saved", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    expect(fetchCalls.some((c) => c.url === "/api/extract")).toBe(true);

    await act(async () => {
      typeInto(paperBox(), `${PAPER} Walk for 20 minutes a day.`);
      req.resolve(ready(careFor(PAPER, "Reading of the OLD text")));
      await drain();
    });

    expect(screenText()).not.toContain("Reading of the OLD text");
    expect(screenText()).toContain("You changed your paper or settings, so we stopped reading.");
    expect(Object.values({ ...localStorage }).join("")).not.toContain("Reading of the OLD text");
    expect(byText("Read my paper").disabled).toBe(false);
  });

  it("read: a reply for unchanged inputs still lands", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(req, ready(careFor(PAPER, "Reading of the CURRENT text")));
    expect(screenText()).toContain("Reading of the CURRENT text");
    expect(Object.values({ ...localStorage }).join("")).toContain("Reading of the CURRENT text");
  });
});
