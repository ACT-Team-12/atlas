import { describe, expect, it } from "vitest";
import { ItemScanner } from "./itemScanner";
import { finishPlan, preparePlan, PlanRequestSchema } from "./plan";
import { streamPlan } from "./planStream";
import type { ModelStream } from "./extractStream";
import { encodePlanEvent, readPlanEvents, type PlanEvent, type PlanPreview } from "./planEvents";
import { StreamBroken, StreamFailed } from "./extractEvents";

const care = ["item-3", "item-4", "item-5"].map((id) => ({ id, kind: "lab_test", title: id, plain_language: "p", when: "", source_quote: "q" }));
const req = PlanRequestSchema.parse({ care, barriers: ["transport"], zip: "30303", language: "English" });

// The model's output order: summary, steps, then the rest. Step 2 links nothing real, so it is never shown.
const OUTPUT = {
  summary: "Get the blood test this week (item-4).",
  steps: [
    { title: "Fasting blood test (item-4)", action: 'Go before breakfast. Bring the "lab" slip {not json} ] here.', why: "Your paper asks (care id item-4).", barrier: "transport", care_ids: ["item-4"], resource_ids: [] },
    { title: "Made up", action: "Call the made-up place.", why: "", barrier: "cost", care_ids: ["item-99"], resource_ids: ["nope"] },
    { title: "Eye doctor visit", action: "Call to book the eye exam [item-5].", why: "", barrier: "", care_ids: ["item-5", "item-98"], resource_ids: [] },
  ],
  ask_a_person: false,
  ask_a_person_reason: "",
};
const RAW = JSON.stringify(OUTPUT, null, 1);

function fakeModel(text: string, chunk: number, parsed: unknown = JSON.parse(text), stopReason = "end_turn"): ModelStream {
  return {
    text: (async function* () {
      for (let i = 0; i < text.length; i += chunk) yield text.slice(i, i + chunk);
    })(),
    final: async () => ({ parsed, stopReason }),
  };
}

describe("ItemScanner on a plan's steps", () => {
  it("returns each step only once complete, at every cut point, and nothing from other keys", () => {
    for (let cut = 0; cut <= RAW.length; cut++) {
      const s = new ItemScanner("steps");
      const got = [...s.push(RAW.slice(0, cut)), ...s.push(RAW.slice(cut))];
      expect(got.map((g) => JSON.parse(g))).toEqual(OUTPUT.steps);
    }
    // The read's scanner key is untouched: a plan has no "items".
    expect(new ItemScanner().push(RAW)).toEqual([]);
  });
});

describe("streamPlan", () => {
  it("sends the verified resources first, then only kept steps, exactly as the final plan has them", async () => {
    for (const chunk of [1, 7, 64, RAW.length]) {
      const events: PlanEvent[] = [];
      const ctx = preparePlan(req);
      const plan = await streamPlan(ctx, fakeModel(RAW, chunk), (e) => events.push(e));
      expect(events[0]).toEqual({ type: "start", resources: ctx.resources, located: ctx.located });
      const streamed = events.filter((e) => e.type === "step").map((e) => (e as { step: unknown }).step);
      expect(streamed).toEqual(plan.steps);
      expect(streamed).toHaveLength(2); // the step linking nothing real never shows
      expect(plan.stats).toMatchObject({ steps: 2, dropped_refs: 3 });
    }
  });

  it("a streamed step never shows an id, and keeps its real links", async () => {
    const events: PlanEvent[] = [];
    await streamPlan(preparePlan(req), fakeModel(RAW, 5), (e) => events.push(e));
    const steps = events.flatMap((e) => (e.type === "step" ? [e.step] : []));
    expect(steps[0]).toMatchObject({ title: "Fasting blood test", why: "Your paper asks.", care_ids: ["item-4"], barrier: "transport" });
    expect(steps[1]).toMatchObject({ action: "Call to book the eye exam.", care_ids: ["item-5"], dropped_refs: ["item-98"] });
    expect(JSON.stringify(steps.map((s) => [s.title, s.action, s.why]))).not.toMatch(/item-\d/);
  });

  it("the final plan is what the plain route builds from the same output", async () => {
    const plan = await streamPlan(preparePlan(req, 0), fakeModel(RAW, 13), () => {});
    const plain = finishPlan(preparePlan(req, 0), JSON.parse(RAW), "end_turn");
    expect({ ...plan, stats: { ...plan.stats, ms: 0 } }).toEqual({ ...plain, stats: { ...plain.stats, ms: 0 } });
  });

  it("throws the plain route's errors: malformed output, and a refusal", async () => {
    await expect(streamPlan(preparePlan(req), fakeModel(RAW, 9, { steps: "nope" }), () => {})).rejects.toThrow(/malformed/);
    await expect(streamPlan(preparePlan(req), fakeModel(RAW, 9, JSON.parse(RAW), "refusal"), () => {})).rejects.toThrow(/declined/);
  });
});

function bodyOf(parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } });
}

describe("readPlanEvents", () => {
  const ctx = preparePlan(req, 0);
  const plan = finishPlan(ctx, JSON.parse(RAW), "end_turn");
  const lines = [
    encodePlanEvent({ type: "start", resources: ctx.resources, located: ctx.located }),
    ...plan.steps.map((step) => encodePlanEvent({ type: "step", step })),
    encodePlanEvent({ type: "done", plan }),
  ].join("");

  it("reads lines split across chunks, previews each step with the resources, and returns the final plan", async () => {
    const seen: PlanPreview[] = [];
    const got = await readPlanEvents(bodyOf(lines.match(/[\s\S]{1,11}/g)!), (p) => seen.push(p));
    expect(seen.map((p) => p.steps.length)).toEqual([0, 1, 2]);
    expect(seen.at(-1)!.resources).toEqual(ctx.resources);
    expect(got).toEqual(plan);
  });

  it("a stream that ends before the plan, or a step before the resources, is broken", async () => {
    await expect(readPlanEvents(bodyOf([lines.slice(0, lines.lastIndexOf('{"type":"done"') + 30)]), () => {})).rejects.toBeInstanceOf(StreamBroken);
    await expect(readPlanEvents(bodyOf([encodePlanEvent({ type: "step", step: plan.steps[0] })]), () => {})).rejects.toBeInstanceOf(StreamBroken);
  });

  it("surfaces the server's error", async () => {
    const err = encodePlanEvent({ type: "error", error: "The AI declined to build this plan.", status: 422 });
    await expect(readPlanEvents(bodyOf([err]), () => {})).rejects.toBeInstanceOf(StreamFailed);
  });
});
