import { describe, expect, it, vi } from "vitest";

/**
 * The live plan of 2026-10-03 showed internal ids to the person ("the fasting blood test within 2 weeks (item-4)").
 * Here the model call is replaced by that exact output and the whole path is checked: buildPlan, /api/plan and the
 * text it signs for the voice and the phone call, the share text, and what read-aloud says.
 */
const LIVE = "The trips that matter most: the fasting blood test within 2 weeks (item-4), the eye doctor visit (item-5), the A1c test (item-3) and your clinic visit in 3 months (item-6).";
const LIVE_CLEAN = "The trips that matter most: the fasting blood test within 2 weeks, the eye doctor visit, the A1c test and your clinic visit in 3 months.";

const modelPlan = {
  summary: LIVE,
  steps: [
    { title: "Fasting blood test (item-4)", action: "Go to the lab before breakfast (item-4).", why: "Your paper asks for it within 2 weeks (care id item-4).", barrier: "transport", care_ids: ["item-4"], resource_ids: [] },
    { title: "Eye doctor visit", action: "Call to book the eye exam [item-5].", why: "", barrier: "", care_ids: ["item-5", "item-99"], resource_ids: [] },
  ],
  ask_a_person: true,
  ask_a_person_reason: "No verified ride for the clinic visit (item-6) or the A1c recheck (lab-a1c).",
};

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.FEEDBACK_SECRET = "test-secret";
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { parse: async () => ({ stop_reason: "end_turn", parsed_output: structuredClone(modelPlan) }) }; },
}));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), recordEvent: () => {} }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const { buildPlan } = await import("./plan");
const { POST } = await import("@/app/api/plan/route");
const { verifySpeakToken } = await import("./speakToken");
const { paidSpeechText, speechLines } = await import("./speechText");
const { planShareText } = await import("./shareText");

// "lab-a1c": a care id that is not shaped like item-N and that no kept step links, so only the ids buildPlan was
// given can catch it.
const care = ["item-3", "item-4", "item-5", "item-6", "lab-a1c"].map((id) => ({ id, kind: "lab_test", title: id, plain_language: "p", when: "", source_quote: "q" }));
const req = { care, barriers: ["transport" as const], zip: "30303", language: "English" as const, note: "" };
const ID = /item-\d/;

describe("the plan never shows its internal ids", () => {
  it("buildPlan returns the live sentence without ids, and every other free-text field clean, links kept", async () => {
    const plan = await buildPlan(req);
    expect(plan.summary).toBe(LIVE_CLEAN);
    expect(plan.steps[0]).toMatchObject({ title: "Fasting blood test", action: "Go to the lab before breakfast.", why: "Your paper asks for it within 2 weeks.", care_ids: ["item-4"] });
    expect(plan.steps[1]).toMatchObject({ action: "Call to book the eye exam.", care_ids: ["item-5"], dropped_refs: ["item-99"] });
    expect(plan.ask_a_person_reason).toBe("No verified ride for the clinic visit or the A1c recheck.");
    expect([plan.summary, plan.ask_a_person_reason, ...plan.steps.flatMap((s) => [s.title, s.action, s.why])].join(" ")).not.toMatch(/item-\d|lab-a1c/);
  });

  it("/api/plan signs the clean text, so read aloud, the phone call and share all say it without ids", async () => {
    const r = await POST(new Request("http://localhost/api/plan", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.9.9.8" }, body: JSON.stringify(req) }));
    expect(r.status).toBe(200);
    const plan = await r.json();
    expect(plan.summary).toBe(LIVE_CLEAN);
    const spoken = paidSpeechText(plan);
    expect(spoken).toContain(LIVE_CLEAN);
    expect(spoken).not.toMatch(ID);
    expect(verifySpeakToken(plan.speak_token, "English", spoken)).toBe(true); // what the call and the natural voice read
    expect(speechLines(plan).join("\n")).not.toMatch(ID);
    const items = care.map((c) => ({ ...c, grounded: true, span: null, source_quote: "q" }));
    expect(planShareText({ items: items as never, plan, questions: [] })).not.toMatch(ID);
  });
});
