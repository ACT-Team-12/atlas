import { describe, expect, it } from "vitest";
import type { Check } from "./paperFirst";
import { generalVisitQuestions, readingGeneralQuestions, stepVisitQuestion, uniqueStepQuestions, visitQuestions } from "./visitQuestions";

const QUOTE = "ibuprofen (ADVIL) 200 mg tablet. Avoid NSAIDs due to kidney function.";
const AI_Q = "Which pain medicines are safe for me instead?";
const step = (o: Partial<Parameters<typeof stepVisitQuestion>[0]> = {}) => ({
  id: "ibu", kind: "medication", source_quote: QUOTE, needs_clarification: true, question_for_clinic: AI_Q, ...o,
});
const all = (c: Check) => () => c;

describe("questions for the next visit, paper first", () => {
  it("a certified step keeps its own question", () => {
    expect(stepVisitQuestion(step(), "certified")).toBe(AI_Q);
    expect(visitQuestions({ items: [step()], general: [], checkFor: all("certified") })).toEqual([AI_Q]);
  });

  it("an unconfirmed or flagged step carries only the paper's words, never the AI's question", () => {
    for (const c of ["unchecked", "flagged"] as const) {
      const q = visitQuestions({ items: [step()], general: [AI_Q, "Do I need to fast?"], checkFor: all(c) });
      expect(q.join("\n")).not.toContain(AI_Q);
      expect(q[0]).toBe(`My paper says: "${QUOTE}" Can you confirm what I should take?`);
      expect(q).toContain("Do I need to fast?");
    }
    expect(stepVisitQuestion(step({ kind: "referral" }), "unchecked")).toBe(`My paper says: "${QUOTE}" Can you help me understand what I should do?`);
  });

  it("a warning sign that is not certified adds no question (its own words say what to do)", () => {
    expect(stepVisitQuestion(step({ kind: "warning_sign" }), "unchecked")).toBeNull();
  });

  it("a step with no question, or not marked as needing one, adds nothing", () => {
    expect(stepVisitQuestion(step({ question_for_clinic: "  " }), "certified")).toBeNull();
    expect(stepVisitQuestion(step({ needs_clarification: false }), "unchecked")).toBeNull();
  });

  it("no duplicate: a step's question repeated in the general list (any case or punctuation) is listed once", () => {
    const q = visitQuestions({ items: [step()], general: ["which pain medicines are safe for me instead", "Do I need to fast?", "Do I need to fast"], checkFor: all("certified") });
    expect(q).toEqual([AI_Q, "Do I need to fast?"]);
  });

  it("a removed step's question stays out of the general list too", () => {
    expect(generalVisitQuestions([AI_Q, "Do I need to fast?"], [step()])).toEqual(["Do I need to fast?"]);
    expect(visitQuestions({ items: [], also: [step()], general: [AI_Q], checkFor: all("certified") })).toEqual([]);
  });

  it("a saved reading's general list never carries a held-back (refused) step's question", () => {
    const refused = step({ id: "r1", question_for_clinic: "Should I double my insulin?" });
    expect(readingGeneralQuestions({ questions_for_doctor: ["Should I double my insulin?", "Do I need to fast?"], items: [step()], refused: [refused] }))
      .toEqual(["Do I need to fast?"]);
  });

  it("two steps with the same question list it once, with the first step's paper line", () => {
    const twin = step({ id: "ibu2", source_quote: "Another line." });
    const q = uniqueStepQuestions([step(), twin], all("certified"));
    expect(q.map((x) => [x.it.id, x.q])).toEqual([["ibu", AI_Q]]);
  });
});
