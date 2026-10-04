import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAMED_PAPER, NAMED_PAPER_IDENTIFIERS as IDENTIFIERS } from "./__fixtures__/phiPaper";

/**
 * The server's net, end to end through the real route handlers, with the AI replaced by a stub that records every
 * byte it is sent. A raw request (a phone app, an older page) carries the patient's identifiers; the AI must never
 * receive them, and the answer must come back with the real words in place.
 */

const sent: string[] = [];
let answer: (params: { messages: { content: unknown }[] }) => unknown = () => ({});
const docOf = (params: { messages: { content: unknown }[] }) => {
  const c = params.messages[0].content;
  const text = typeof c === "string" ? c : (c as { type: string; text?: string }[]).map((b) => b.text ?? "").join("");
  return text;
};
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      parse: async (params: { messages: { content: unknown }[]; system?: string }) => {
        sent.push(JSON.stringify(params));
        return { stop_reason: "end_turn", parsed_output: answer(params) };
      },
      stream: (params: { messages: { content: unknown }[] }) => {
        sent.push(JSON.stringify(params));
        const out = answer(params);
        const raw = JSON.stringify(out);
        return {
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < raw.length; i += 50) yield { type: "content_block_delta", delta: { type: "text_delta", text: raw.slice(i, i + 50) } };
          },
          finalMessage: async () => ({ parsed_output: out, stop_reason: "end_turn" }),
        };
      },
    };
  },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), recordEvent: () => {} }));

const extract = await import("@/app/api/extract/route");
const stream = await import("@/app/api/extract/stream/route");
const plan = await import("@/app/api/plan/route");
const understand = await import("@/app/api/understand/route");
const meaning = await import("@/app/api/meaning/route");
const { verifySpeakToken } = await import("./speakToken");
const { paidSpeechText } = await import("./speechText");
const { readExtractEvents } = await import("./extractEvents");

let ip = 0;
const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `10.1.0.${++ip}` }, body: JSON.stringify(body) });

/** Quotes whole lines of whatever document it is sent, by keyword, like a careful model. */
function readPaper(params: { messages: { content: unknown }[] }) {
  const doc = /<document>\n([\s\S]*)\n<\/document>/.exec(docOf(params))![1];
  const line = (k: string) => doc.split("\n").find((l) => l.includes(k))!;
  const item = (title: string, quote: string) => ({ kind: "medication", title, plain_language: `About ${quote}`, why: "", when: "", source_quote: quote, needs_clarification: false, question_for_clinic: "" });
  return {
    source_text: "",
    items: [item("Metformin", line("metformin")), item("Ibuprofen", line("ibuprofen")), item("Sugar", line("blood sugar"))],
    questions_for_doctor: [],
    not_in_document: [],
  };
}

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("FEEDBACK_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

const neverSent = () => {
  expect(sent.length).toBeGreaterThan(0);
  for (const s of sent) for (const id of IDENTIFIERS) expect(s).not.toContain(id);
};

describe("raw requests: the AI never sees the identifiers, the answer has the real words", () => {
  it("POST /api/extract", async () => {
    answer = readPaper;
    const r = await extract.POST(post("/api/extract", { text: NAMED_PAPER, language: "English", reading_level: "simple" }));
    expect(r.status).toBe(200);
    neverSent();
    const body = await r.json();
    expect(body.source_text).toBe(NAMED_PAPER);
    expect(body.items.map((i: { source_quote: string }) => i.source_quote)).toEqual([
      "Maria, take metformin 500 mg by mouth 2 times a day with meals.",
      "Ms. Lopez, stop ibuprofen 200 mg. Avoid NSAIDs due to kidney function.",
      "Maria, call the office if your blood sugar is above 300 two times in a row.",
    ]);
    for (const i of body.items) expect(NAMED_PAPER.slice(i.span.start, i.span.end)).toBe(i.source_quote);
    expect(JSON.stringify(body)).not.toContain("⟦");
  });

  it("POST /api/extract/stream", async () => {
    answer = readPaper;
    const r = await stream.POST(post("/api/extract/stream", { text: NAMED_PAPER, language: "English", reading_level: "simple" }));
    const items: { source_quote: string; span: { start: number; end: number } | null }[] = [];
    const done = await readExtractEvents(r.body!, (i) => items.push(i));
    neverSent();
    expect(items).toHaveLength(3);
    for (const i of [...items, ...done.items]) expect(NAMED_PAPER.slice(i.span!.start, i.span!.end)).toBe(i.source_quote);
    expect(done.source_text).toBe(NAMED_PAPER);
  });

  it("POST /api/understand", async () => {
    answer = () => ({ questions: [{ item_id: "item-0", question: "How often?", options: ["2 times a day", "once", "never"], correct: 0, answer_quote: "2 times a day" }] });
    const r = await understand.POST(post("/api/understand", { source_text: NAMED_PAPER, language: "English", items: [{ id: "item-0", kind: "medication", title: "Metformin", source_quote: "Maria, take metformin 500 mg by mouth 2 times a day with meals." }] }));
    expect(r.status).toBe(200);
    neverSent();
    const q = (await r.json()).questions[0];
    expect(NAMED_PAPER.slice(q.span.start, q.span.end)).toBe("2 times a day");
  });

  it("POST /api/meaning", async () => {
    answer = () => ({ results: [{ id: "a", verdict: "same", what_differs: "" }] });
    const r = await meaning.POST(post("/api/meaning", { items: [
      { id: "a", plain_language: "Take metformin twice a day.", when: "", source_quote: "Patient: Maria Lopez   DOB: 04/12/1961   MRN: 88412907" },
    ] }));
    expect(r.status).toBe(200);
    neverSent();
  });
});

describe("rule 2: the plan, its voice and its call only ever hold what the AI wrote from redacted text", () => {
  it("POST /api/plan: a placeholder the AI copied never reaches the plan, and the read-aloud token still verifies", async () => {
    answer = () => ({
      summary: "⟦NAME_A⟧, here is your plan. NAME_B should rest.",
      steps: [{ title: "Book the lab, ⟦NAME_A⟧", action: "Call the clinic (⟦MRN_A⟧) to book.", why: "⟦DOB_A⟧", barrier: "transport", care_ids: ["item-0"], resource_ids: [] }],
      ask_a_person: false,
      ask_a_person_reason: "",
    });
    const care = [{ id: "item-0", kind: "lab_test", title: "A1c", plain_language: "Get the A1c test.", when: "3 months", source_quote: "Patient: Maria Lopez   DOB: 04/12/1961   MRN: 88412907 Hemoglobin A1c - due in 3 months" }];
    const r = await plan.POST(post("/api/plan", { care, barriers: ["transport"], zip: "30303", language: "English", note: "Ms. Lopez works nights." }));
    expect(r.status).toBe(200);
    neverSent();
    const body = await r.json();
    const text = paidSpeechText(body);
    expect(text).not.toMatch(/⟦|⟧|NAME_|MRN_|DOB_/);
    for (const id of IDENTIFIERS) expect(text).not.toContain(id);
    expect(body.summary).toBe("Here is your plan. Should rest.");
    expect(verifySpeakToken(body.speak_token, "English", text)).toBe(true);
  });
});

describe("rule 2: the last nets before ElevenLabs and Vonage", () => {
  it("the voice vendor never receives a placeholder", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(4000).buffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    const { synthesize, resetVoiceStateForTests } = await import("./voice");
    resetVoiceStateForTests();
    await synthesize(`⟦NAME_A⟧, take your pills ${Math.random()}`, "English", { keep: false });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.text).not.toMatch(/⟦|⟧|NAME_/);
    expect(body.text).toMatch(/^Take your pills/);
    vi.unstubAllGlobals();
  });

  it("the phone call's talk actions never carry a placeholder", async () => {
    const { planNcco } = await import("./call/ncco");
    const actions = planNcco({ text: "1. ⟦NAME_A⟧, book the lab.\n2. Call NAME_B.", language: "English", audioUrl: null, inputUrl: "https://x/input", replays: 0 });
    const said = actions.filter((a) => a.action === "talk").map((a) => String(a.text)).join("\n");
    expect(said).not.toMatch(/⟦|⟧|NAME_/);
    expect(said).toContain("Book the lab.");
  });
});

describe("the page's x-atlas-shielded header is never trusted", () => {
  const spoofed = (path: string, body: unknown) =>
    new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `10.2.0.${++ip}`, "x-atlas-shielded": "1" }, body: JSON.stringify(body) });

  it("raw identifiers under a spoofed header are still shielded on every route", async () => {
    answer = readPaper;
    expect((await extract.POST(spoofed("/api/extract", { text: NAMED_PAPER, language: "English", reading_level: "simple" }))).status).toBe(200);
    neverSent();
    sent.length = 0;
    await readExtractEvents((await stream.POST(spoofed("/api/extract/stream", { text: NAMED_PAPER, language: "English", reading_level: "simple" }))).body!, () => {});
    neverSent();
    sent.length = 0;
    answer = () => ({ questions: [] });
    expect((await understand.POST(spoofed("/api/understand", { source_text: NAMED_PAPER, language: "English", items: [{ id: "item-0", kind: "medication", title: "Maria Lopez", source_quote: "Maria, take metformin 500 mg by mouth 2 times a day with meals." }] }))).status).toBe(200);
    neverSent();
    sent.length = 0;
    answer = () => ({ results: [] });
    expect((await meaning.POST(spoofed("/api/meaning", { items: [{ id: "a", plain_language: "Take metformin.", when: "", source_quote: "Patient: Maria Lopez   DOB: 04/12/1961   MRN: 88412907" }] }))).status).toBe(200);
    neverSent();
    sent.length = 0;
    answer = () => ({ summary: "Plan.", steps: [], ask_a_person: false, ask_a_person_reason: "" });
    const care = [{ id: "item-0", kind: "lab_test", title: "A1c", plain_language: "Get the A1c test.", when: "", source_quote: "Patient: Maria Lopez   DOB: 04/12/1961   MRN: 88412907" }];
    expect((await plan.POST(spoofed("/api/plan", { care, barriers: ["transport"], zip: "30303", language: "English", note: "" }))).status).toBe(200);
    neverSent();
  });
});

describe("fails closed on the answer side", () => {
  it("a placeholder the request did not carry and the server did not make (a model made it up) never reaches the answer", async () => {
    answer = (params) => ({ ...readPaper(params), questions_for_doctor: ["Ask about ⟦NAME_Q⟧ and the dose."] });
    const body = await (await extract.POST(post("/api/extract", { text: NAMED_PAPER, language: "English", reading_level: "simple" }))).json();
    expect(body.questions_for_doctor).toEqual(["Ask about and the dose."]);
  });
});
