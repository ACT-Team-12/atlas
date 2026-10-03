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
    summary, steps: [], resources: {}, located: { by: "none", label: "No location given" },
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
  setScrollY(0);
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

/** Where the page is scrolled to (jsdom never moves on its own). */
function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

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

describe("automatic scroll after a reply", () => {
  const tabSelected = (t: number) => host.querySelector(`#tab-step-${t}`)?.getAttribute("aria-selected");

  async function planOnPhone(between: () => void) {
    phone = true;
    act(() => byText("Getting there").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    await outsideReact(async () => {
      req.resolve(ready(planFor("The new plan")));
      await microtasks(); // the reply is handled; the render that shows it has not run yet
      between();
    });
    expect(screenText()).toContain("The new plan");
  }

  it("phone, untouched: opens step 3 and brings it up", async () => {
    await planOnPhone(() => {});
    expect(tabSelected(3)).toBe("true");
    expect(scrolls).toContain("step-3");
  });

  it("phone: a tap after the reply but before the plan is shown leaves the person where they are", async () => {
    await planOnPhone(() => window.dispatchEvent(new Event("pointerdown")));
    expect(tabSelected(3)).toBe("false");
    expect(scrolls).not.toContain("step-3");
    expect(screenText()).toContain("Your plan is ready. Open 3 · Plan.");
  });

  it("phone: dragging the scrollbar (a scroll with no tap, wheel or key) counts as using the page", async () => {
    await planOnPhone(() => window.dispatchEvent(new Event("scroll")));
    expect(tabSelected(3)).toBe("false");
    expect(scrolls).not.toContain("step-3");
    expect(screenText()).toContain("Your plan is ready. Open 3 · Plan.");
  });

  it("desktop: the page's own smooth scroll still moving does not count as the person scrolling", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    expect(scrolls).toEqual(["step-2"]); // the automatic scroll after a read (desktop)

    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    window.dispatchEvent(new Event("scroll")); // that smooth scroll is still firing scroll events
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2", "step-3"]);
  });
});

describe("a result the person changed their answers after", () => {
  const saved = () => {
    const raw = localStorage.getItem("atlas-plans-v2");
    return raw ? (JSON.parse(raw).plans as { note: string; zip: string; text: string; plan: { summary: string } | null; care: { items: { title: string }[] } | null }[]) : [];
  };
  const PLAN_OUTDATED = "You changed your answers after this plan was made";
  const CARE_OUTDATED = "You changed your paper or settings after we read it";

  function remount() {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<CarePlanTool />));
  }

  async function makePlan(summary: string) {
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    await release(req, ready(planFor(summary)));
    expect(screenText()).toContain(summary);
  }

  it("plan: a later note keeps the plan on screen, labelled outdated, and does not save the new note beside it", async () => {
    act(() => byText("Getting there").click());
    await makePlan("Plan for no note");
    expect(saved()[0]).toMatchObject({ note: "", plan: { summary: "Plan for no note" } });
    expect(screenText()).not.toContain(PLAN_OUTDATED);

    act(() => typeInto(noteBox(), "I work mornings"));
    expect(screenText()).toContain("Plan for no note"); // not silently gone
    expect(screenText()).toContain(PLAN_OUTDATED);
    expect(saved()[0]).toMatchObject({ note: "", plan: { summary: "Plan for no note" } }); // the saved pair still matches

    // One tap rebuilds it for the new answers; then it is current and saved with them.
    const req = hold("/api/plan");
    act(() => byText("Update plan").click());
    expect(fetchCalls.at(-1)?.body.note).toBe("I work mornings");
    await release(req, ready(planFor("Plan for mornings")));
    expect(screenText()).not.toContain(PLAN_OUTDATED);
    expect(saved()[0]).toMatchObject({ note: "I work mornings", plan: { summary: "Plan for mornings" } });
  });

  it("plan: a ZIP typed after a plan for the device location marks it outdated", async () => {
    act(() => byText("Getting there").click());
    act(() => byText("Or use my location").click());
    await makePlan("Plan near the device");
    act(() => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30340"));
    expect(screenText()).toContain(PLAN_OUTDATED);
    expect(saved()[0].zip).toBe("");
  });

  it("plan: removing a step the plan was built from marks it outdated", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    await makePlan("Plan with metformin");
    act(() => (host.querySelector('button[aria-label="Remove Metformin"]') as HTMLButtonElement).click());
    expect(screenText()).toContain(PLAN_OUTDATED);
  });

  it("reopening: a saved plan comes back current, with the answers it was built for", async () => {
    act(() => byText("Getting there").click());
    await makePlan("Plan for no note");
    act(() => typeInto(noteBox(), "I work mornings")); // outdated, not saved
    remount();
    expect(screenText()).toContain("Plan for no note");
    expect(noteBox().value).toBe("");
    expect(screenText()).not.toContain(PLAN_OUTDATED);
  });

  it("read: editing the paper after it was read keeps the steps, labelled outdated, and does not save the new text", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER, "Metformin twice a day")));
    expect(saved()[0].text).toBe(PAPER);

    act(() => typeInto(paperBox(), `${PAPER} Walk for 20 minutes a day.`));
    expect(screenText()).toContain("Metformin twice a day");
    expect(screenText()).toContain(CARE_OUTDATED);
    expect(saved()[0].text).toBe(PAPER);

    remount();
    expect(paperBox().value).toBe(PAPER);
    expect(screenText()).not.toContain(CARE_OUTDATED);
  });

  it("read: a plan built from steps of an older paper is outdated too", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    await makePlan("Plan from the first paper");
    act(() => typeInto(paperBox(), "A different paper about a knee brace, worn every day for six weeks."));
    expect(screenText()).toContain(CARE_OUTDATED);
    expect(screenText()).toContain("Read it again in step 1, then make a new plan");
  });
});

describe("the person scrolling while the page's own scroll is still moving", () => {
  async function readThenPressPlan() {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    expect(scrolls).toEqual(["step-2"]); // the automatic smooth scroll after a read (desktop) has started
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    return req;
  }

  it("a scrollbar drag away from where the page was going counts, so the plan does not pull them back", async () => {
    const req = await readThenPressPlan();
    setScrollY(900); // dragged well off the path to step 2
    window.dispatchEvent(new Event("scroll"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2"]);
  });

  it("the page's own scroll ending somewhere else (the person stopped it) counts", async () => {
    const req = await readThenPressPlan();
    setScrollY(40);
    window.dispatchEvent(new Event("scrollend"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2"]);
  });

  it("the page's own scroll ending where it was going does not count", async () => {
    const req = await readThenPressPlan();
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scrollend"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2", "step-3"]);
  });
});

describe("an outdated plan cannot be acted on", () => {
  const LAB_PAPER = `${PAPER} Get an A1c blood test before your next visit.`;
  function careWithLab(): CarePlanResponse {
    const c = careFor(LAB_PAPER);
    c.items.push({ id: "c2", kind: "lab_test", title: "A1c test", plain_language: "Get a blood test.", when: "before your next visit", source_quote: "Get an A1c blood test", grounded: true } as CarePlanResponse["items"][number]);
    return c;
  }
  function planWithLab(summary: string): PlanResponse {
    const p = planFor(summary);
    p.steps = [{ title: "Book the A1c test", action: "Call to book it.", why: "", barrier: null, care_ids: ["c2"], resource_ids: [], dropped_refs: [] } as unknown as PlanResponse["steps"][number]];
    return p;
  }
  const ACTIONS = ["Read it out loud", "Print a handoff sheet", "Send to family", "Book it now"];
  const enabled = () => Object.fromEntries(ACTIONS.map((t) => [t, !byText(t).disabled]));
  const all = (v: boolean) => Object.fromEntries(ACTIONS.map((t) => [t, v]));
  let speech: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    speech = { speak: vi.fn(), cancel: vi.fn() };
    vi.stubGlobal("speechSynthesis", speech);
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  });

  async function planReady() {
    act(() => typeInto(paperBox(), LAB_PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careWithLab()));
    act(() => byText("Getting there").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    await release(req, ready(planWithLab("Plan with the A1c test")));
    expect(enabled()).toEqual(all(true));
    expect(screenText()).not.toContain("Update the plan first");
  }

  const selectValue = (label: string, value: string) => {
    const sel = [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const changes: [string, () => void][] = [
    ["place (a ZIP typed)", () => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30340")],
    ["barriers", () => byText("Paying for the visit").click()],
    ["language", () => selectValue("Explain it in", "Spanish")],
    ["a removed step", () => (host.querySelector('button[aria-label="Remove Metformin"]') as HTMLButtonElement).click()],
  ];
  for (const [what, change] of changes) {
    it(`after changing ${what}: read aloud, handoff print, Send to family and Book it now are off, with the reason`, async () => {
      await planReady();
      act(change);
      expect(enabled()).toEqual(all(false));
      expect(screenText()).toContain("Plan with the A1c test"); // still shown, labelled
      expect(screenText()).toMatch(/Update the plan first|Read your paper again first/);
    });
  }

  it("speech in progress stops when the plan goes out of date", async () => {
    await planReady();
    act(() => byText("Read it out loud").click());
    expect(speech.speak).toHaveBeenCalled();
    expect(byText("Stop reading")).toBeTruthy();
    speech.cancel.mockClear();
    act(() => byText("Paying for the visit").click());
    expect(speech.cancel).toHaveBeenCalled();
    expect(byText("Read it out loud").disabled).toBe(true);
  });

  it("updating the plan turns the actions back on", async () => {
    await planReady();
    act(() => byText("Paying for the visit").click());
    const req = hold("/api/plan");
    act(() => byText("Update plan").click());
    await release(req, ready(planWithLab("Updated plan")));
    expect(enabled()).toEqual(all(true));
  });
});

describe("reopening a plan built from the device location", () => {
  const LOCATION_AGAIN = "Use my location again or enter a ZIP";
  function remount() {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<CarePlanTool />));
  }
  async function devicePlanThenReopen() {
    act(() => byText("Getting there").click());
    act(() => byText("Or use my location").click());
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    const devicePlan = planFor("Plan near the old position");
    devicePlan.located = { by: "device", label: "Near your current location" };
    await release(req, ready(devicePlan));
    const raw = localStorage.getItem("atlas-plans-v2") ?? "";
    expect(raw).toContain("Plan near the old position");
    expect(raw).not.toContain("33.75"); // the position itself is never saved
    remount();
    expect(screenText()).toContain("Plan near the old position");
  }

  it("comes back outdated, asks for a place, and keeps its actions off", async () => {
    await devicePlanThenReopen();
    expect(screenText()).toContain(LOCATION_AGAIN);
    expect(byText("Update plan").disabled).toBe(true);
    expect(byText("Read it out loud").disabled).toBe(true);
    expect(byText("Print a handoff sheet").disabled).toBe(true);
  });

  it("a fresh position, then Update plan, makes it current again", async () => {
    await devicePlanThenReopen();
    geo = { lat: 34.05, lng: -84.6 };
    act(() => byText("Or use my location").click());
    expect(byText("Update plan").disabled).toBe(false);
    const req = hold("/api/plan");
    act(() => byText("Update plan").click());
    expect(fetchCalls.at(-1)?.body.location).toEqual({ lat: 34.05, lng: -84.6 });
    await release(req, ready(planFor("Plan near the new position")));
    expect(screenText()).not.toContain(LOCATION_AGAIN);
    expect(byText("Read it out loud").disabled).toBe(false);
  });

  it("a ZIP works too", async () => {
    await devicePlanThenReopen();
    act(() => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30340"));
    expect(screenText()).not.toContain(LOCATION_AGAIN);
    const req = hold("/api/plan");
    act(() => byText("Update plan").click());
    expect(fetchCalls.at(-1)?.body.zip).toBe("30340");
    await release(req, ready(planFor("Plan near 30340")));
    expect(byText("Read it out loud").disabled).toBe(false);
  });

  it("a reopened ZIP plan is still current", async () => {
    act(() => byText("Getting there").click());
    act(() => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30030"));
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    const zipPlan = planFor("Plan near 30030");
    zipPlan.located = { by: "zip", label: "Near ZIP 30030" };
    await release(req, ready(zipPlan));
    remount();
    expect(screenText()).toContain("Plan near 30030");
    expect(byText("Read it out loud").disabled).toBe(false);
  });
});

describe("a size change during the page's own scroll", () => {
  let observers: ResizeObserverCallback[];
  beforeEach(() => {
    observers = [];
    vi.stubGlobal("ResizeObserver", class { constructor(cb: ResizeObserverCallback) { observers.push(cb); } observe() {} unobserve() {} disconnect() {} });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5_000 });
    // Remount so the component picks up the stubbed ResizeObserver.
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<CarePlanTool />));
  });
  afterEach(() => { delete (document.documentElement as unknown as { scrollHeight?: number }).scrollHeight; });

  async function readThenLayoutShift() {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    expect(scrolls).toEqual(["step-2"]); // the page's own smooth scroll has started
    // Content above grows; the browser keeps the view in place, which moves scrollY.
    setScrollY(300);
    act(() => observers.forEach((cb) => cb([], {} as ResizeObserver)));
    await new Promise((r) => setTimeout(r, 140)); // past the moment right after the size change
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    return req;
  }

  it("a scrollbar drag off the re-aimed path still counts as the person", async () => {
    const req = await readThenLayoutShift();
    setScrollY(900);
    window.dispatchEvent(new Event("scroll"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2"]);
  });

  it("staying on the re-aimed path does not", async () => {
    const req = await readThenLayoutShift();
    window.dispatchEvent(new Event("scroll"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2", "step-3"]);
  });
});

describe("refreshing the device location", () => {
  type Pos = { coords: { latitude: number; longitude: number } };
  let calls: { ok: (p: Pos) => void; fail: () => void }[];
  const controlledGeo = () => {
    calls = [];
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: Pos) => void, fail: () => void) => { calls.push({ ok, fail }); } } });
  };
  const pos = (lat: number, lng: number): Pos => ({ coords: { latitude: lat, longitude: lng } });
  const PLAN_OUTDATED = "You changed your answers after this plan was made";

  async function devicePlan() {
    act(() => byText("Getting there").click());
    act(() => byText("Or use my location").click()); // default stub: answers at once with 33.75, -84.39
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    const p = planFor("Plan near the first position");
    p.located = { by: "device", label: "Near your current location" };
    await release(req, ready(p));
    expect(byText("Read it out loud").disabled).toBe(false);
    controlledGeo();
  }

  it("a refresh that fails leaves the plan outdated with its actions off, not current on the old position", async () => {
    await devicePlan();
    act(() => byText("Using your location").click());
    act(() => calls[0].fail());
    expect(screenText()).toContain("Plan near the first position");
    expect(screenText()).toMatch(/Use my location again or enter a ZIP|You changed your answers after this plan was made/);
    expect(byText("Read it out loud").disabled).toBe(true);
    expect(screenText()).toContain("Location wasn't shared");
  });

  it("while a refresh is pending, the plan is outdated", async () => {
    await devicePlan();
    act(() => byText("Using your location").click());
    expect(byText("Read it out loud").disabled).toBe(true);
    expect(byText("Update plan").disabled).toBe(true); // no place to update with yet
  });

  it("overlapping requests: only the latest counts, a late answer to an earlier one is ignored", async () => {
    await devicePlan();
    act(() => byText("Using your location").click()); // request 1
    act(() => byText("Finding your location").click()); // request 2
    act(() => calls[0].ok(pos(40, -80))); // late answer to request 1
    expect(byText("Update plan").disabled).toBe(true);
    act(() => calls[1].ok(pos(34.05, -84.6)));
    const req = hold("/api/plan");
    act(() => byText("Update plan").click());
    expect(fetchCalls.at(-1)?.body.location).toEqual({ lat: 34.05, lng: -84.6 });
    await release(req, ready(planFor("Plan near the second position")));
    expect(screenText()).not.toContain(PLAN_OUTDATED);
  });

  it("the latest request failing after an earlier one succeeded late still leaves no position", async () => {
    await devicePlan();
    act(() => byText("Using your location").click());
    act(() => byText("Finding your location").click());
    act(() => calls[0].ok(pos(40, -80)));
    act(() => calls[1].fail());
    expect(byText("Read it out loud").disabled).toBe(true);
    expect(byText("Or use my location")).toBeTruthy();
  });

  it("a ZIP typed while a refresh is pending wins over its later answer", async () => {
    await devicePlan();
    act(() => byText("Using your location").click());
    act(() => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30340"));
    act(() => calls[0].ok(pos(40, -80)));
    expect(host.querySelector<HTMLInputElement>("#zip")!.value).toBe("30340");
    const req = hold("/api/plan");
    act(() => byText("Update plan").click());
    expect(fetchCalls.at(-1)?.body).toMatchObject({ zip: "30340" });
    expect(fetchCalls.at(-1)?.body.location).toBeUndefined();
    await release(req, ready(planFor("Plan near 30340")));
  });
});
