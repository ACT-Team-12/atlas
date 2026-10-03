import { describe, expect, it, vi } from "vitest";
import { createShieldedFetch, installShieldedFetch, savedPapers } from "./shieldFetch";
import { SHIELD_HEADER } from "./phiResponses";
import { finishCarePlan } from "./extract";
import { encodeEvent, readExtractEvents, type ExtractEvent } from "./extractEvents";
import { RequestSchema, type CarePlanResponse, type VerifiedItem } from "./schema";
import { STORE_KEY } from "./savedPlans";
import { NAMED_PAPER, NAMED_PAPER_IDENTIFIERS as IDENTIFIERS } from "./__fixtures__/phiPaper";

/**
 * The web page's data layer: the page calls fetch as before; the wrapper shields what goes out and puts the real words
 * (and offsets) back into what comes in. `base` stands in for the network and plays the server: it reads the shielded
 * text it was sent, exactly as the real routes do.
 */

const ORIGIN = "https://atlas.test";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

function serverRead(text: string): CarePlanResponse {
  const lines = text.split("\n");
  const line = (k: string) => lines.find((l) => l.includes(k))!;
  const item = (title: string, quote: string) => ({ kind: "medication", title, plain_language: `About ${quote}`, why: title, when: "", source_quote: quote, needs_clarification: false, question_for_clinic: "" });
  return finishCarePlan(RequestSchema.parse({ text }), {
    source_text: "",
    items: [item("Metformin", line("metformin")), item("Ibuprofen", line("ibuprofen").slice(4)), item("Sugar", line("blood sugar"))],
    questions_for_doctor: [`Ask about ${line("Patient").split("   ")[0].slice(9)}`],
    not_in_document: [],
  }, "end_turn", 0);
}

function setup() {
  const sent: { path: string; body: string; headers: Headers }[] = [];
  const base = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), ORIGIN).pathname;
    sent.push({ path, body: String(init?.body ?? ""), headers: new Headers(init?.headers) });
    if (new URL(String(input), ORIGIN).origin !== ORIGIN) return json({});
    let body: { text?: string; items?: { source_quote: string }[] } = {};
    try { body = JSON.parse(String(init?.body ?? "")); } catch { return json({ error: "Send JSON." }, 400); }
    if (path === "/api/extract" && body.text) return json(serverRead(body.text));
    if (path === "/api/extract/stream" && body.text) {
      const plan = serverRead(body.text);
      const lines = [...plan.items.map((item): ExtractEvent => ({ type: "item", item })), { type: "done", plan } as ExtractEvent].map(encodeEvent).join("");
      // Cut mid-line on purpose: the wrapper must re-join lines across chunks.
      const bytes = new TextEncoder().encode(lines);
      return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.slice(i, i + 17)); c.close(); } }), { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
    }
    if (path === "/api/plan") return json({ summary: "Plan text ⟦NAME_A⟧ stays as written", echo: body });
    if (path === "/api/meaning") return json({ results: [{ id: "a", what_differs: body.items![0].source_quote }] });
    return json({ echo: body });
  });
  return { sent, f: createShieldedFetch(base as unknown as typeof fetch, ORIGIN) };
}

const plainRead = serverRead(NAMED_PAPER);

describe("the page's fetch", () => {
  it("/api/extract: nothing identifying leaves the page; every field and offset comes back on the original paper", async () => {
    const { sent, f } = setup();
    const res = await f("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: NAMED_PAPER, language: "English" }) });
    for (const id of IDENTIFIERS) expect(sent[0].body).not.toContain(id);
    expect(sent[0].headers.get(SHIELD_HEADER)).toBe("1");
    expect(sent[0].headers.get("content-type")).toBe("application/json");
    const plan = (await res.json()) as CarePlanResponse;
    expect({ ...plan, stats: { ...plan.stats, ms: 0 } }).toEqual({ ...plainRead, stats: { ...plainRead.stats, ms: 0 } });
    expect(JSON.stringify(plan)).not.toContain("⟦");
  });

  it("/api/extract/stream: each streamed step is unshielded as it arrives, lines split across chunks", async () => {
    const { sent, f } = setup();
    const res = await f("/api/extract/stream", { method: "POST", body: JSON.stringify({ text: NAMED_PAPER }) });
    for (const id of IDENTIFIERS) expect(sent[0].body).not.toContain(id);
    const items: VerifiedItem[] = [];
    const done = await readExtractEvents(res.body!, (i) => items.push(i));
    expect(items).toEqual(plainRead.items);
    expect(done.items).toEqual(plainRead.items);
    expect(done.source_text).toBe(NAMED_PAPER);
    for (const i of items) expect(NAMED_PAPER.slice(i.span!.start, i.span!.end)).toBe(i.source_quote);
  });

  it("later requests that carry only care steps hide the names the paper taught (plan, meaning)", async () => {
    const { sent, f } = setup();
    await f("/api/extract", { method: "POST", body: JSON.stringify({ text: NAMED_PAPER }) });
    const care = plainRead.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, plain_language: i.plain_language, when: i.when, source_quote: i.source_quote }));
    const planRes = await f("/api/plan", { method: "POST", body: JSON.stringify({ care, barriers: [], note: "Maria works nights" }) });
    expect(sent[1].body).toContain("Ms. ⟦NAME_");
    for (const id of IDENTIFIERS) expect(sent[1].body).not.toContain(id);
    // The plan's own text is never unshielded: it is what the voice and the call say.
    expect((await planRes.json()).summary).toBe("Plan text ⟦NAME_A⟧ stays as written");

    const m = await f("/api/meaning", { method: "POST", body: JSON.stringify({ items: [{ id: "a", plain_language: "x", when: "", source_quote: care[1].source_quote }] }) });
    for (const id of IDENTIFIERS) expect(sent[2].body).not.toContain(id);
    expect((await m.json()).results[0].what_differs).toBe(care[1].source_quote);
  });

  it("names from papers already saved on this device are hidden too (a plan built after a reload)", async () => {
    const store = { v: 2, active: "p", plans: [{ id: "p", text: NAMED_PAPER, care: { source_text: NAMED_PAPER } }] };
    const base = vi.fn(async () => json({}));
    const f = createShieldedFetch(base as unknown as typeof fetch, ORIGIN, () => savedPapers({ getItem: (k) => (k === STORE_KEY ? JSON.stringify(store) : null) }));
    await f("/api/plan", { method: "POST", body: JSON.stringify({ care: [{ id: "a", kind: "x", title: "t", plain_language: "p", when: "", source_quote: "Maria, take metformin" }], barriers: [] }) });
    expect(String((base.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain("Maria");
  });

  it("after a photo read, the names in the AI's transcription are hidden from the plan built on it", async () => {
    const base = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return json(body.image_base64 ? { ...serverRead(NAMED_PAPER), source_kind: "image" } : {});
    });
    const f = createShieldedFetch(base as unknown as typeof fetch, ORIGIN);
    const read = await (await f("/api/extract", { method: "POST", body: JSON.stringify({ image_base64: "aGk=", image_media_type: "image/jpeg" }) })).json();
    expect(read.source_text).toBe(NAMED_PAPER); // a photo read comes back as it was
    await f("/api/plan", { method: "POST", body: JSON.stringify({ care: [{ id: "a", kind: "x", title: "t", plain_language: "p", when: "", source_quote: "Maria, take metformin" }], barriers: [] }) });
    expect(String((base.mock.calls[1] as unknown as [string, RequestInit])[1].body)).not.toContain("Maria");
  });

  it("other requests go out untouched", async () => {
    const { sent, f } = setup();
    const other = { text: "Patient: Maria Lopez", language: "English", token: "t" };
    await f("/api/speak", { method: "POST", body: JSON.stringify(other) });
    await f("https://elsewhere.example/api/extract", { method: "POST", body: JSON.stringify(other) });
    await f("/api/extract", { method: "GET" });
    await f("/api/extract", { method: "POST", body: "not json" });
    expect(sent.map((s) => s.body)).toEqual([JSON.stringify(other), JSON.stringify(other), "", "not json"]);
    expect(sent.every((s) => !s.headers.has(SHIELD_HEADER))).toBe(true);
  });

  it("an error answer passes through with its status", async () => {
    const base = vi.fn(async () => json({ error: "Too many" }, 429));
    const f = createShieldedFetch(base as unknown as typeof fetch, ORIGIN);
    const r = await f("/api/extract", { method: "POST", body: JSON.stringify({ text: NAMED_PAPER }) });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Too many" });
  });

  it("installs once and keeps nothing in storage", async () => {
    const setItem = vi.fn();
    const base = vi.fn(async () => json({}));
    const win = { fetch: base, location: { origin: ORIGIN }, localStorage: { getItem: () => null, setItem } } as unknown as Window & typeof globalThis;
    installShieldedFetch(win);
    const first = win.fetch;
    installShieldedFetch(win);
    expect(win.fetch).toBe(first);
    await win.fetch("/api/extract", { method: "POST", body: JSON.stringify({ text: NAMED_PAPER }) });
    expect(setItem).not.toHaveBeenCalled();
  });
});
