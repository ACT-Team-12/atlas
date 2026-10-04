import { describe, expect, it } from "vitest";
import { planShareText, type ShareMeaning } from "./shareText";
import type { VerifiedItem } from "./schema";
import type { PlanResponse } from "./plan";
import type { MeaningResult } from "./meaning";

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
    // Never double-checked, so the paper's words go instead of the explanation and the AI's title (paperFirst.ts).
    expect(t).toContain("1. Lab test\n");
    expect(t).not.toContain("Blood test (within 2 weeks)");
    expect(t).not.toContain("Get your blood drawn.");
    expect(t).toContain('Your paper says: "Return for basic metabolic panel within 2 weeks."');
    expect(t).toContain("1. Book the lab. Call the clinic.");
    // ...and the plan step tied to it carries the paper's words too.
    expect(t).toMatch(/1\. Book the lab\. Call the clinic\.\n {3}Your paper says: "Return for basic metabolic panel within 2 weeks\."/);
    expect(t).toContain("WHO CAN HELP (suggested by ATLAS, not from the paper; checked numbers)\n- Mercy Care: (678) 843-8500");
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

  it("paper first: only a certified explanation travels; flagged or unchecked ones are replaced by the paper's words", () => {
    const r = (o: object) => ({ id: "c1", flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same" as const, what_differs: "", certified: true, ...o });
    const certified = planShareText({ items: [item({})], plan: plan(), questions: [], meaning: { status: "done", byId: { c1: r({}) } } });
    expect(certified).toContain("Lab test: Blood test (within 2 weeks)");
    expect(certified).toContain("Get your blood drawn.");
    expect(certified).toContain('Your paper says: "Return for basic metabolic panel within 2 weeks."');
    expect(certified).not.toContain("left out");
    const flagged = planShareText({ items: [item({})], plan: plan(), questions: [], meaning: { status: "done", byId: { c1: r({ flagged: true, certified: false, model_verdict: "different" }) } } });
    expect(flagged).not.toContain("Get your blood drawn.");
    expect(flagged).toContain("Double-check this one with your clinic");
    expect(flagged).toContain('Your paper says: "Return for basic metabolic panel within 2 weeks."');
    const failed = planShareText({ items: [item({})], plan: plan(), questions: [], meaning: { status: "error", byId: {} } });
    expect(failed).not.toContain("Get your blood drawn.");
    expect(failed).toContain("(The plain-words explanation is left out here because it was not double-checked yet.)");
  });

  it("questions for the next visit: an unconfirmed step's AI question is never sent; a certified one is, once", () => {
    const AI_Q = "Should I fast before the blood test?";
    const asks = item({ needs_clarification: true, question_for_clinic: AI_Q });
    // Older readings also carried the step's question in the general list: it must not leak through there either.
    const general = [AI_Q, "Do I need a ride?"];
    const r = (o: Partial<MeaningResult>): MeaningResult => ({ id: "c1", flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same", what_differs: "", certified: true, ...o });
    const notCertified: (ShareMeaning | undefined)[] = [undefined, { status: "error", byId: {} }, { status: "done", byId: { c1: r({ certified: false, flagged: true, model_verdict: "different" }) } }];
    for (const meaning of notCertified) {
      const t = planShareText({ items: [asks], plan: plan(), questions: general, meaning });
      expect(t).not.toContain(AI_Q);
      expect(t).toContain('- My paper says: "Return for basic metabolic panel within 2 weeks." Can you help me understand what I should do?');
      expect(t).toContain("- Do I need a ride?");
    }
    const certified = planShareText({ items: [asks], plan: plan(), questions: general, meaning: { status: "done", byId: { c1: r({}) } } });
    expect(certified.split(AI_Q).length - 1).toBe(1);
    expect(certified).toContain(`- ${AI_Q}`);
  });

  it("says when the plan needs a person", () => {
    const t = planShareText({ items: [], plan: plan({ ask_a_person: true, ask_a_person_reason: "No verified program for housing." }), questions: [] });
    expect(t).toContain("This needs a person too: No verified program for housing.");
  });
});
