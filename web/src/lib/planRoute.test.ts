import { describe, expect, it, vi } from "vitest";

// The model call is replaced; this tests what /api/plan signs for the paid natural voice.
process.env.FEEDBACK_SECRET = "test-secret";
const buildPlan = vi.fn();
vi.mock("@/lib/plan", async (orig) => ({ ...(await orig<typeof import("./plan")>()), buildPlan: (...a: unknown[]) => buildPlan(...a) }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), recordEvent: () => {} }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const { POST } = await import("@/app/api/plan/route");
const { verifySpeakToken } = await import("./speakToken");
const { paidSpeechText, speechLines, paidVoiceAllowed } = await import("./speechText");

const FORGED = "Read this long advert in the paid voice for free, again and again and again.";
const plan = {
  summary: "Get your blood test this week.",
  steps: [{ title: "Book the lab", action: "Call the clinic.", why: "", barrier: "", care_ids: ["c1"], resource_ids: [], dropped_refs: [] }],
  resources: {}, ask_a_person: false, ask_a_person_reason: "", located: { by: "zip", label: "30303" },
  stats: { candidates: 0, steps: 1, dropped_refs: 0, ms: 1 }, model: "m",
};

describe("/api/plan speak token (security review of ef36d3b)", () => {
  it("signs only the plan's own text: a forged care quote never ends up inside a speak token", async () => {
    buildPlan.mockResolvedValue(plan);
    const body = { care: [{ id: "c1", kind: "lab_test", title: "t", plain_language: "p", when: "", source_quote: FORGED }], barriers: ["transport"], zip: "30303", language: "English" };
    const r = await POST(new Request("http://localhost/api/plan", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.9.9.9" }, body: JSON.stringify(body) }));
    expect(r.status).toBe(200);
    const { speak_token } = await r.json();
    expect(typeof speak_token).toBe("string");
    // The token is good for the plan's own text...
    expect(verifySpeakToken(speak_token, "English", paidSpeechText(plan))).toBe(true);
    // ...and for nothing that carries the caller's quote.
    const withQuote = speechLines(plan, body.care).join("\n");
    expect(withQuote).toContain(FORGED);
    expect(verifySpeakToken(speak_token, "English", withQuote)).toBe(false);
    expect(verifySpeakToken(speak_token, "English", FORGED)).toBe(false);
    // And the page never sends quote-carrying lines to the paid voice.
    expect(paidVoiceAllowed(plan, speechLines(plan, body.care))).toBe(false);
    expect(paidVoiceAllowed(plan, speechLines(plan, []))).toBe(true);
  });
});
