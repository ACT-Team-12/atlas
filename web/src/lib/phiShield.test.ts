import { describe, expect, test } from "vitest";
import { PhiShield, TOKEN_RE, hasToken, rangeToOriginal, shield, stripTokens, toOriginal, tokensIn, unshieldDeep, unshieldString } from "./phiShield";

/** Every placeholder's original words, so a case can say what was hidden. */
const hidden = (text: string) => [...shield(text).tokens.values()];
const redacted = (text: string) => shield(text).text;

describe("what is hidden", () => {
  const HEADER = `AFTER VISIT SUMMARY
Patient: Maria Lopez   DOB: 04/12/1961   MRN: 88412907
Phone: (404) 555-0182
Address: 1427 Pine St NW, Atlanta, GA 30318
Email: maria.lopez@example.com
Grady Primary Care   Dr. Lee
Visit: 10/01/2026

Maria, take metformin 500 mg twice a day. Ms. Lopez should call 404-555-0134 to schedule.
Follow up on Oct 14. Nothing to eat after midnight before 10/09/2026.`;

  test.each([
    ["patient name after Patient:", "Maria Lopez"],
    ["DOB after DOB:", "04/12/1961"],
    ["MRN", "88412907"],
    ["patient phone in the header lines", "(404) 555-0182"],
    ["patient address in the header lines", "1427 Pine St NW, Atlanta, GA 30318"],
    ["patient email in the header lines", "maria.lopez@example.com"],
    ["first name alone in a sentence", "Maria"],
    ["Ms. + surname", "Lopez"],
  ])("%s", (_, value) => {
    expect(hidden(HEADER)).toContain(value);
    expect(redacted(HEADER)).not.toContain(value);
  });

  test.each([
    ["the visit date", "Visit: 10/01/2026"],
    ["a follow-up date", "Follow up on Oct 14"],
    ["a test date", "before 10/09/2026"],
    ["the clinic name", "Grady Primary Care"],
    ["the doctor's name", "Dr. Lee"],
    ["an unlabeled referral phone", "call 404-555-0134 to schedule"],
    ["the medicine and dose", "take metformin 500 mg twice a day"],
  ])("keeps %s", (_, words) => {
    expect(redacted(HEADER)).toContain(words);
  });

  test("other label styles", () => {
    const t = `Name: Lopez, Maria  |  Date of Birth: April 12, 1961  |  Acct #: 55120934
Member ID: XJH448219077
Home phone: 404-555-0119
SSN: 123-45-6789`;
    expect(hidden(t)).toEqual(expect.arrayContaining(["Lopez, Maria", "April 12, 1961", "55120934", "XJH448219077", "404-555-0119", "123-45-6789"]));
  });

  test("a header table: labels on one line, values under them", () => {
    const t = "Name            DOB          MRN\nTerrence Hill   07/30/1955   00417733\n\nTerrence should weigh himself every morning.";
    expect(hidden(t)).toEqual(expect.arrayContaining(["Terrence Hill", "07/30/1955", "00417733", "Terrence"]));
  });

  test("an age over 89 is hidden; a younger age is not", () => {
    expect(hidden("Age: 92")).toEqual(["92"]);
    expect(hidden("She is a 93-year-old woman.")).toEqual(["93"]);
    expect(hidden("Age 7. A 45-year-old man. Age: 89")).toEqual([]);
  });

  test("the SSN shape is hidden anywhere; a phone shape is not", () => {
    expect(hidden("Card on file 123-45-6789.")).toEqual(["123-45-6789"]);
    expect(hidden("Call 404-555-0134.")).toEqual([]);
  });

  test("an id the header gave is hidden where it repeats, a different number is kept", () => {
    const t = "MRN: 88412907\n\nPage 2 of 2   88412907\nLot 55501234";
    expect(redacted(t)).not.toContain("88412907");
    expect(redacted(t)).toContain("Lot 55501234");
  });
});

describe("rule 3: a date is hidden only when labeled as a birth date", () => {
  test.each([
    ["DOB: 04/12/1961", "04/12/1961"],
    ["D.O.B. 1961-04-12", "1961-04-12"],
    ["Date of birth: 12 Apr 1961", "12 Apr 1961"],
    ["Born 4/12/61", "4/12/61"],
    ["Birthdate: April 12, 1961", "April 12, 1961"],
  ])("hidden: %s", (t, v) => expect(hidden(t)).toEqual([v]));

  test.each([
    "Visit: 10/01/2026",
    "Follow up on 04/12/2027.",
    "Discharged 10/01/2026",
    "Lab work on April 12, 2026 at 8 am.",
    "Date: 10/01/2026",
    "Your first-born child should get the flu shot on 10/14/2026.",
  ])("kept: %s", (t) => expect(hidden(t)).toEqual([]));
});

describe("rule: a phone, email or address is hidden only when it is the patient's", () => {
  test("labels that say the patient's", () => {
    expect(hidden("Home phone: 404-555-0119")).toEqual(["404-555-0119"]);
    expect(hidden("Cell: (470) 555-0101")).toEqual(["(470) 555-0101"]);
    expect(hidden("Patient address: 12 Elm St, Decatur GA 30030")).toEqual(["12 Elm St, Decatur GA 30030"]);
  });

  test("a plain Phone: right under the patient's line is the patient's", () => {
    expect(hidden("Patient: Ana Ruiz\nPhone: 404-555-0119")).toContain("404-555-0119");
  });

  test.each([
    ["clinic phone label", "Patient: Ana Ruiz\nClinic phone: 404-616-1234"],
    ["office phone label", "Patient: Ana Ruiz   Office Phone: 404-616-1234"],
    ["plain Phone: under the clinic's line", "Patient: Ana Ruiz\nGrady Primary Care\nPhone: 404-616-1234"],
    ["plain Phone: with no patient line", "Phone: 404-616-1234"],
    ["unlabeled phone in a sentence", "Patient: Ana Ruiz\n\nIf you have questions, call 404-616-1234."],
    ["after-hours line", "Patient: Ana Ruiz\nAfter hours phone: 404-616-9999"],
  ])("kept: %s", (_, t) => {
    expect(redacted(t)).toContain("404-616-");
  });

  test("a clinic email in the body and a clinic address are kept", () => {
    const t = "Patient: Ana Ruiz\n\nGrady Primary Care\nAddress: 80 Jesse Hill Jr Dr SE\nQuestions? Email nurse@gradyhealth.org";
    expect(redacted(t)).toContain("80 Jesse Hill Jr Dr SE");
    expect(redacted(t)).toContain("nurse@gradyhealth.org");
  });
});

describe("care words that look like names stay", () => {
  test("a patient called May Lee: 'may', 'May 5', Dr. Lee and the Lee Family Clinic stay", () => {
    const t = "Patient: May Lee\n\nYou may take Tylenol. Come back May 5 to see Dr. Lee at the Lee Family Clinic. Ms. Lee, bring your log.";
    const r = redacted(t);
    expect(r).toContain("You may take Tylenol");
    expect(r).toContain("May 5");
    expect(r).toContain("Dr. Lee");
    expect(r).toContain("Lee Family Clinic");
    expect(r).not.toContain("Ms. Lee");
  });

  test("a doctor with the patient's surname, written with a credential, stays", () => {
    const r = redacted("Patient: Ana Lee\n\nAna, see Sam Lee, MD in 2 weeks.");
    expect(r).toContain("Sam Lee, MD");
    expect(r).not.toContain("Ana,");
  });

  test("medicines, doses and tests are never touched", () => {
    const t = "Patient: Tyler Brooks\nDOB: 01/02/1950\n\nSTART metformin (GLUCOPHAGE) 500 mg. Take Lisinopril 20 mg daily. Hemoglobin A1c in 3 months. Avoid NSAIDs.";
    const r = redacted(t);
    for (const w of ["metformin (GLUCOPHAGE) 500 mg", "Lisinopril 20 mg", "Hemoglobin A1c in 3 months", "Avoid NSAIDs"]) expect(r).toContain(w);
  });

  test("label words inside sentences are not fields", () => {
    for (const t of [
      "Write your name: on the log sheet.",
      "Patient instructions\nTake your medicine.",
      "Instructions for the patient: take 1 tablet daily.",
      "Provider: Sample Provider, MD",
      "Provider name: Dr. Anna Lee",
      "Bring your photo ID 2 times a year.",
    ]) expect(hidden(t)).toEqual([]);
  });
});

describe("placeholders", () => {
  test("stable: the same words get the same placeholder; letters, never digits", () => {
    const r = shield("Patient: Maria Lopez\n\nMaria Lopez, call us. Maria Lopez, rest.");
    const tokens = tokensIn(r.text);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^⟦NAME_[A-Z]+⟧$/);
    expect(r.text).not.toMatch(/⟦[^⟧]*\d[^⟧]*⟧/);
  });

  test("a session hides what one text taught it in another text", () => {
    const s = new PhiShield();
    s.learn("Patient: Maria Lopez");
    expect(s.shield("Maria, take your pills.").text).toBe(`${[...s.tokens.keys()].find((k) => s.tokens.get(k) === "Maria")}, take your pills.`);
  });

  test("placeholders already in a text are kept and never reused", () => {
    const s = new PhiShield();
    const r = s.shield("Patient: ⟦NAME_A⟧\nMRN: ⟦MRN_A⟧\nDOB: 04/12/1961");
    expect(r.text).toContain("Patient: ⟦NAME_A⟧");
    expect(r.text).toContain("MRN: ⟦MRN_A⟧");
    expect(r.tokens.has("⟦DOB_A⟧")).toBe(true);
    const again = s.shield("Name: Ana Ruiz");
    expect(again.text).toBe("Name: ⟦NAME_B⟧"); // A was taken by the incoming text
    expect(unshieldString(r.text, s.tokens)).toBe("Patient: ⟦NAME_A⟧\nMRN: ⟦MRN_A⟧\nDOB: 04/12/1961");
  });

  test("unshieldDeep copies, never mutates", () => {
    const tokens = new Map([["⟦NAME_A⟧", "Maria"]]);
    const v = { a: ["⟦NAME_A⟧ x"], b: { c: "⟦NAME_A⟧" }, n: 3 };
    const out = unshieldDeep(v, tokens);
    expect(out).toEqual({ a: ["Maria x"], b: { c: "Maria" }, n: 3 });
    expect(v.b.c).toBe("⟦NAME_A⟧");
  });
});

describe("stripTokens (plan, voice and call text)", () => {
  test.each([
    ["⟦NAME_A⟧, take your medicine.", "Take your medicine."],
    ["Call the clinic, ⟦NAME_A⟧.", "Call the clinic."],
    ["Bring your card (⟦ID_A⟧) to the lab.", "Bring your card to the lab."],
    ["Hello NAME_B, see you soon.", "Hello, see you soon."],
    ["A stray ⟦ bracket ⟧ here", "A stray here"],
  ])("%s", (a, b) => {
    expect(stripTokens(a)).toBe(b);
    expect(hasToken(stripTokens(a))).toBe(false);
  });

  test("text without a placeholder is returned as the same string", () => {
    const s = "1. Get to the lab. Take the 12 bus (MARTA).";
    expect(stripTokens(s)).toBe(s);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Round trip and offsets over random papers.                                                 */
/* ------------------------------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const FIRST = ["Maria", "James", "Ana", "Terrence", "Linh", "Grace", "Omar", "Dolores", "Tyler", "Mei"];
const LAST = ["Lopez", "Carter", "Ruiz", "Hill", "Nguyen", "Okafor", "Smith", "Kim", "Brooks", "Haile"];
const BODY = [
  "Take 1 tablet by mouth 2 times a day with meals.",
  "Call 911 if you have chest pain.",
  "Hemoglobin A1c - due in 3 months.",
  "Referral to Ophthalmology. Their office will call you. If not, call 404-555-0134.",
  "Next visit: 10/14/2026 with Dr. Lee at Grady Primary Care.",
  "Weigh yourself every morning.",
  "Do not eat or drink after midnight.",
  "Ñandú café, naïve – “quoted” words… 😀 emoji stay.",
];

function randomPaper(r: () => number): string {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const first = pick(FIRST), last = pick(LAST);
  const id = String(10000000 + Math.floor(r() * 89999999));
  const headers = [
    `Patient: ${first} ${last}   DOB: 0${1 + Math.floor(r() * 8)}/1${Math.floor(r() * 9)}/19${40 + Math.floor(r() * 50)}   MRN: ${id}`,
    `Name: ${last}, ${first}\nDate of Birth: March ${1 + Math.floor(r() * 27)}, 1958\nHome phone: 404-555-0${100 + Math.floor(r() * 899)}\nMember ID: XJH${id}`,
    `Name            DOB          MRN\n${first} ${last}   07/30/1955   ${id}`,
    `PATIENT NAME: ${first.toUpperCase()} ${last.toUpperCase()}\nSSN: 123-45-${1000 + Math.floor(r() * 8999)}\nEmail: ${first.toLowerCase()}@example.com`,
  ];
  const lines = [pick(headers), ""];
  const n = 2 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const b = pick(BODY);
    const roll = r();
    lines.push(roll < 0.25 ? `${first}, ${b[0].toLowerCase()}${b.slice(1)}` : roll < 0.4 ? `Ms. ${last}: ${b}` : b);
  }
  return lines.join(r() < 0.5 ? "\n" : "\r\n");
}

describe("round trip and offset map, 300 random papers", () => {
  const r = rng(20261003);
  const papers = Array.from({ length: 300 }, () => randomPaper(r));

  test("unshield(shield(paper)) is the paper, and something was always hidden", () => {
    for (const p of papers) {
      const s = shield(p);
      expect(unshieldString(s.text, s.tokens)).toBe(p);
      expect(s.offsetMap.length).toBeGreaterThan(0);
    }
  });

  test("every character outside a placeholder maps to the same character in the original", () => {
    for (const p of papers) {
      const s = shield(p);
      const inToken = new Array(s.text.length).fill(false);
      for (const seg of s.offsetMap) for (let k = seg.rStart; k < seg.rEnd; k++) inToken[k] = true;
      for (let k = 0; k < s.text.length; k++) {
        if (inToken[k]) continue;
        expect(p[toOriginal(s.offsetMap, k, "start")]).toBe(s.text[k]);
      }
      expect(toOriginal(s.offsetMap, s.text.length, "end")).toBe(p.length);
    }
  });

  test("any range maps to the original words of that range, a cut placeholder widening to its whole value", () => {
    const rr = rng(7);
    for (const p of papers) {
      const s = shield(p);
      for (let t = 0; t < 20; t++) {
        let a = Math.floor(rr() * s.text.length), b = Math.floor(rr() * s.text.length);
        if (a > b) [a, b] = [b, a];
        const m = rangeToOriginal(s.offsetMap, { start: a, end: b });
        // Widen [a, b) in the redacted text to whole placeholders, then the slices must agree.
        let wa = a, wb = b;
        for (const seg of s.offsetMap) {
          if (wa > seg.rStart && wa < seg.rEnd) wa = seg.rStart;
          if (wb > seg.rStart && wb < seg.rEnd) wb = seg.rEnd;
        }
        expect(p.slice(m.start, m.end)).toBe(unshieldString(s.text.slice(wa, wb), s.tokens));
      }
    }
  });

  test("no digit is ever added: placeholders carry letters only", () => {
    for (const p of papers) {
      for (const t of tokensIn(shield(p).text)) expect(t).toMatch(new RegExp(`^${TOKEN_RE.source}$`));
    }
  });
});
