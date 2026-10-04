import { describe, expect, it } from "vitest";
import { needsPersonLine, paidSpeechText, paidVoiceAllowed, PLAN_IS_A_SUGGESTION, speechLines } from "./speechText";

const steps = [{ title: "Get a ride", action: "Call the ride line.", why: "", barrier: "", care_ids: ["item-1"], resource_ids: [], dropped_refs: [] }];
const base = { summary: "Your plan.", steps } as unknown as Parameters<typeof speechLines>[0];
const REASON = "No verified program covers rent help in your ZIP.";
const LINE = `This needs a person too: ${REASON} Call 211 or a community health worker.`;

describe("needs-a-person in read-aloud", () => {
  it("is read last, in share's wording, when the plan flags it with a reason", () => {
    const plan = { ...base, ask_a_person: true, ask_a_person_reason: REASON };
    expect(speechLines(plan)).toEqual([PLAN_IS_A_SUGGESTION, "Your plan.", "1. Get a ride. Call the ride line.", LINE]);
    // part of the signed text, so the natural voice and the call still read it
    expect(paidSpeechText(plan).split("\n").at(-1)).toBe(LINE);
    expect(paidVoiceAllowed(plan, speechLines(plan))).toBe(true);
  });

  it("adds nothing without the flag, without a reason, or with a blank reason", () => {
    const plain = [PLAN_IS_A_SUGGESTION, "Your plan.", "1. Get a ride. Call the ride line."];
    expect(speechLines(base)).toEqual(plain);
    expect(speechLines({ ...base, ask_a_person: false, ask_a_person_reason: REASON })).toEqual(plain);
    expect(speechLines({ ...base, ask_a_person: true, ask_a_person_reason: "   " })).toEqual(plain);
    expect(needsPersonLine({ ask_a_person: true })).toEqual([]);
    expect(paidSpeechText({ ...base, ask_a_person: false, ask_a_person_reason: REASON })).toBe(plain.join("\n"));
  });

  it("a plan signed without the line no longer matches once the line is added (the page falls back to the free voice)", () => {
    const plan = { ...base, ask_a_person: true, ask_a_person_reason: REASON };
    expect(paidVoiceAllowed(plan, speechLines(base))).toBe(false);
  });
});
