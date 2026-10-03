import { describe, expect, it } from "vitest";
import { checkCoverage, classifySentence, splitSentences } from "./coverage";
import { findSpan } from "./verify";
import papersFile from "../data/eval/papers.json";

type Paper = { id: string; text: string; expected: string[]; distractors?: string[] };
const papers = (papersFile as { papers: Paper[] }).papers;

const quote = (source_quote: string) => ({ source_quote });

/** The whole source line that contains a quote, as a model item quoting its line would. */
function lineOf(text: string, q: string): string {
  const span = findSpan(text, q);
  if (!span) throw new Error(`expected quote not in paper: ${q}`);
  const start = text.lastIndexOf("\n", span.start - 1) + 1;
  const nl = text.indexOf("\n", span.end);
  return text.slice(start, nl < 0 ? text.length : nl).trim();
}

/** A full plan: one item per expected step, quoting the whole line the step is on. */
function fullPlan(p: Paper): string[] {
  return [...new Set(p.expected.map((q) => lineOf(p.text, q)))];
}

describe("splitSentences", () => {
  it("returns offsets into the original text", () => {
    const src = "Medicines\nTake 1 tablet daily. Stop ibuprofen.\n\nCall 911 if you cannot breathe.";
    const s = splitSentences(src);
    expect(s.map((x) => x.text)).toEqual(["Medicines", "Take 1 tablet daily.", "Stop ibuprofen.", "Call 911 if you cannot breathe."]);
    for (const x of s) expect(src.slice(x.start, x.end)).toBe(x.text);
  });

  it("keeps decimals, abbreviations and lower-case continuations inside one sentence", () => {
    const s = splitSentences("Take 0.5 mg at night. See Dr. Lee in 2 weeks. Rest, e.g. no lifting. Call us.");
    expect(s.map((x) => x.text)).toEqual(["Take 0.5 mg at night.", "See Dr. Lee in 2 weeks.", "Rest, e.g. no lifting.", "Call us."]);
  });

  it("joins a wrapped line and handles CRLF, CR and Unicode line separators", () => {
    const src = "Call the office if your\r\n  blood sugar is above 300.\rDrink water.\u2028Rest.";
    const s = splitSentences(src);
    expect(s.map((x) => x.text)).toEqual(["Call the office if your\r\n  blood sugar is above 300.", "Drink water.", "Rest."]);
    for (const x of s) expect(src.slice(x.start, x.end)).toBe(x.text);
  });

  it("keeps UTF-16 offsets right after astral characters, accents and non-breaking spaces", () => {
    const src = "💊 Notes 🩺\nTómela con comida.\u00a0Take 2 tablets\u00a0daily.";
    const s = splitSentences(src);
    expect(s.map((x) => x.text)).toEqual(["💊 Notes 🩺", "Tómela con comida.", "Take 2 tablets\u00a0daily."]);
    for (const x of s) expect(src.slice(x.start, x.end)).toBe(x.text);
  });
});

describe("classifySentence", () => {
  it.each([
    "Take 1 tablet by mouth 2 times a day with meals.",
    "STOP ibuprofen 200 mg tablet.",
    "Don’t drive for 24 hours.",
    "Please call 404-555-0177 to schedule.",
    "New medicine: amlodipine 5 mg, take 1 tablet every morning.",
    "Follow up with your doctor in 2 weeks.",
    "Return for a follow-up visit, the reason for visit being your blood pressure.",
    "Your appointment is on Tuesday.",
    "Refill your inhaler before it runs out.",
    "Come back or go to the ER if you get a fever over 101 F.",
    "If you have chest pain, call 911.",
    "If your child has a rash, return to the clinic.",
    "Albuterol: 2 puffs every 4 hours.",
    "Hemoglobin A1c - due in 3 months",
    "Drink fluids",
  ])("counts %s as an instruction", (t) => {
    expect(classifySentence(t)).not.toBeNull();
  });

  it.each([
    // Headers.
    "AFTER VISIT SUMMARY",
    "Medication changes",
    "Follow-up",
    "FOLLOW-UP APPOINTMENTS",
    "When to seek care:",
    "Every day",
    // Signatures.
    "Electronically signed by Dr. Jane Smith, MD on 10/01/2026",
    "Attending: Dr. Ana Ruiz",
    "Sincerely, Midtown Family Medicine",
    // Phone-only lines.
    "Phone: 404-555-0177",
    "Clinic phone (404) 555-0100 | Fax 404.555.0101",
    "After hours line: +1 404 555 0199 ext 12",
    // Boilerplate and staff-only lines.
    "Page 1 of 2",
    "Printed on 10/01/2026 by front desk",
    "This summary is not a substitute for medical advice.",
    "If you have questions, please call our office.",
    "Thank you for choosing Midtown Family Medicine.",
    "Provider note (not for patient action): consider statin at next visit if LDL remains high.",
    "Billing code: 99214",
    // Facts, not actions.
    "Today you received the Tdap vaccine.",
    "You were treated for heart failure.",
    "ED attending reviewed chest x-ray: no pneumonia.",
    "Weeks pregnant: 28",
    "Diagnosis: urinary tract infection",
    // The sample paper's visit-reason label: "follow-up" here names why they came, not a next step.
    "Reason for visit: Follow-up for high blood sugar and blood pressure.",
    "Chief complaint: follow-up appointment for cough",
    // Known misses, documented in docs/coverage-check.md: no signal word, so not counted.
    "Your sugar should stay under 180.",
    "Labs will be drawn next week.",
  ])("does not count %s", (t) => {
    expect(classifySentence(t)).toBeNull();
  });

  it.each([
    "If you have questions or chest pain, call 911.",
    "If you have any questions, call us; do not stop taking metformin.",
    "Confidential: take 2 tablets of furosemide 40 mg every morning.",
    "Check MyChart, and go to the emergency room if your leg swells.",
  ])("a boilerplate phrase does not hide a real instruction: %s", (t) => {
    expect(classifySentence(t)).not.toBeNull();
  });

  it("applies the Spanish lexicon only when asked", () => {
    const es = ["Tome 1 tableta 2 veces al día.", "Llame al 911 si tiene dolor de pecho.", "No tome ibuprofeno.", "Su cita de seguimiento es en 2 semanas."];
    for (const t of es) expect(classifySentence(t, { languages: ["en", "es"] })).not.toBeNull();
    expect(classifySentence("Llame a la clínica mañana.", { languages: ["en"] })).toBeNull();
    expect(classifySentence("No hay neumonía.", { languages: ["en", "es"] })).toBeNull();
    expect(classifySentence("Teléfono: (404) 555-0100", { languages: ["en", "es"] })).toBeNull();
  });
});

describe("checkCoverage on the sample papers", () => {
  it.each(papers.map((p) => [p.id, p] as const))("%s: a full plan covers every instruction sentence", (_id, p) => {
    const r = checkCoverage(p.text, fullPlan(p).map(quote));
    expect(r.uncovered).toEqual([]);
    expect(r.covered).toBe(r.total);
    expect(r.total).toBeGreaterThanOrEqual(p.expected.length);
  });

  it.each(papers.map((p) => [p.id, p] as const))("%s: every expected step sits in an instruction sentence", (_id, p) => {
    const sentences = splitSentences(p.text);
    for (const q of p.expected) {
      const span = findSpan(p.text, q)!;
      const hit = sentences.filter((s) => s.start < span.end && span.start < s.end);
      expect(hit.some((s) => classifySentence(s.text) !== null), q).toBe(true);
    }
  });

  it.each(papers.filter((p) => p.distractors?.length).map((p) => [p.id, p] as const))(
    "%s: distractor lines are not counted as instructions",
    (_id, p) => {
      const sentences = splitSentences(p.text);
      for (const d of p.distractors!) {
        const span = findSpan(p.text, d)!;
        const hit = sentences.filter((s) => s.start < span.end && span.start < s.end);
        expect(hit.length).toBeGreaterThan(0);
        for (const s of hit) expect(classifySentence(s.text), s.text).toBeNull();
      }
    },
  );

  it("dropping one item surfaces exactly that line's instruction sentences", () => {
    let checked = 0;
    for (const p of papers) {
      const plan = fullPlan(p);
      for (let i = 0; i < plan.length; i++) {
        const dropped = plan[i];
        const span = findSpan(p.text, dropped)!;
        const want = splitSentences(p.text)
          .filter((s) => s.start >= span.start && s.end <= span.end && classifySentence(s.text) !== null)
          .map((s) => s.text);
        const r = checkCoverage(p.text, plan.filter((_, j) => j !== i).map(quote));
        expect(want.length, dropped).toBeGreaterThan(0);
        expect(r.uncovered.map((u) => u.text), dropped).toEqual(want);
        for (const u of r.uncovered) expect(p.text.slice(u.start, u.end)).toBe(u.text);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it("finds real follow-on instructions that the eval's narrower expected quotes leave out", () => {
    // The expected quotes in papers.json name one clause per line. A plan that quotes ONLY those clauses
    // misses the other instruction on the same line. These are genuine omissions (one is "STOP ibuprofen"),
    // and the check names each one.
    const missed = papers.flatMap((p) => checkCoverage(p.text, p.expected.map(quote)).uncovered.map((u) => u.text));
    expect(missed).toEqual([
      "START metformin 500 mg tablet.",
      "CHANGE lisinopril 10 mg tablet.",
      "STOP ibuprofen 200 mg tablet.",
      "Their office will call you to schedule.",
      "Start tomorrow morning.",
      "Bring the log to your next visit.",
      "Please call 404-555-0177 to schedule.",
      "Finish all of it even if you feel better.",
      "The clinic will call you with the time.",
    ]);
  });
});

describe("checkCoverage details", () => {
  const src = "Take 1 tablet daily.\nCall 911 if you cannot breathe.\nCall 911 if you cannot breathe.";

  it("uses a span already found by the verifier instead of searching again", () => {
    const r = checkCoverage(src, [{ source_quote: "not in the paper at all", span: { start: 0, end: 4 } }]);
    expect(r.uncovered.map((u) => u.text)).toEqual(["Call 911 if you cannot breathe.", "Call 911 if you cannot breathe."]);
  });

  it("ignores an item whose quote cannot be found", () => {
    const r = checkCoverage(src, [quote("Take 5 tablets hourly")]);
    expect(r.covered).toBe(0);
    expect(r.total).toBe(3);
  });

  it("counts a word-for-word repeat of a covered sentence as covered", () => {
    const r = checkCoverage(src, [quote("Take 1 tablet daily."), quote("Call 911 if you cannot breathe.")]);
    expect(r).toEqual({ total: 3, covered: 3, uncovered: [] });
  });

  it("reports the rule that fired", () => {
    const r = checkCoverage("Next visit: 4 weeks.\nIf you have a fever over 101, the clinic says call.\nAmoxicillin 500 mg.", []);
    expect(r.uncovered.map((u) => u.reason)).toEqual(["phrase", "conditional", "dose_or_timing"]);
  });

  it("returns an empty report for empty or instruction-free text", () => {
    expect(checkCoverage("", [])).toEqual({ total: 0, covered: 0, uncovered: [] });
    expect(checkCoverage("AFTER VISIT SUMMARY\n\nPage 1 of 1", [])).toEqual({ total: 0, covered: 0, uncovered: [] });
  });
});

describe("checkCoverage speed", () => {
  it("handles a 20k-character paper in under 50 ms", () => {
    let big = "";
    const items: string[] = [];
    while (big.length < 20_000) {
      for (const p of papers) {
        big += p.text + "\n\n";
        if (items.length < 40) items.push(...fullPlan(p).slice(0, 40 - items.length));
      }
    }
    big = big.slice(0, 20_000);
    // Kept items arrive from verifyItems with their span already found, so time the check itself.
    const kept = items.map((q) => ({ source_quote: q, span: findSpan(big, q) }));
    expect(kept.every((k) => k.span !== null)).toBe(true);
    checkCoverage(big, kept); // warm up the JIT
    const t0 = performance.now();
    const r = checkCoverage(big, kept);
    const ms = performance.now() - t0;
    expect(r.total).toBeGreaterThan(100);
    expect(ms).toBeLessThan(50);
  });

  it("stays linear on a single 20k-character line with no punctuation", () => {
    const line = "if you have ".repeat(1_700).slice(0, 20_000);
    checkCoverage(line, []);
    const t0 = performance.now();
    checkCoverage(line, []);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
