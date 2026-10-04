// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
// Records what Show on my paper is given, so the photo passthrough can be checked without reading a photo.
const shown: { photo: File | null }[] = [];
vi.mock("./ShowOnPaper", () => ({ ShowOnPaper: (p: { photo: File | null }) => { shown.push({ photo: p.photo }); return null; } }));
import { AskPaper } from "./AskPaper";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = "Return to clinic in 3 months. Call 911 if you have chest pain.";
const care = { source_text: text, source_kind: "text" } as unknown as CarePlanResponse;
const items = [
  { id: "w1", kind: "warning_sign", title: "AI title", source_quote: "Call 911 if you have chest pain.", grounded: true, span: { start: 30, end: 62 } },
  // The model called this a warning sign, but its own words are not warning language: never listed as one.
  { id: "w2", kind: "warning_sign", title: "AI title 2", source_quote: "Return to clinic in 3 months.", grounded: true, span: { start: 0, end: 29 } },
] as unknown as VerifiedItem[];

let root: Root, host: HTMLDivElement;
let reply: { status: number; body: unknown };
const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply.body), { status: reply.status }));
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function askIt(q: string, language = "English") {
  await act(async () => { root.render(<AskPaper care={care} items={items} language={language} />); });
  const input = host.querySelector("input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, q); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { (host.querySelector("button[type=submit]") as HTMLButtonElement).click(); });
}

describe("Ask my paper on screen", () => {
  it("shows the checked quote first, labelled as the paper's words, and the AI lead-in only under 'not double-checked yet'", async () => {
    reply = { status: 200, body: { kind: "answer", quotes: [{ text: "Return to clinic in 3 months.", span: { start: 0, end: 29 } }], topic: "Return to clinic", topic_dropped: null, dropped: ["not_in_paper"], model: "m", ms: 1 } };
    await askIt("when do I come back?");
    const result = host.querySelector("[data-ask-result=answer]")!;
    const quote = result.querySelector("[data-paper-quote]")!;
    const lead = result.querySelector("[data-explanation]")!;
    expect(quote.textContent).toContain("Copied word for word from your paper");
    expect(quote.textContent).toContain("Return to clinic in 3 months.");
    expect(lead.textContent).toContain("Plain words (not double-checked yet)");
    expect(lead.textContent).toContain('Your paper says this about "Return to clinic":');
    // Paper first: the quote comes before the AI's words in the page.
    expect(quote.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector("[data-ask-held]")?.textContent).toContain("1 quote from the AI held back");
    expect(shown.length).toBeGreaterThan(0);
  });

  it("the refusal is fixed text plus a question made only from the person's words, with no AI text at all", async () => {
    reply = { status: 200, body: { kind: "not_in_paper", dropped: ["not_in_paper", "not_in_paper"], model: "m", ms: 1 } };
    await askIt("can I drink alcohol?");
    const r = host.querySelector("[data-ask-result=not_in_paper]")!;
    expect(r.textContent).toContain("Your paper doesn't say. Ask your clinic or pharmacist.");
    expect(r.querySelector("[data-ask-question]")?.textContent).toBe('I couldn\'t find the answer to this in my visit paper: "can I drink alcohol?" Can you help me?');
    expect(host.querySelector("[data-explanation]")).toBeNull();
    expect(host.querySelector("[data-ask-held]")?.textContent).toContain("2 quotes");
  });

  it("an urgent question is never sent: 911 / 211 guidance and the paper's own warning line instead", async () => {
    await askIt("I have chest pain right now");
    expect(fetchMock).not.toHaveBeenCalled();
    const r = host.querySelector("[data-ask-result=urgent]")!;
    expect(r.textContent).toContain("call 911");
    expect(r.textContent).toContain("211");
    expect(r.textContent).toContain("Call 911 if you have chest pain.");
    expect(r.textContent).not.toContain("AI title");
    expect(r.textContent).not.toContain("Return to clinic");
  });

  it("shows a server refusal (rate limit) as a localized error, not an answer and not the server's English", async () => {
    reply = { status: 429, body: { error: "You've made a lot of requests. Try again in about 10 minutes." } };
    await askIt("¿puedo manejar?", "Spanish");
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Demasiadas preguntas por ahora. Espere unos minutos e inténtelo de nuevo, o pregunte en su clínica o a su farmacéutico.");
    expect(host.querySelector("[data-ask-result]")).toBeNull();
  });

  it("passes the photo the paper was read from to Show on my paper, as the steps do (Codex review, round 5)", async () => {
    shown.length = 0;
    const photo = new File(["x"], "paper.jpg", { type: "image/jpeg" });
    reply = { status: 200, body: { kind: "answer", quotes: [{ text: "Return to clinic in 3 months.", span: { start: 0, end: 29 } }], topic: null, topic_dropped: null, dropped: [], model: "m", ms: 1 } };
    await act(async () => { root.render(<AskPaper care={{ ...care, source_kind: "image" } as CarePlanResponse} items={items} language="English" photo={photo} />); });
    const input = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "when do I come back?"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { (host.querySelector("button[type=submit]") as HTMLButtonElement).click(); });
    expect(shown.at(-1)?.photo).toBe(photo);
  });

  it("the shared daily cap says try tomorrow, not wait a few minutes", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "x" }), { status: 429, headers: { "x-atlas-limit": "shared-daily" } }));
    await askIt("can I drive?");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Try again tomorrow");
  });

  it("a slow answer never lands under a question the person has since changed (Codex review, round 3)", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => { release = res; }));
    await askIt("when do I come back?");
    const input = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "can I stop my medicine?"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const body = { kind: "answer", quotes: [{ text: "Return to clinic in 3 months.", span: { start: 0, end: 29 } }], topic: null, topic_dropped: null, dropped: [], model: "m", ms: 1 };
    await act(async () => { release(new Response(JSON.stringify(body), { status: 200 })); });
    expect(host.querySelector("[data-ask-result]")).toBeNull();
  });

  it("editing the question clears an answer already shown", async () => {
    reply = { status: 200, body: { kind: "answer", quotes: [{ text: "Return to clinic in 3 months.", span: { start: 0, end: 29 } }], topic: null, topic_dropped: null, dropped: [], model: "m", ms: 1 } };
    await askIt("when do I come back?");
    expect(host.querySelector("[data-ask-result=answer]")).not.toBeNull();
    expect(host.textContent).toContain("when do I come back?");
    const input = host.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "can I drive?"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector("[data-ask-result]")).toBeNull();
  });

  it("shows a quote only if its words are exactly the paper text at its span (security review finding)", async () => {
    reply = { status: 200, body: { kind: "answer", quotes: [
      { text: "Return to clinic in 3 months.", span: { start: 0, end: 29 } },
      { text: "Double your dose.", span: { start: 30, end: 47 } },
    ], topic: null, topic_dropped: null, dropped: [], model: "m", ms: 1 } };
    await askIt("when do I come back?");
    expect(host.textContent).toContain("Return to clinic in 3 months.");
    expect(host.textContent).not.toContain("Double your dose.");
  });

  it("speaks the person's language for every fixed line", async () => {
    reply = { status: 200, body: { kind: "not_in_paper", dropped: [], model: "m", ms: 1 } };
    await askIt("¿puedo manejar?", "Spanish");
    expect(host.textContent).toContain("Su papel no lo dice.");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ source_text: text, language: "Spanish", question: "¿puedo manejar?" });
  });
});
