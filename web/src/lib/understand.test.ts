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
