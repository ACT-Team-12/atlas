import { describe, expect, it, vi } from "vitest";

/**
 * POST /api/plan/stream against a replaced model stream: the lines it sends, the final body (the same as /api/plan,
 * tokens included), and its errors.
 */
const modelPlan = {
  summary: "Get the blood test this week.",
  steps: [
    { title: "Fasting blood test (item-4)", action: "Go before breakfast.", why: "", barrier: "transport", care_ids: ["item-4"], resource_ids: [] },
    { title: "Eye doctor visit", action: "Call to book.", why: "", barrier: "", care_ids: ["item-5"], resource_ids: [] },
  ],
  ask_a_person: false,
  ask_a_person_reason: "",
};
let stopReason = "end_turn";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.FEEDBACK_SECRET = "test-secret";
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      stream: () => {
        const text = JSON.stringify(modelPlan);
        return {
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < text.length; i += 17) yield { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(i, i + 17) } };
          },
          finalMessage: async () => ({ stop_reason: stopReason, parsed_output: structuredClone(modelPlan) }),
        };
      },
    };
  },
}));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), recordEvent: () => {} }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const { POST } = await import("@/app/api/plan/stream/route");
const { verifySpeakToken } = await import("./speakToken");
const { paidSpeechText } = await import("./speechText");

const care = ["item-4", "item-5"].map((id) => ({ id, kind: "lab_test", title: id, plain_language: "p", when: "", source_quote: "q" }));
const body = { care, barriers: ["transport"], zip: "30303", language: "English" };
const post = (b: unknown, ip: string) =>
  POST(new Request("http://localhost/api/plan/stream", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(b) }));
const lines = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l));

describe("/api/plan/stream", () => {
  it("sends resources, then each checked step, then the plan with the same tokens as /api/plan", async () => {
    stopReason = "end_turn";
    const r = await post(body, "10.7.7.1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    const ev = await lines(r);
    expect(ev.map((e) => e.type)).toEqual(["start", "step", "step", "done"]);
    expect(ev[1].step.title).toBe("Fasting blood test");
    const plan = ev[3].plan;
    expect(plan.steps).toEqual([ev[1].step, ev[2].step]);
    expect(typeof plan.feedback_token).toBe("string");
    expect(verifySpeakToken(plan.speak_token, "English", paidSpeechText(plan))).toBe(true);
  });

  it("a refusal ends with the plain route's error, after any steps", async () => {
    stopReason = "refusal";
    const ev = await lines(await post(body, "10.7.7.2"));
    expect(ev.at(-1)).toEqual({ type: "error", error: "The AI declined to build this plan.", status: 422 });
    expect(ev.some((e) => e.type === "done")).toBe(false);
  });

  it("rejects what /api/plan rejects, as plain JSON", async () => {
    const empty = await post({ care: [], barriers: [], language: "English" }, "10.7.7.3");
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/Pick at least one/);
    const bad = await post({ ...body, zip: "abc" }, "10.7.7.4");
    expect(bad.status).toBe(400);
  });

  it("no AI key: a plain 503, so the page shows it instead of retrying", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await post(body, "10.7.7.5");
      expect(r.status).toBe(503);
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });
});
