import { describe, expect, it } from "vitest";
import { checkQuestions, type DraftQuestion } from "./understand";
import { PAPERS } from "./checkerTest";

const paper = PAPERS.find((p) => p.id === "diabetes-hypertension")!;
const items = [
  { id: "item-0", kind: "medication", title: "Start metformin", source_quote: "START metformin 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals." },
  { id: "item-1", kind: "warning_sign", title: "Call 911", source_quote: "Call 911 if you have chest pain or trouble breathing." },
];
const good: DraftQuestion = {
  item_id: "item-0",
  question: "How often do you take metformin?",
  options: ["Once a day", "2 times a day with meals", "Only when your sugar is high"],
  correct: 1,
  answer_quote: "2 times a day with meals",
};

describe("teach-back checker", () => {
  it("keeps a question whose proof is in the paper inside its own step", () => {
    const r = checkQuestions(paper.text, items, [good]);
    expect(r.dropped).toEqual([]);
    expect(r.questions).toHaveLength(1);
    expect(paper.text.slice(r.questions[0].span.start, r.questions[0].span.end).toLowerCase()).toBe("2 times a day with meals");
  });

  it("drops a proof that is not in the paper (an invented dose)", () => {
    const r = checkQuestions(paper.text, items, [{ ...good, answer_quote: "3 times a day with meals" }]);
    expect(r.questions).toEqual([]);
    expect(r.dropped).toEqual([{ item_id: "item-0", reason: "quote_not_in_paper" }]);
  });

  it("drops a question whose marked answer contradicts its own quote (Codex 2026-10-02)", () => {
    const r = checkQuestions(paper.text, items, [{ ...good, options: ["Once daily", "3 times daily", "Only as needed"], correct: 1 }]);
    expect(r.questions).toEqual([]);
    expect(r.dropped).toEqual([{ item_id: "item-0", reason: "answer_not_in_quote" }]);
  });

  it("drops a question where a 'wrong' option carries exactly the quote's numbers", () => {
    const r = checkQuestions(paper.text, items, [{ ...good, options: ["2 times a day", "With every meal", "Only at bedtime"], correct: 1 }]);
    expect(r.dropped).toEqual([{ item_id: "item-0", reason: "distractor_matches_quote" }]);
  });

  it("keeps a question whose quote has several numbers and a wrong option uses one of them", () => {
    const q: DraftQuestion = { item_id: "item-0", question: "How many tablets each time?", options: ["2 tablets", "1 tablet", "Half a tablet"], correct: 1, answer_quote: "Take 1 tablet by mouth 2 times a day with meals" };
    expect(checkQuestions(paper.text, items, [q]).dropped).toEqual([]);
  });

  it("treats a fraction as one value, so a wrong '2 tablets' cannot pass against '1/2 tablet' (Grok 2026-10-02)", () => {
    const halfPaper = "Take 1/2 tablet by mouth at bedtime.";
    const halfItems = [{ id: "item-0", kind: "medication", title: "Half tablet", source_quote: halfPaper }];
    const base: DraftQuestion = { item_id: "item-0", question: "How much do you take?", options: ["1/2 tablet", "2 tablets", "1 tablet"], correct: 0, answer_quote: "Take 1/2 tablet" };
    expect(checkQuestions(halfPaper, halfItems, [base]).dropped).toEqual([]);
    expect(checkQuestions(halfPaper, halfItems, [{ ...base, correct: 1 }]).dropped).toEqual([{ item_id: "item-0", reason: "answer_not_in_quote" }]);
    // Codex re-check: a mixed number is one value too
    const mixedPaper = "Take 1 1/2 tablets by mouth daily.";
    const mixedItems = [{ id: "item-0", kind: "medication", title: "Dose", source_quote: mixedPaper }];
    const wrong: DraftQuestion = { item_id: "item-0", question: "How many tablets?", options: ["1 tablet", "2 tablets", "3 tablets"], correct: 0, answer_quote: "Take 1 1/2 tablets by mouth daily" };
    expect(checkQuestions(mixedPaper, mixedItems, [wrong]).dropped).toEqual([{ item_id: "item-0", reason: "answer_not_in_quote" }]);
    expect(checkQuestions(mixedPaper, mixedItems, [{ ...wrong, options: ["1 1/2 tablets", "2 tablets", "1 tablet"] }]).dropped).toEqual([]);
    expect(checkQuestions("Take 1-1/2 tablets daily.", [{ ...mixedItems[0], source_quote: "Take 1-1/2 tablets daily." }], [{ ...wrong, options: ["1-1/2 tablets", "2 tablets", "1 tablet"], answer_quote: "Take 1-1/2 tablets daily" }]).dropped).toEqual([]);
  });

  it("drops a proof that is real but belongs to a different step", () => {
    const r = checkQuestions(paper.text, items, [{ ...good, answer_quote: "Call 911 if you have chest pain" }]);
    expect(r.dropped[0].reason).toBe("quote_outside_step");
  });

  it("drops unknown steps, duplicates and broken options", () => {
    const r = checkQuestions(paper.text, items, [
      { ...good, item_id: "item-9" },
      good,
      { ...good },
      { ...good, item_id: "item-1", options: ["A", "a", "B"], answer_quote: "Call 911" },
      { ...good, item_id: "item-1", options: ["A", "B"], answer_quote: "Call 911" },
      { ...good, item_id: "item-1", correct: 3, answer_quote: "Call 911" },
    ]);
    expect(r.questions).toHaveLength(1);
    expect(r.dropped.map((d) => d.reason)).toEqual(["unknown_step", "duplicate_step", "bad_options", "bad_options", "bad_options"]);
  });

  it("drops a step whose own quote is not in the paper", () => {
    const r = checkQuestions(paper.text, [{ ...items[0], source_quote: "Take insulin at night" }], [good]);
    expect(r.dropped[0].reason).toBe("unknown_step");
  });
});

describe("Codex round 10: a fraction's denominator is never a whole-number proof", () => {
  it("\"2 tablet daily\" is not proof inside \"Take 1/2 tablet daily\"", () => {
    const text = "MEDICINES\nTake 1/2 tablet daily.";
    const its = [{ id: "item-0", kind: "medication", title: "Half tablet", source_quote: "Take 1/2 tablet daily." }];
    const r = checkQuestions(text, its, [{ item_id: "item-0", question: "How much?", options: ["2 tablets daily", "1/2 tablet daily", "None"], correct: 0, answer_quote: "2 tablet daily" }]);
    expect(r.questions).toEqual([]);
    expect(r.dropped).toEqual([{ item_id: "item-0", reason: "quote_not_in_paper" }]);
  });
});
