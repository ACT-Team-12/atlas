// @vitest-environment jsdom
/**
 * Late replies against the real component: each request is held open (a deferred fetch) while the person
 * changes something, then released, and the test checks what reached the screen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { CarePlanTool } from "./CarePlanTool";
import { ui, type UiKey } from "@/lib/uiText";
import { failureKey, RequestFailed } from "@/lib/requestError";
import { CHECK_POLICY, checksKey } from "@/lib/savedPlans";
import { SAMPLE_AVS } from "@/lib/sample";
import { TRY_SAMPLE_EVENT } from "@/lib/sampleStart";

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
let fetchCalls: { url: string; body: Record<string, unknown>; method?: string; hasBody?: boolean }[];
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
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {}, method: init?.method ?? "GET", hasBody: init?.body != null });
    if (url === "/api/extract/stream") return Promise.resolve(new Response(null, { status: 404 })); // older deploy: use the plain route
    if (url === "/api/plan/stream") return Promise.resolve(new Response(null, { status: 404 })); // older deploy: use the plain route
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
    await planOnPhone(() => { setScrollY(240); window.dispatchEvent(new Event("scroll")); }); // a drag moves the page
    expect(tabSelected(3)).toBe("false");
    expect(scrolls).not.toContain("step-3");
    expect(screenText()).toContain("Your plan is ready. Open 3 · Plan.");
  });

  it("phone, untouched: a scroll event that does not move the page (content appearing) does not stop step 3 opening", async () => {
    // Akhil, Oct 4: measured live, pressing Make my plan inserts the working card and Chrome fires a scroll event at the
    // same scrollY. Nothing moved, so it is not the person.
    await planOnPhone(() => window.dispatchEvent(new Event("scroll")));
    expect(tabSelected(3)).toBe("true");
    expect(scrolls).toContain("step-3");
  });

  it("phone: scrolling inside a box (not the page) while the plan is built still counts as using the page", async () => {
    const box = document.createElement("div");
    host.appendChild(box);
    await planOnPhone(() => box.dispatchEvent(new Event("scroll"))); // the page itself does not move
    expect(tabSelected(3)).toBe("false");
    expect(screenText()).toContain("Your plan is ready. Open 3 · Plan.");
    box.remove();
  });

  // Oct 4 watched tries: both testers scrolled away while the AI worked; one never found her plan.
  const cue = () => host.querySelector<HTMLElement>("[data-ready-cue]");

  it("phone, untouched: no ready cue (the page takes them there itself)", async () => {
    await planOnPhone(() => {});
    expect(cue()).toBeNull();
  });

  it("phone, moved on during the wait: a 'Your plan is ready' button appears, and Show me opens step 3", async () => {
    await planOnPhone(() => window.dispatchEvent(new Event("pointerdown")));
    expect(cue()?.dataset.readyCue).toBe("plan");
    expect(cue()?.textContent).toContain("Your plan is ready");
    act(() => cue()!.querySelector("button")!.click());
    expect(tabSelected(3)).toBe("true");
    expect(scrolls).toContain("step-3");
    expect(cue()).toBeNull();
    // Focus follows to the plan's heading (Codex review), after step 3 has rendered.
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(document.activeElement?.id).toBe("plan-title");
  });

  it("phone: one announcement per plan (the tab bar's note speaks; the cue's live region stays quiet)", async () => {
    await planOnPhone(() => window.dispatchEvent(new Event("pointerdown")));
    const speaking = [...host.querySelectorAll("[aria-live], [role=status]")].filter((n) => /Your plan is ready/.test(n.textContent ?? ""));
    expect(speaking).toHaveLength(1);
  });

  it("the cue goes away when the plan it announced becomes outdated (Codex review)", async () => {
    await planOnPhone(() => window.dispatchEvent(new Event("pointerdown")));
    expect(cue()).not.toBeNull();
    expect(screenText()).toContain("Your plan is ready. Open 3 · Plan.");
    act(() => byText("Paying for the visit").click()); // a changed answer: the plan on screen is now outdated
    expect(cue()).toBeNull();
    // The tab bar's note holds to the same rule: it never sends them to an outdated plan (Codex review, round 4).
    expect(screenText()).not.toContain("Your plan is ready");
  });

  it("desktop: a tap after the reading lands but before its scroll runs raises the cue instead (Codex review, round 4)", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await outsideReact(async () => {
      read.resolve(ready(careFor(PAPER)));
      await microtasks(); // the reply is handled and its scroll queued; the render that runs it has not happened yet
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(scrolls).not.toContain("step-2");
    expect(cue()?.dataset.readyCue).toBe("steps");
  });

  it("desktop, moved on during the read: a 'Your steps are ready' button appears instead of a jump", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    window.dispatchEvent(new Event("pointerdown")); // they tapped somewhere else while it read
    await release(read, ready(careFor(PAPER)));
    expect(scrolls).not.toContain("step-2");
    expect(cue()?.dataset.readyCue).toBe("steps");
    act(() => cue()!.querySelector("button")!.click());
    expect(cue()).toBeNull();
    expect(tabSelected(1)).toBe("true");
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(document.activeElement?.id).toBe("steps-title");
  });

  it("steps with warning signs: Show me lands on the warnings, never past them (Codex review, round 7)", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    window.dispatchEvent(new Event("pointerdown"));
    await release(read, ready({ ...careFor(PAPER), has_warning_signs: true }));
    expect(screenText()).toContain("Warning signs from your paper");
    act(() => cue()!.querySelector("button")!.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(document.activeElement?.id).toBe("warn-title");
    expect(scrolls).toContain("warn-title");
  });

  it("photo, moved on while it read: the cue brings them back to the photo check (Codex review, round 5)", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 10, height: 10 }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,AAAA");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "paper.jpg", { type: "image/jpeg" })] });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    window.dispatchEvent(new Event("pointerdown")); // they scrolled away while it read
    await release(read, ready({ ...careFor(PAPER), source_kind: "image" }));
    expect(screenText()).toContain("Check how we read your photo");
    expect(cue()?.dataset.readyCue).toBe("photo");
    act(() => cue()!.querySelector("button")!.click());
    expect(cue()).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(document.activeElement?.id).toBe("photo-check-title");
    vi.restoreAllMocks();
  });

  it("a new read clears a waiting cue", async () => {
    await planOnPhone(() => window.dispatchEvent(new Event("pointerdown")));
    expect(cue()).not.toBeNull();
    act(() => typeInto(paperBox(), PAPER + " Also: walk daily."));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    expect(cue()).toBeNull();
    await release(read, ready(careFor(PAPER)));
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
    expect(scrolls).toEqual(["step-2"]); // waits for that scroll to settle
    act(() => { window.dispatchEvent(new Event("scrollend")); }); // it arrived where it was going
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
    act(() => (host.querySelector('button[aria-label="Remove step 1"]') as HTMLButtonElement).click());
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

    expect(host.querySelector("[data-ask-paper]")).not.toBeNull();
    act(() => typeInto(paperBox(), `${PAPER} Walk for 20 minutes a day.`));
    expect(screenText()).toContain("Metformin twice a day");
    expect(screenText()).toContain(CARE_OUTDATED);
    // Ask my paper would answer from the old text, so it is gone until the paper is read again.
    expect(host.querySelector("[data-ask-paper]")).toBeNull();
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

  describe("a plan landing while that scroll is still moving waits for it to settle", () => {
    let rect: typeof Element.prototype.getBoundingClientRect;
    beforeEach(() => {
      rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        return { top: this.id === "step-2" ? 1_000 : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
      };
      Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5_000 });
    });
    afterEach(() => {
      Element.prototype.getBoundingClientRect = rect;
      delete (document.documentElement as unknown as { scrollHeight?: number }).scrollHeight;
    });

    it("a scrollbar drag resting on the path (same way as the page was going) stops the plan scroll", async () => {
      const req = await readThenPressPlan(); // the page's own scroll: 0 -> 1_000
      setScrollY(500); // the person drags the same way and stops halfway: on the path, so not yet told apart
      window.dispatchEvent(new Event("scroll"));
      await release(req, ready(planFor("The new plan")));
      expect(scrolls).toEqual(["step-2"]);
      await act(async () => { await new Promise((r) => setTimeout(r, 1_600)); }); // its time is up, short of the target
      expect(scrolls).toEqual(["step-2"]);
    });

    it("still stopped short after a size change re-aimed that scroll, the plan scroll stays dropped", async () => {
      const observers: ResizeObserverCallback[] = [];
      vi.stubGlobal("ResizeObserver", class { constructor(cb: ResizeObserverCallback) { observers.push(cb); } observe() {} unobserve() {} disconnect() {} });
      act(() => root.unmount());
      root = createRoot(host);
      act(() => root.render(<CarePlanTool />));
      // The page-size observer only (registered first); the card anchor's observer is left out so this is a pure re-aim.
      const pageObserver = observers.slice(-2)[0];
      const req = await readThenPressPlan(); // the page's own scroll: 0 -> 1_000
      setScrollY(500);
      window.dispatchEvent(new Event("scroll"));
      await release(req, ready(planFor("The new plan"))); // waiting
      act(() => pageObserver([], {} as ResizeObserver)); // late content: the scroll is re-aimed (500 -> 1_500)
      await act(async () => { await new Promise((r) => setTimeout(r, 1_600)); }); // time is up, still at 500
      expect(scrolls).toEqual(["step-2"]);
    });

    it("a newer page scroll meanwhile (the card anchor) is waited out and judged too", async () => {
      const observers: ResizeObserverCallback[] = [];
      vi.stubGlobal("ResizeObserver", class { constructor(cb: ResizeObserverCallback) { observers.push(cb); } observe() {} unobserve() {} disconnect() {} });
      act(() => root.unmount());
      root = createRoot(host);
      act(() => root.render(<CarePlanTool />));
      const both = observers.slice(-2);
      const req = await readThenPressPlan(); // the page's own scroll: 0 -> 1_000
      setScrollY(500);
      window.dispatchEvent(new Event("scroll"));
      await release(req, ready(planFor("The new plan"))); // waiting
      act(() => both.forEach((cb) => cb([], {} as ResizeObserver))); // late content: the anchor starts its own scroll to the card
      await act(async () => { await new Promise((r) => setTimeout(r, 1_600)); }); // time is up, still at 500
      expect(scrolls).not.toContain("step-3"); // the anchor may put the card back; the plan scroll is dropped
    });

    it("the page's scroll arriving at its target lets the plan scroll go", async () => {
      const req = await readThenPressPlan();
      setScrollY(1_000);
      window.dispatchEvent(new Event("scroll"));
      await release(req, ready(planFor("The new plan")));
      await act(async () => { await new Promise((r) => setTimeout(r, 1_600)); });
      expect(scrolls).toEqual(["step-2", "step-3"]);
    });
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
    p.steps = [{ title: "Book the A1c test", action: "Call to book it.", why: "", barrier: null, care_ids: ["c2"], resource_ids: ["k1", "g1"], dropped_refs: [] } as unknown as PlanResponse["steps"][number]];
    p.resources = {
      k1: { type: "clinic", id: "k1", km: 2, clinic: { id: "k1", name: "Old Place Clinic", org: "", address: "1 Main St", city: "Atlanta", zip: "30303", county: "", phone: "404-555-0100", website: "https://clinic.example", lat: 0, lng: 0, hours_per_week: null, setting: "", health_center_type: "", nearest_rail: null, nearest_bus: null, barriers: [], source_id: "hrsa", hours: [{ day: 1, open: "0800", close: "1700" }], hours_source_id: "clinic-site", hours_quote: "Mon 8 to 5", hours_url: "https://clinic.example/hours" } },
      g1: { type: "program", id: "g1", program: { id: "g1", name: "Ride Program", barriers: [], access: { phone: "404-555-0199", url: "https://ride.example", text: "Text RIDE to 404-555-0177" }, languages: [], evidence_quote: "Free rides, call 404-555-0188.", source_url: "https://ride.example/about" } },
    } as unknown as PlanResponse["resources"];
    return p;
  }
  const ACTIONS = ["Read it out loud", "Print for the next visit", "Print a handoff sheet", "Send to family", "Book it now"];
  /** Every place link the plan offers: 7 in the plan rows plus 3 in "Start with these 3" (was 7 before the top three). */
  const PLACE_LINKS = 10;
  /** Every link out of the plan's place cards: calls, websites, directions, and their source pages. Scoped to the plan
   *  card (step 3), since each care step now has its own "Remind me" calendar link. */
  const placeLinks = () => [...host.querySelectorAll<HTMLAnchorElement>("#step-3 li a")].map((a) => a.getAttribute("href") ?? "");
  /** The same five actions, by their label in `lang` (the app's own words follow the chosen language, lib/uiText.ts). */
  const LABEL_KEY: Record<string, UiKey> = {
    "Read it out loud": "dock.listen.long", "Print for the next visit": "dock.print.long", "Print a handoff sheet": "dock.handoff.long",
    "Send to family": "dock.send.long", "Book it now": "book.open",
  };
  const enabled = (lang = "English") => Object.fromEntries(ACTIONS.map((t) => [t, !byText(ui(lang, LABEL_KEY[t])).disabled]));
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

  // "Explain it in" is a set of radio buttons (ReadIn.tsx), each language in its own words.
  const pickLanguage = (value: string) => host.querySelector<HTMLInputElement>(`input[name="read-in-language"][value="${value}"]`)!.click();

  const changes: [string, () => void][] = [
    ["place (a ZIP typed)", () => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30340")],
    ["barriers", () => byText("Paying for the visit").click()],
    ["language", () => pickLanguage("Spanish")],
    ["a removed step", () => (host.querySelector('button[aria-label="Remove step 1"]') as HTMLButtonElement).click()],
  ];
  for (const [what, change] of changes) {
    it(`after changing ${what}: read aloud, both prints, Send to family, Book it now and place links are off, with the reason`, async () => {
      await planReady();
      // Rows: clinic call, website, directions, hours source; program call, open; the program's source under "Why this?".
      // "Start with these 3": the clinic's call button; the program's call button and its verified-page seal.
      expect(placeLinks()).toHaveLength(PLACE_LINKS);
      expect(screenText()).toContain("Text RIDE to 404-555-0177");
      expect(screenText()).toContain("call 404-555-0188");
      act(change);
      // Changing the language changes the app's own words too, so the actions are found by their Spanish labels.
      const lang = what === "language" ? "Spanish" : "English";
      expect(enabled(lang)).toEqual(all(false));
      expect(placeLinks()).toEqual([]);
      for (const n of ["404-555-0100", "404-555-0199", "404-555-0177", "404-555-0188"]) expect(screenText()).not.toContain(n); // no number to call or text
      expect(screenText()).toContain("Old Place Clinic"); // the place is still shown, only not offered
      expect(screenText()).toContain("Plan with the A1c test"); // still shown, labelled
      const reason = [ui(lang, "plan.offPlan"), ui(lang, "plan.offPaper")];
      expect(reason.some((r) => screenText().includes(r))).toBe(true);
    });
  }

  it("printing from the browser menu prints only an out-of-date note, never the plan or its handoff sheet", async () => {
    await planReady();
    expect(document.getElementById("atlas-sheet")).not.toBeNull();
    const print = vi.fn();
    vi.stubGlobal("print", print);
    act(() => byText("Print a handoff sheet").click());
    expect(document.documentElement.classList.contains("print-sheet")).toBe(true); // the sheet shown first (printView.ts)
    act(() => byText("Paying for the visit").click());
    expect(document.documentElement.classList.contains("print-sheet")).toBe(false);
    expect(document.documentElement.classList.contains("print-view")).toBe(false); // never a blank page
    expect(document.getElementById("atlas-sheet")).toBeNull();
    const card = host.querySelector("#step-3, [data-outdated]")!.closest("[data-outdated]")!;
    expect(card.classList.contains("plan-outdated")).toBe(true);
    expect(card.querySelector(":scope > .outdated-print-note")?.textContent).toContain("out of date");
    print.mockClear();
    act(() => byText("Print for the next visit").click());
    expect(print).not.toHaveBeenCalled();
    // The print stylesheet hides everything in an outdated plan card except that note.
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\s+/g, " ");
    expect(css).toContain(".plan-outdated > :not(.outdated-print-note) { display: none !important; }");
  });

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
    expect(placeLinks()).toHaveLength(PLACE_LINKS);
    expect(host.querySelector(".plan-outdated, .outdated-print-note")).toBeNull();
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

describe("a plan saved before results were checked against answers", () => {
  function reopenWith(saved: Record<string, unknown>) {
    localStorage.setItem("atlas-plans-v2", JSON.stringify({ v: 2, active: "p1", plans: [{
      id: "p1", name: "My plan", createdAt: "2026-10-01T10:00:00.000Z", savedAt: "2026-10-01T10:00:00.000Z",
      text: PAPER, language: "English", level: "simple", care: careFor(PAPER), barriers: ["cost"], zip: "", note: "",
      plan: planFor("Plan from older answers"), done: {}, removed: {}, photoChecked: false, ...saved,
    }] }));
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<CarePlanTool />));
    expect(screenText()).toContain("Plan from older answers");
  }

  it("comes back outdated with every plan action off (its answers may be later edits)", () => {
    reopenWith({});
    expect(screenText()).toContain("Read your paper again first");
    for (const t of ["Read it out loud", "Print for the next visit", "Print a handoff sheet", "Send to family"]) expect(byText(t).disabled).toBe(true);
    expect(document.getElementById("atlas-sheet")).toBeNull();
    // and it is not re-saved as if current
    expect(localStorage.getItem("atlas-plans-v2")).not.toContain("\"matched\":true");
  });

  it("a plan saved by this version comes back current", () => {
    reopenWith({ matched: true });
    expect(screenText()).not.toContain("Read your paper again first");
    expect(byText("Read it out loud").disabled).toBe(false);
  });

  // Found Oct 5 on the live site: a reopened plan never ran the second check, so every step said "Checked once".
  // Found Oct 5 on the live site: a reopened plan showed every step as checked once. Its verdicts now come back from
  // the save itself; reopening never sends the paper anywhere (the privacy page's promise, Codex review of PR 104).
  const certified = (id: string) => ({ id, flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same" as const, what_differs: "", certified: true });
  const sealCounts = () => [...host.querySelectorAll("[data-seal-label]")].map((e) => e.textContent?.trim() ?? "").reduce<Record<string, number>>((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {});

  // The privacy page's promise is "Nothing is uploaded" on reopen: no request carries a body. Body-less GETs (what
  // this device can do, like the call option's config) carry nothing of the paper or the plan (Codex round 3).
  it("reopening a saved plan uploads nothing: no request carries a body, none goes to the double-check", () => {
    fetchCalls = [];
    reopenWith({ matched: true });
    expect(fetchCalls.filter((c) => c.url === "/api/meaning")).toHaveLength(0);
    expect(fetchCalls.filter((c) => c.hasBody || c.method !== "GET")).toEqual([]);
  });

  it("verdicts saved with a plan come back on reopen, for exactly those steps", () => {
    const care = careFor(PAPER);
    const byId = Object.fromEntries(care.items.map((i) => [i.id, certified(i.id)]));
    reopenWith({ matched: true, checks: { key: checksKey(care.items, care.language ?? "English"), policy: CHECK_POLICY, byId } });
    expect(sealCounts()["Checked twice"]).toBe(care.items.length);
  });

  it("restored verdicts stay saved: a second reopen still shows them checked twice (Codex round 4)", async () => {
    const care = careFor(PAPER);
    const byId = Object.fromEntries(care.items.map((i) => [i.id, certified(i.id)]));
    reopenWith({ matched: true, checks: { key: checksKey(care.items, care.language ?? "English"), policy: CHECK_POLICY, byId } });
    await act(async () => { await drain(); await drain(); }); // let the autosave run
    expect(localStorage.getItem("atlas-plans-v2")).toContain('"checks"');
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<CarePlanTool />));
    await act(async () => { await drain(); });
    expect(sealCounts()["Checked twice"]).toBe(care.items.length);
  });

  it("verdicts saved for other steps are dropped: the steps show as checked once", () => {
    const care = careFor(PAPER);
    const byId = Object.fromEntries(care.items.map((i) => [i.id, certified(i.id)]));
    reopenWith({ matched: true, checks: { key: checksKey([{ id: "item-1", source_quote: "a different paper" }], care.language ?? "English"), policy: CHECK_POLICY, byId } });
    expect(sealCounts()["Checked twice"] ?? 0).toBe(0);
  });

  it("an outdated save never gets its verdicts back", () => {
    const care = careFor(PAPER);
    const byId = Object.fromEntries(care.items.map((i) => [i.id, certified(i.id)]));
    reopenWith({ checks: { key: checksKey(care.items, care.language ?? "English"), policy: CHECK_POLICY, byId } }); // no matched: outdated
    expect(sealCounts()["Checked twice"] ?? 0).toBe(0);
  });

  it("an older non-English photo save, confirmed after reopening, is checked in the plan's language", async () => {
    const { language: _drop, ...noLang } = { ...careFor(PAPER), source_kind: "image" as const };
    void _drop;
    reopenWith({ matched: true, language: "Spanish", care: noLang, photoChecked: false });
    fetchCalls = [];
    await act(async () => { byText("It matches my paper").click(); await drain(); });
    const meaning = fetchCalls.filter((c) => c.url === "/api/meaning");
    expect(meaning).toHaveLength(1);
    expect((meaning[0].body as { language?: string }).language).toBe("Spanish");
  });

  let serverPolicy = CHECK_POLICY;
  it("a fresh read keeps its verdicts in the save, with the key for its steps", async () => {
    serverPolicy = CHECK_POLICY;
    const original = fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/meaning") {
        const body = JSON.parse(String(init?.body)) as { items: { id: string }[] };
        return Promise.resolve(json({ results: body.items.map((i) => certified(i.id)), flagged: 0, checker_model: "test", policy: serverPolicy, ms: 1 }));
      }
      return original(input, init);
    });
    act(() => typeInto(paperBox(), PAPER));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    const care = careFor(PAPER);
    await release(req, ready(care));
    await act(async () => { await drain(); await drain(); });
    const saved = JSON.parse(localStorage.getItem("atlas-plans-v2")!) as { plans: { checks?: { key: string; byId: Record<string, unknown> } }[] };
    expect(saved.plans[0].checks?.key).toBe(checksKey(care.items, care.language ?? "English"));
    expect(Object.keys(saved.plans[0].checks?.byId ?? {})).toHaveLength(care.items.length);
  });

  it("verdicts the server made under another checker model are never saved", async () => {
    serverPolicy = "2026-10-05:some-other-model";
    const original = fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/meaning") {
        const body = JSON.parse(String(init?.body)) as { items: { id: string }[] };
        return Promise.resolve(json({ results: body.items.map((i) => certified(i.id)), flagged: 0, checker_model: "x", policy: serverPolicy, ms: 1 }));
      }
      return original(input, init);
    });
    act(() => typeInto(paperBox(), PAPER));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(req, ready(careFor(PAPER)));
    await act(async () => { await drain(); await drain(); });
    const saved = JSON.parse(localStorage.getItem("atlas-plans-v2")!) as { plans: { checks?: unknown }[] };
    expect(sealCounts()["Checked twice"]).toBe(1); // shown now, for this read
    expect(saved.plans[0].checks).toBeUndefined(); // but never kept for a reopen under this build
  });

  it("a saved level that is no longer a choice: no crash, defaults shown, plan outdated with actions off", () => {
    reopenWith({ matched: true, level: "expert" });
    expect(screenText()).toContain("Read your paper again first");
    for (const t of ["Read it out loud", "Print for the next visit", "Print a handoff sheet", "Send to family"]) expect(byText(t).disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[name="read-in-level"]:checked')!.value).toBe("simple");
  });

  it("a plan saved with internal ids in its text comes back without them (the live 2026-10-03 sentence)", () => {
    localStorage.setItem("atlas-plans-v2", JSON.stringify({ v: 2, active: "p1", plans: [{
      id: "p1", name: "My plan", createdAt: "2026-10-01T10:00:00.000Z", savedAt: "2026-10-01T10:00:00.000Z",
      text: PAPER, language: "English", level: "simple", care: careFor(PAPER), barriers: ["cost"], zip: "", note: "", matched: true,
      plan: planFor("Plan from older answers: the fasting blood test within 2 weeks (item-4), the eye doctor visit (item-5), the A1c test (item-3) and your clinic visit in 3 months (item-6)."),
      done: {}, removed: {}, photoChecked: false,
    }] }));
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<CarePlanTool />));
    expect(screenText()).toContain("Plan from older answers: the fasting blood test within 2 weeks, the eye doctor visit, the A1c test and your clinic visit in 3 months.");
    expect(screenText()).not.toMatch(/item-\d/);
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

  it("a far scrollbar move in the moment right after a size change counts as the person", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    act(() => observers.forEach((cb) => cb([], {} as ResizeObserver))); // the page changed size at scrollY 0
    setScrollY(2_000); // a far scrollbar move inside the moment after the change
    window.dispatchEvent(new Event("scroll"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2"]);
  });

  it("a small scrollbar move right after a big size change counts as the person too", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    act(() => observers.forEach((cb) => cb([], {} as ResizeObserver))); // a first size reading (5_000)
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 9_000 }); // grew by 4_000 (below the view)
    act(() => observers.forEach((cb) => cb([], {} as ResizeObserver)));
    setScrollY(120); // the person nudges the scrollbar
    window.dispatchEvent(new Event("scroll"));
    await release(req, ready(planFor("The new plan")));
    expect(scrolls).toEqual(["step-2"]);
  });

  it("staying on the re-aimed path does not", async () => {
    const req = await readThenLayoutShift();
    window.dispatchEvent(new Event("scroll"));
    await release(req, ready(planFor("The new plan")));
    act(() => { window.dispatchEvent(new Event("scrollend")); });
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

  it("no plan can be made while a location request is out", async () => {
    act(() => byText("Getting there").click());
    controlledGeo();
    act(() => byText("Or use my location").click());
    expect(byText("Make my plan").disabled).toBe(true);
    const before = fetchCalls.length;
    act(() => byText("Make my plan").click());
    expect(fetchCalls.length).toBe(before);
    act(() => calls[0].ok(pos(34.05, -84.6)));
    expect(byText("Make my plan").disabled).toBe(false);
  });

  it("a plan already on its way is dropped when a location request starts, even if it lands first", async () => {
    act(() => byText("Getting there").click());
    act(() => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30030"));
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    controlledGeo();
    act(() => byText("Or use my location").click());
    await release(req, ready(planFor("Plan near the old ZIP")));
    expect(screenText()).not.toContain("Plan near the old ZIP");
  });

  it("a ZIP plan is outdated while a location request is out, and current again if it fails (the ZIP still stands)", async () => {
    act(() => byText("Getting there").click());
    act(() => typeInto(host.querySelector<HTMLInputElement>("#zip")!, "30030"));
    const req = hold("/api/plan");
    act(() => byText("Make my plan").click());
    await release(req, ready(planFor("Plan near 30030")));
    expect(byText("Read it out loud").disabled).toBe(false);
    controlledGeo();
    act(() => byText("Or use my location").click());
    expect(byText("Read it out loud").disabled).toBe(true);
    expect(byText("Update plan").disabled).toBe(true);
    act(() => calls[0].fail());
    expect(byText("Read it out loud").disabled).toBe(false);
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

describe("your steps, grouped by when (CareSteps inside the real tool)", () => {
  async function read() {
    act(() => typeInto(paperBox(), PAPER));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    const care = careFor(PAPER, "AI title for metformin");
    care.not_in_document = ["How long to keep taking it"];
    await release(req, ready(care));
  }

  it("the missed-lines check and 'What your paper does not say' are still on the screen", async () => {
    await read();
    expect(screenText()).toContain("Lines on your paper we didn't turn into steps");
    expect(screenText()).toContain("What your paper does not say");
    expect(screenText()).toContain("How long to keep taking it");
  });

  it("the meaning check certified nothing: the row shows the paper's words and the step sits in its paper time group", async () => {
    await read();
    const row = host.querySelector('li[data-step="c1"]')!;
    expect(row.closest("[data-when-group]")?.getAttribute("data-when-group")).toBe("daily"); // "twice a day" in the quote
    const toggle = row.querySelector("button[aria-expanded]")!;
    expect(toggle.textContent).toContain("“metformin 500 mg twice a day”");
    expect(toggle.textContent).not.toContain("AI title for metformin");
  });

  it("done is saved, and Remove moves a step to 'You removed', with Undo", async () => {
    await read();
    act(() => host.querySelector<HTMLInputElement>('input[aria-label="Mark step 1 done"]')!.click());
    expect(JSON.parse(localStorage.getItem("atlas-plans-v2")!).plans[0].done).toEqual({ c1: true });
    act(() => (host.querySelector('button[aria-label="Remove step 1"]') as HTMLButtonElement).click());
    expect(host.querySelector('li[data-step="c1"]')).toBeNull();
    expect(screenText()).toContain("You removed 1");
    act(() => byText("Undo").click());
    expect(host.querySelector('li[data-step="c1"]')).not.toBeNull();
  });
});

/**
 * The first watched try (Oct 4): a medical assistant tapped "Try it with a sample" on the home page, landed on an empty
 * box with "Read my paper" greyed out below the fold, and was "looking for just anything to press".
 */
describe("Try it with a sample lands with the sample in and Read my paper in view", () => {
  const readButton = () => host.querySelector<HTMLButtonElement>("#read-my-paper")!;
  const frame = () => new Promise((r) => setTimeout(r, 30));

  it("an empty box says what to do first, and the button points at that note", () => {
    expect(readButton().disabled).toBe(true);
    expect(host.querySelector("#read-hint")?.textContent).toContain("Use the sample paper");
    expect(readButton().getAttribute("aria-describedby")).toBe("read-hint");
  });

  it("the home page event fills the sample, enables the button, scrolls it into view and focuses it", async () => {
    // The event's render commits when act ends; the scroll waits one frame after that.
    act(() => { window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); });
    await act(async () => { await frame(); });
    expect(paperBox().value).toBe(SAMPLE_AVS);
    expect(readButton().disabled).toBe(false);
    expect(host.querySelector("#read-hint")).toBeNull();
    expect(readButton().hasAttribute("aria-describedby")).toBe(false);
    expect(scrolls).toContain("read-my-paper");
    expect(document.activeElement).toBe(readButton());
  });

  it("never replaces a paper the person typed; it only shows them the button", async () => {
    act(() => typeInto(paperBox(), "My dad's discharge paper: take one pill a day and call if dizzy."));
    // The event's render commits when act ends; the scroll waits one frame after that.
    act(() => { window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); });
    await act(async () => { await frame(); });
    expect(paperBox().value).toBe("My dad's discharge paper: take one pill a day and call if dizzy.");
    expect(scrolls).toContain("read-my-paper");
  });

  it("Use the sample paper also brings the button into view", async () => {
    await act(async () => { byText("Use the sample paper").click(); await frame(); });
    expect(paperBox().value).toBe(SAMPLE_AVS);
    expect(scrolls).toContain("read-my-paper");
    expect(document.activeElement).toBe(readButton());
  });

  it("a link to /#try-sample fills the sample on load and leaves #try in the address bar", async () => {
    act(() => root.unmount());
    window.history.replaceState(null, "", "/#try-sample");
    root = createRoot(host);
    await act(async () => { root.render(<CarePlanTool />); await frame(); });
    expect(paperBox().value).toBe(SAMPLE_AVS);
    expect(window.location.hash).toBe("#try");
    window.history.replaceState(null, "", "/");
  });

  it("the home button's own href carries the request, so a tap before the page is interactive still works", () => {
    // Codex review: with href="#try" the request lived only in the click handler, which does not exist before hydration.
    const hero = readFileSync(join(__dirname, "Hero.tsx"), "utf8");
    // One line: the opening tag (whose onClick contains "=>") through the label.
    expect(hero).toMatch(/<SquashButton href=\{TRY_SAMPLE_HASH\}[^\n]*>Try it with a sample<\/SquashButton>/);
  });

  it("on a phone with their own paper on another tab: keeps the paper, opens tab 1, then jumps (Codex review)", async () => {
    phone = true;
    act(() => typeInto(paperBox(), "My dad's discharge paper: take one pill a day and call if dizzy."));
    act(() => host.querySelector<HTMLButtonElement>("#tab-step-2")!.click());
    expect(host.querySelector("#tab-step-2")?.getAttribute("aria-selected")).toBe("true");
    act(() => { window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); });
    await act(async () => { await frame(); });
    expect(paperBox().value).toBe("My dad's discharge paper: take one pill a day and call if dizzy.");
    expect(host.querySelector("#tab-step-1")?.getAttribute("aria-selected")).toBe("true");
    expect(scrolls).toContain("read-my-paper");
  });

  describe("while the first-visit intro holds the page", () => {
    afterEach(() => { document.documentElement.style.overflow = ""; });

    it("waits for the intro to let go, then jumps once (Preloader's real order: intro-done while locked, then again)", async () => {
      document.documentElement.style.overflow = "hidden";
      act(() => { window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); });
      await act(async () => { await frame(); });
      expect(scrolls).not.toContain("read-my-paper");
      // First intro-done: mid-animation, the page is still locked. Codex review: this used to consume the jump.
      await act(async () => { window.dispatchEvent(new Event("atlas:intro-done")); await frame(); });
      expect(scrolls).not.toContain("read-my-paper");
      // Second intro-done: finish() has cleared the lock.
      document.documentElement.style.overflow = "";
      await act(async () => { window.dispatchEvent(new Event("atlas:intro-done")); await frame(); });
      expect(scrolls.filter((s) => s === "read-my-paper")).toHaveLength(1);
      expect(document.activeElement).toBe(readButton());
      // Any later intro-done does nothing more.
      await act(async () => { window.dispatchEvent(new Event("atlas:intro-done")); await frame(); });
      expect(scrolls.filter((s) => s === "read-my-paper")).toHaveLength(1);
    });

    it("a late intro never pulls the person out of what they started (Codex review)", async () => {
      document.documentElement.style.overflow = "hidden";
      act(() => { window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); });
      await act(async () => { await frame(); });
      // The person starts typing in their own note before the intro lets go.
      act(() => { paperBox().focus(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
      document.documentElement.style.overflow = "";
      await act(async () => { window.dispatchEvent(new Event("atlas:intro-done")); await frame(); });
      expect(scrolls).not.toContain("read-my-paper");
      expect(document.activeElement).toBe(paperBox());
    });
  });
});

describe("the plan streams in, step by step", () => {
  const step = (title: string, action: string) => ({ title, action, why: "", barrier: "transport", care_ids: [], resource_ids: ["g1"], dropped_refs: [] });
  const resources = { g1: { type: "program", id: "g1", program: { id: "g1", name: "Ride Program", barriers: [], access: {}, languages: [], evidence_quote: "", source_url: "" } } };
  const located = { by: "none", label: "No location given" };
  const line = (e: unknown) => new TextEncoder().encode(JSON.stringify(e) + "\n");

  /** Answers /api/plan/stream with a body the test writes to, line by line. */
  function openStream() {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
    const base = fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/plan/stream") return base(input, init);
      fetchCalls.push({ url: "/api/plan/stream", body: JSON.parse(String(init?.body)) });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    });
    return {
      send: async (e: unknown) => { await act(async () => { ctl.enqueue(line(e)); await drain(); }); },
      cut: async () => { await act(async () => { ctl.error(new Error("connection reset")); await drain(); }); },
      end: async () => { await act(async () => { try { ctl.close(); } catch { /* the page already let go of it */ } await drain(); }); },
    };
  }

  it("shows each checked step as it comes, with its verified place, and only the final answer becomes the plan", async () => {
    const s = openStream();
    act(() => byText("Getting there").click());
    await act(async () => { byText("Make my plan").click(); await drain(); });
    await s.send({ type: "start", resources, located });
    expect(screenText()).not.toContain("Still building your plan"); // nothing to show yet: the working card stays
    await s.send({ type: "step", step: step("Get a ride", "Call the ride program the day before.") });
    expect(screenText()).toContain("Still building your plan");
    expect(screenText()).toContain("1 step ready so far");
    expect(screenText()).toContain("Get a ride");
    expect(screenText()).toContain("Ride Program");
    await s.send({ type: "step", step: step("Book the lab", "Ask for an early slot.") });
    expect(screenText()).toContain("2 steps ready so far");
    // Nothing is saved or offered from the preview.
    expect(Object.values({ ...localStorage }).join("")).not.toContain("Get a ride");
    const final = { ...planFor("Your streamed plan"), steps: [step("Get a ride", "Call the ride program the day before."), step("Book the lab", "Ask for an early slot.")], resources };
    await s.send({ type: "done", plan: final });
    await s.end();
    expect(screenText()).not.toContain("Still building your plan");
    expect(screenText()).toContain("Your streamed plan");
    expect(fetchCalls.filter((c) => c.url === "/api/plan")).toHaveLength(0);
  });

  it("a stream cut mid-plan drops the preview and builds the plan on the plain route", async () => {
    const s = openStream();
    act(() => byText("Getting there").click());
    const plain = hold("/api/plan");
    await act(async () => { byText("Make my plan").click(); await drain(); });
    await s.send({ type: "start", resources, located });
    await s.send({ type: "step", step: step("Half a plan", "Never finished.") });
    await s.cut();
    expect(screenText()).not.toContain("Half a plan");
    expect(fetchCalls.filter((c) => c.url === "/api/plan")).toHaveLength(1);
    await release(plain, ready(planFor("Plan from the plain route")));
    expect(screenText()).toContain("Plan from the plain route");
  });

  it("an answer changed while it streams: the old steps leave the screen and nothing from them lands", async () => {
    const s = openStream();
    act(() => byText("Getting there").click());
    await act(async () => { byText("Make my plan").click(); await drain(); });
    await s.send({ type: "start", resources, located });
    await s.send({ type: "step", step: step("Old answers step", "From before the change.") });
    act(() => byText("Paying for the visit").click()); // a changed answer stops the plan
    expect(screenText()).not.toContain("Old answers step");
    expect(screenText()).toContain("You changed your answers, so we stopped building the plan.");
  });

  it("the paper is edited while the plan streams: steps from the old paper leave the screen (Codex round 3)", async () => {
    const s = openStream();
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    act(() => byText("Getting there").click());
    await act(async () => { byText("Make my plan").click(); await drain(); });
    await s.send({ type: "start", resources, located });
    await s.send({ type: "step", step: step("Old paper step", "From the paper before the edit.") });
    expect(screenText()).toContain("Old paper step");
    act(() => typeInto(paperBox(), PAPER + " Also check your feet daily."));
    expect(screenText()).not.toContain("Old paper step");
  });

  it("the paper is edited, then the stream breaks: no retry on the old paper (Codex round 4)", async () => {
    const s = openStream();
    act(() => typeInto(paperBox(), PAPER));
    const read = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(read, ready(careFor(PAPER)));
    act(() => byText("Getting there").click());
    await act(async () => { byText("Make my plan").click(); await drain(); });
    await s.send({ type: "start", resources, located });
    act(() => typeInto(paperBox(), PAPER + " Also check your feet daily."));
    await s.cut();
    expect(fetchCalls.filter((c) => c.url === "/api/plan")).toHaveLength(0);
  });

  it("the server's own error is shown, not retried, and steps already shown leave the screen", async () => {
    const s = openStream();
    act(() => byText("Getting there").click());
    await act(async () => { byText("Make my plan").click(); await drain(); });
    await s.send({ type: "start", resources, located });
    await s.send({ type: "step", step: step("Shown then declined", "Never part of a plan.") });
    expect(screenText()).toContain("Shown then declined");
    await s.send({ type: "error", error: "The AI declined to build this plan.", status: 422 });
    await s.end();
    // The person sees the app's own line for a refused plan (PR 93); the server's English words are only logged.
    expect(screenText()).toContain(ui("English", failureKey(new RequestFailed(422, ""), "plan")));
    expect(screenText()).not.toContain("The AI declined to build this plan.");
    expect(screenText()).not.toContain("Shown then declined"); // a preview step never outlives a failed plan
    expect(fetchCalls.filter((c) => c.url === "/api/plan")).toHaveLength(0);
  });
});

describe("a paper that is not a visit paper (nothing becomes a step)", () => {
  const empty = (text: string, refused = 0): CarePlanResponse => ({
    source_text: text, source_kind: "text", model: "test", has_warning_signs: false, items: [],
    refused: refused ? [{ title: "Held", reason: "missing" } as unknown as CarePlanResponse["refused"][number]] : [],
    questions_for_doctor: ["The text looks like a grocery list. Could you share the after-visit summary instead?"],
    not_in_document: ["This document is not an after-visit summary."],
    stats: { extracted: refused, grounded: 0, refused, ms: 10 },
  });
  const LIST = "Grocery list for Saturday: eggs, whole milk, bread, bananas, rice. Call Mom about Sunday dinner.";

  it("says no care steps were found and offers the way back, with no checked banner or clinic questions", async () => {
    act(() => typeInto(paperBox(), LIST));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(req, ready(empty(LIST)));

    expect(screenText()).toContain(ui("English", "steps.noneFound.title"));
    expect(screenText()).toContain(ui("English", "steps.noneFound.body"));
    expect(screenText()).not.toContain("All 0 steps");
    expect(screenText()).not.toContain(ui("English", "steps.noneLeft"));
    expect(screenText()).not.toContain("grocery list. Could you share"); // the AI's question to the person is not filed under "Ask your clinic"
    expect(host.querySelector("#steps-title")?.textContent).toBe(ui("English", "steps.noneFound.title")); // the ready cue lands here

    act(() => byText(ui("English", "steps.noneFound.paste")).click());
    expect(document.activeElement).toBe(paperBox());
  });

  it("a read whose steps were all held back still shows the held-back list, not the wrong-paper card", async () => {
    act(() => typeInto(paperBox(), PAPER));
    const req = hold("/api/extract");
    await act(async () => { byText("Read my paper").click(); await drain(); });
    await release(req, ready(empty(PAPER, 1)));
    expect(screenText()).not.toContain(ui("English", "steps.noneFound.title"));
    expect(screenText()).toContain("1 held back");
  });
});
