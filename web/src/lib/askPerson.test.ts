import { describe, expect, it } from "vitest";
import { askPerson } from "./askPerson";

const LIS = "lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.";
// AI words that must never reach the question: if one does, the test fails.
const ai = { title: "AI-TITLE Take 20 mg", when: "AI-WHEN twice a day", plain_language: "AI-PLAIN take 2 mg" };

describe("ask a person: built from the paper's words only", () => {
  it.each(["unchecked", "flagged"] as const)("a %s medicine step asks the pharmacist, quoting the paper word for word", (check) => {
    const a = askPerson({ kind: "medication", source_quote: LIS, ...ai }, check)!;
    expect(a).toEqual({
      who: "pharmacist", label: "Ask your pharmacist",
      question: `My paper says: "${LIS}" Can you confirm what I should take?`,
    });
    for (const w of Object.values(ai)) expect(a.question).not.toContain(w);
  });

  it("any other uncertified step asks the clinic", () => {
    const q = "Basic metabolic panel - fasting, complete within 2 weeks at any Quest or Labcorp location";
    expect(askPerson({ kind: "lab_test", source_quote: q }, "unchecked")).toEqual({
      who: "clinic", label: "Ask your clinic", question: `My paper says: "${q}" Can you help me understand what I should do?`,
    });
  });

  it("the question is the paper's words plus fixed wording, nothing else", () => {
    const a = askPerson({ kind: "medication", source_quote: `  ${LIS.replace(/ /g, "\n ")} `, ...ai }, "unchecked")!;
    const rest = a.question.replace(LIS, "");
    expect(rest).toBe('My paper says: "" Can you confirm what I should take?');
  });

  it("certified steps, warning signs and empty quotes get nothing new", () => {
    expect(askPerson({ kind: "medication", source_quote: LIS }, "certified")).toBeNull();
    expect(askPerson({ kind: "warning_sign", source_quote: "Call 911 if you have chest pain." }, "unchecked")).toBeNull();
    expect(askPerson({ kind: "medication", source_quote: "   " }, "unchecked")).toBeNull();
  });
});
