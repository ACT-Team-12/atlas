import { describe, expect, it } from "vitest";
import { planShareText } from "./shareText";
import type { VerifiedItem } from "./schema";
import type { PlanResponse } from "./plan";

const item = (o: Partial<VerifiedItem>): VerifiedItem => ({
  id: "c1", kind: "lab_test", title: "Blood test", plain_language: "Get your blood drawn.", why: "", when: "within 2 weeks",
  source_quote: "Return for basic metabolic panel within 2 weeks.", needs_clarification: false, question_for_clinic: "",
  grounded: true, span: { start: 0, end: 10 }, ...o,
});

const plan = (o: Partial<PlanResponse> = {}): PlanResponse => ({
  summary: "Get the blood test done this week.",
  steps: [{ title: "Book the lab", action: "Call the clinic.", why: "", barrier: "", care_ids: ["c1"], resource_ids: ["mercy"] } as PlanResponse["steps"][number]],
  resources: {
    mercy: { type: "clinic", id: "mercy", km: 2, clinic: { name: "Mercy Care", phone: "(678) 843-8500", address: "424 Decatur St SE", city: "Atlanta", zip: "30312" } } as PlanResponse["resources"][string],
    unused: { type: "clinic", id: "unused", km: 9, clinic: { name: "Not Used Clinic", phone: "(404) 000-0000", address: "1 Main", city: "Atlanta", zip: "30303" } } as PlanResponse["resources"][string],
  },
  ask_a_person: false, ask_a_person_reason: "", located: { by: "zip", label: "30312" },
  stats: { candidates: 2, steps: 1, dropped_refs: 0, ms: 1 }, model: "x", ...o,
});

describe("send to family text", () => {
  it("carries every grounded step with the line from the paper, the plan, and only the numbers the plan uses", () => {
    const t = planShareText({ items: [item({})], plan: plan(), questions: ["Do I need to fast?"] });
    expect(t).toContain("Lab test: Blood test (within 2 weeks)");
    expect(t).toContain('Paper says: "Return for basic metabolic panel within 2 weeks."');
    expect(t).toContain("1. Book the lab. Call the clinic.");
    expect(t).toContain("Mercy Care: (678) 843-8500");
    expect(t).not.toContain("Not Used Clinic");
    expect(t).toContain("- Do I need to fast?");
    expect(t).toMatch(/not medical advice/);
  });

  it("leaves out steps that are not grounded in the paper", () => {
    const t = planShareText({ items: [item({}), item({ id: "c2", title: "Made up step", grounded: false, span: null })], plan: plan(), questions: [] });
    expect(t).not.toContain("Made up step");
    expect(t).not.toContain("QUESTIONS FOR THE NEXT VISIT");
  });

  it("gives a program's verified link when it has no phone", () => {
    const p = plan({
      steps: [{ title: "Apply", action: "Apply online.", why: "", barrier: "", care_ids: [], resource_ids: ["mcd"], dropped_refs: [] } as PlanResponse["steps"][number]],
      resources: { mcd: { type: "program", id: "mcd", program: { name: "Georgia Medicaid", access: { url: "https://gateway.ga.gov" } } } as PlanResponse["resources"][string] },
    });
    expect(planShareText({ items: [], plan: p, questions: [] })).toContain("- Georgia Medicaid: https://gateway.ga.gov");
  });

  it("keeps the double-check: a flagged explanation is replaced by the paper's words, unchecked ones say so", () => {
    const r = (o: object) => ({ id: "c1", flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same" as const, what_differs: "", certified: true, ...o });
    const certified = planShareText({ items: [item({})], plan: plan(), questions: [], meaning: { status: "done", byId: { c1: r({}) } } });
    expect(certified).toContain("Get your blood drawn.");
    expect(certified).not.toContain("Not double-checked");
    const flagged = planShareText({ items: [item({})], plan: plan(), questions: [], meaning: { status: "done", byId: { c1: r({ flagged: true, certified: false, model_verdict: "different" }) } } });
    expect(flagged).not.toContain("Get your blood drawn.");
    expect(flagged).toContain("Double-check this one with your clinic");
    expect(flagged).toContain('Paper says: "Return for basic metabolic panel within 2 weeks."');
    const failed = planShareText({ items: [item({})], plan: plan(), questions: [], meaning: { status: "error", byId: {} } });
    expect(failed).toContain("(Not double-checked. If this and the paper differ, follow the paper.)");
  });

  it("says when the plan needs a person", () => {
    const t = planShareText({ items: [], plan: plan({ ask_a_person: true, ask_a_person_reason: "No verified program for housing." }), questions: [] });
    expect(t).toContain("This needs a person too: No verified program for housing.");
  });
});
