import { describe, expect, it } from "vitest";
import { cleanPlanText, restoredPlan, stripIds } from "./planText";

describe("ids are trusted only when the server sent them", () => {
  it("a term like A1c is never removed, even if passed as an id; a model's made-up refs never become redaction terms", () => {
    expect(stripIds("Get your A1c test (A1c).", ["A1c"])).toBe("Get your A1c test (A1c).");
    const plan = {
      summary: "Get your A1c test and your fasting-glucose check.", ask_a_person_reason: "",
      steps: [{ title: "A1c", action: "Ask about fasting-glucose.", why: "", barrier: "", care_ids: ["item-3"], resource_ids: [], dropped_refs: ["A1c", "fasting-glucose"] }],
    };
    expect(cleanPlanText(plan)).toBe(plan);
  });
});

describe("a restored plan", () => {
  const steps = [{ title: "Lab", action: "Go.", why: "", barrier: "", care_ids: ["item-4"], resource_ids: [], dropped_refs: [] }];
  it("keeps its speak token when there was nothing to clean", () => {
    const plan = { summary: "Get the blood test.", ask_a_person_reason: "", steps, speak_token: "tok" };
    expect(restoredPlan(plan)).toBe(plan);
  });
  it("loses its speak token when its text changed, so read aloud and the call never try a token signed for other text", () => {
    const plan = { summary: "Get the blood test (item-4).", ask_a_person_reason: "", steps, speak_token: "tok" };
    expect(restoredPlan(plan)).toMatchObject({ summary: "Get the blood test.", speak_token: null });
  });
});

/** The sentence a live plan showed the person on 2026-10-03. */
const LIVE = "The trips that matter most: the fasting blood test within 2 weeks (item-4), the eye doctor visit (item-5), the A1c test (item-3) and your clinic visit in 3 months (item-6).";
const LIVE_CLEAN = "The trips that matter most: the fasting blood test within 2 weeks, the eye doctor visit, the A1c test and your clinic visit in 3 months.";

describe("internal ids never reach the person", () => {
  it("strips the exact live sentence", () => {
    expect(stripIds(LIVE)).toBe(LIVE_CLEAN);
  });

  it("strips several ids in one bracket, labels, resource ids, and bare ids, and tidies what is left", () => {
    const ids = ["grady-financial-assistance", "georgia-medicaid-apply"];
    expect(stripIds("Get the labs (item-3, item-4).", ids)).toBe("Get the labs.");
    expect(stripIds("Get the labs (care ids item-3 and item-4).", ids)).toBe("Get the labs.");
    expect(stripIds("Ask about help paying (grady-financial-assistance).", ids)).toBe("Ask about help paying.");
    expect(stripIds("Apply for Medicaid [georgia-medicaid-apply] this week.", ids)).toBe("Apply for Medicaid this week.");
    expect(stripIds("Bring the paper for item-4 to the lab.", ids)).toBe("Bring the paper for to the lab.");
    expect(stripIds("See care id item-4, then call.", ids)).toBe("See, then call.");
    expect(stripIds("You paid item-4 already.", ids)).toBe("You paid already."); // "id" inside a word is not a label
    expect(stripIds("Get the labs (item-4, fasting).", ids)).toBe("Get the labs (fasting).");
    expect(stripIds("análisis en ayunas (item-4) y la visita (item-5).")).toBe("análisis en ayunas y la visita.");
    expect(stripIds("空腹抽血（item-4）和眼科检查（item-5）。")).toBe("空腹抽血和眼科检查。");
  });

  it("leaves text without ids exactly as it was, including words that look like ids but are not", () => {
    for (const t of ["Take the blue pill. Call Dr. Lee.", "Your A1c was 7.2 (high).", "Bring your photo ID and insurance card.", "Paid item: the copay (about $20).", "Use the item-by-item list."]) {
      expect(stripIds(t, ["annual", "cbc"])).toBe(t);
    }
    // a plain-word id is never removed from prose
    expect(stripIds("Get your annual exam (annual).", ["annual"])).toBe("Get your annual exam (annual).");
  });

  it("cleans every free-text field of a plan, and returns the same object when there is nothing to clean", () => {
    const plan = {
      summary: LIVE,
      steps: [{ title: "Lab test (item-4)", action: "Go to the lab (grady-lab) fasting.", why: "Your paper asks for it (item-4).", barrier: "", care_ids: ["item-4"], resource_ids: ["grady-lab"], dropped_refs: [] }],
      resources: {},
      ask_a_person: true,
      ask_a_person_reason: "No verified ride for item-6.",
    };
    const clean = cleanPlanText(plan);
    expect(clean.summary).toBe(LIVE_CLEAN);
    expect(clean.steps[0]).toMatchObject({ title: "Lab test", action: "Go to the lab fasting.", why: "Your paper asks for it.", care_ids: ["item-4"], resource_ids: ["grady-lab"] });
    expect(clean.ask_a_person_reason).toBe("No verified ride for.");
    expect(JSON.stringify([clean.summary, clean.steps, clean.ask_a_person_reason].map(String))).not.toMatch(/item-\d|grady-lab/);
    expect(cleanPlanText(clean)).toBe(clean);
  });
});
