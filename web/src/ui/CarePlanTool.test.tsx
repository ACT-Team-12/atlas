// @vitest-environment jsdom
/**
 * Late replies against the real component: each request is held open (a deferred fetch) while the person
 * changes something, then released, and the test checks what reached the screen.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Lets every awaited step of a released request run, without letting React render in between. */
async function drain() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
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
    await release(req, json(planFor("Plan for the OLD position")));

    expect(screenText()).not.toContain("Plan for the OLD position");
    expect(screenText()).toContain("You changed your answers, so we stopped building the plan.");
  });
});
