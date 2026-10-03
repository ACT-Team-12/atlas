import { describe, expect, it } from "vitest";
import { cleanMinutes, SESSION_HEADINGS, sessionSummary, type HelperEntry, type SessionPlanState } from "./sessionSummary";
import { LANGUAGES, type VerifiedItem } from "./schema";
import type { PlanResponse } from "./plan";

// A paper with things that must never reach the summary: a name, a date of birth, an MRN, a street address and ZIP.
const PAPER = "Patient: Jane Q. Doe  DOB 03/14/1961  MRN 00482913\n1450 Peachtree Rd, Atlanta GA 30309\n" +
  "Return for basic metabolic panel within 2 weeks.\nFollow up with cardiology in 1 month.\nCall 911 for chest pain.";

const item = (o: Partial<VerifiedItem>): VerifiedItem => ({
  id: "c1", kind: "lab_test", title: "Blood test", plain_language: "Get your blood drawn.", why: "", when: "within 2 weeks",
  source_quote: "Return for basic metabolic panel within 2 weeks.", needs_clarification: false, question_for_clinic: "",
  grounded: true, span: { start: 0, end: 10 }, ...o,
});

const ITEMS = [
  item({}),
  item({ id: "c2", kind: "referral", title: "See a heart doctor", when: "in 1 month", source_quote: "Follow up with cardiology in 1 month." }),
  item({ id: "c3", kind: "warning_sign", title: "Chest pain", when: "", source_quote: "Call 911 for chest pain." }),
  item({ id: "c4", title: "Made up step", grounded: false, span: null, source_quote: "not in the paper" }),
];

const plan = (o: Partial<PlanResponse> = {}): PlanResponse => ({
  summary: "Get the blood test done this week.",
  steps: [
    { title: "Get a ride to the lab", action: "Call the clinic.", why: "", barrier: "transport", care_ids: ["c1"], resource_ids: ["mercy"], dropped_refs: [] },
    { title: "Ask about the sliding fee", action: "Ask at the desk.", why: "", barrier: "cost", care_ids: ["c1"], resource_ids: ["mcd"], dropped_refs: [] },
  ],
  resources: {
    mercy: { type: "clinic", id: "mercy", km: 2, clinic: { name: "Mercy Care", phone: "(678) 843-8500", address: "424 Decatur St SE", city: "Atlanta", zip: "30312" } } as PlanResponse["resources"][string],
    mcd: { type: "program", id: "mcd", program: { name: "Georgia Medicaid", access: { url: "https://gateway.ga.gov" } } } as PlanResponse["resources"][string],
    unused: { type: "clinic", id: "unused", km: 9, clinic: { name: "Not Used Clinic", phone: "(404) 000-0000", address: "1 Main", city: "Atlanta", zip: "30303" } } as PlanResponse["resources"][string],
  },
  ask_a_person: false, ask_a_person_reason: "", located: { by: "zip", label: "Near 30309" },
  stats: { candidates: 2, steps: 2, dropped_refs: 0, ms: 1 }, model: "x", ...o,
});

const state = (o: Partial<SessionPlanState> = {}): SessionPlanState => ({
  barriers: ["transport", "cost"], items: ITEMS, done: { c1: true }, plan: plan(), questions: ["Do I need to fast?"],
  language: "English", readingLevel: "simple", ...o,
});
const helper = (o: Partial<HelperEntry> = {}): HelperEntry => ({
  minutes: { explain: 10, barriers: 5, resources: 12, appointments: 8 }, notes: "", consentDiscussed: true, ...o,
});

/** Index of each heading line in the plain text. */
const headingLines = (text: string) => SESSION_HEADINGS.map((h) => text.split("\n").indexOf(h));

describe("helper session summary", () => {
  it("has every heading, exactly, in order, in both the structure and the text", () => {
    const s = sessionSummary(state(), helper());
    expect(s.sections.map((x) => x.heading)).toEqual([...SESSION_HEADINGS]);
    const at = headingLines(s.text);
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("adds up the minutes per activity", () => {
    const s = sessionSummary(state(), helper());
    expect(s.minutes).toEqual({ explain: 10, barriers: 5, resources: 12, appointments: 8 });
    expect(s.totalMinutes).toBe(35);
    expect(s.text).toContain("- Explaining the paper: 10 min");
    expect(s.text).toContain("- Total: 35 min");
  });

  it("counts blank, negative and non-number minutes as 0 and rounds typed text", () => {
    const s = sessionSummary(state(), helper({ minutes: { explain: "7", barriers: "", resources: -4, appointments: "abc" } }));
    expect(s.totalMinutes).toBe(7);
    expect(cleanMinutes("2.6")).toBe(3);
    expect(cleanMinutes(Number.NaN)).toBe(0);
    expect(cleanMinutes(99999)).toBe(600);
  });

  it("lists each grounded step with the person's own tick, and leaves out ungrounded ones", () => {
    const t = sessionSummary(state(), helper()).text;
    expect(t).toContain("- [x] done: Lab test: Blood test (within 2 weeks)");
    expect(t).toContain("- [ ] not done yet: Referral: See a heart doctor (in 1 month)");
    expect(t).toContain("- Warning sign: Chest pain");
    expect(t).not.toContain("Made up step");
    expect(t).toContain("  1. Get a ride to the lab");
  });

  it("gives only the resources the plan uses, with name and phone or link, and no address", () => {
    const t = sessionSummary(state(), helper()).text;
    expect(t).toContain("- Mercy Care: (678) 843-8500 (health center)");
    expect(t).toContain("- Georgia Medicaid: https://gateway.ga.gov (program)");
    expect(t).not.toContain("Not Used Clinic");
    expect(t).not.toContain("424 Decatur");
  });

  it("puts barriers, education, appointments and consent where they belong", () => {
    const s = sessionSummary(state(), helper({ consentDiscussed: false }));
    const sec = (h: string) => s.sections.find((x) => x.heading === h)!.lines.join("\n");
    expect(sec("Upstream drivers the person picked")).toContain("Getting there (no car, long bus ride)");
    expect(sec("Education topics in the plan")).toContain("3 steps from the paper, explained in plain words by ATLAS (English, simple reading level).");
    expect(sec("Education topics in the plan")).toContain("Warning signs on the paper: Chest pain.");
    expect(sec("Education topics in the plan")).toContain("  - Do I need to fast?");
    expect(sec("Appointments on the paper")).toContain("Blood test");
    expect(sec("Appointments on the paper")).toContain("See a heart doctor");
    expect(sec("Appointments on the paper")).not.toContain("Chest pain");
    expect(sec("Consent")).toBe("- Consent discussed: no");
    expect(sessionSummary(state(), helper()).text).toContain("- Consent discussed: yes");
  });

  it("never carries the paper text, the ZIP, the location or an identifier by default", () => {
    const t = sessionSummary(state(), helper()).text;
    for (const leak of ["Jane", "Doe", "03/14/1961", "MRN", "00482913", "Peachtree", "30309", "30312", "30303", "Near 30309"]) {
      expect(t).not.toContain(leak);
    }
    expect(t).not.toContain(PAPER);
    expect(t).not.toContain("Return for basic metabolic panel");
  });

  it("leaves out the paper's own words and masks ZIPs and long numbers in every field it exports", () => {
    const leaky = [
      item({ id: "z1", title: "Lab at 1450 Peachtree Rd 30309", when: "before visit, MRN 00482913", source_quote: "Patient Jane Q. Doe DOB 03/14/1961 return to 1450 Peachtree Rd, Atlanta GA 30309-1234" }),
      item({ id: "z2", kind: "warning_sign", title: "Chest pain near 30312", when: "", source_quote: "Jane Doe: call 911 for chest pain" }),
    ];
    const p = plan({
      steps: [{ title: "Ride from 30309", action: "", why: "", barrier: "transport", care_ids: ["z1"], resource_ids: [], dropped_refs: [] }],
      ask_a_person: true, ask_a_person_reason: "Nothing verified near 30309",
    });
    const t = sessionSummary(state({ items: leaky, plan: p, questions: ["Is account 123456789 paid?"] }), helper()).text;
    for (const leak of ["Jane", "Doe", "03/14/1961", "Peachtree Rd,", "30309", "30312", "00482913", "123456789"]) expect(t, leak).not.toContain(leak);
    expect(t).toContain("Lab at 1450 Peachtree Rd [number removed]");
  });

  it("says only what ATLAS showed, never that the helper did something the helper has not entered", () => {
    const s = sessionSummary(state(), { minutes: {}, notes: "", consentDiscussed: false });
    const claims = s.sections.filter((x) => x.heading !== "Consent").flatMap((x) => [x.heading, ...x.lines]).join("\n");
    expect(claims).not.toMatch(/\b(agreed|reviewed|given|went over|discussed|helped)\b/i);
    expect(s.text).toContain("does not say what the helper did");
  });

  it("works with nothing filled in", () => {
    const s = sessionSummary(
      { barriers: [], items: [], done: {}, plan: null, questions: [], language: "English", readingLevel: "simple" },
      { minutes: {}, notes: "   ", consentDiscussed: false },
    );
    expect(s.sections.map((x) => x.heading)).toEqual([...SESSION_HEADINGS]);
    expect(s.totalMinutes).toBe(0);
    expect(s.text).toContain("- None picked");
    expect(s.text).toContain("- No steps from the paper");
    expect(s.text).toContain("- None in the plan");
    expect(s.text).toContain("- No appointments on the paper");
    expect(s.text).toContain("- Total: 0 min");
    expect(s.sections.at(-1)!.lines).toEqual(["- None"]);
  });

  it("works with a partial session: barriers and notes, no paper, one minute field", () => {
    const s = sessionSummary(state({ items: [], plan: null, questions: [] }), helper({ minutes: { barriers: 15 }, notes: "Prefers calls after 5.\nWill bring meds list." }));
    expect(s.totalMinutes).toBe(15);
    expect(s.text).toContain("Paying for the visit, lab or medicine");
    expect(s.sections.at(-1)!.lines).toEqual(["Prefers calls after 5.", "Will bring meds list."]);
  });

  it("says when the plan needs a person", () => {
    const t = sessionSummary(state({ plan: plan({ ask_a_person: true, ask_a_person_reason: "No verified program for housing." }) }), helper()).text;
    expect(t).toContain("- Needs a person too: No verified program for housing. ATLAS suggested calling 211.");
  });

  it("never claims anything is billable", () => {
    const t = sessionSummary(state(), helper()).text;
    expect(t).not.toMatch(/billable|G0019|G0023|\bZ\d{2}/i);
  });

  // The app has no translation table for helper-facing text, so headings stay English in every language.
  it.each(LANGUAGES)("renders every heading when the plan is in %s", (language) => {
    const s = sessionSummary(state({ language }), helper());
    expect(headingLines(s.text).every((i) => i > 0)).toBe(true);
    expect(s.text).toContain(`(${language}, simple reading level)`);
  });
});
