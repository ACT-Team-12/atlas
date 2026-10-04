import { describe, expect, it, test } from "vitest";
import { PhiShield, TOKEN_RE, hasToken, shield, stripTokens, unshieldString, type ShieldResult } from "./phiShield";
import { readText } from "./phiRead";
import { shieldText } from "./phiResponses";
import { plantedPapers } from "./phiPlanted";

/**
 * Inputs written to slip past a text shield, and the differential check between the browser's shield and the
 * server's guard. Every case asserts the identifier is hidden IN FULL: every raw character of it sits inside a hidden
 * stretch, and no letter or digit run of it is left in the redacted text.
 */

/** Every raw character of `value` (first occurrence at or after `from`) is inside a hidden stretch. */
function coveredInFull(paper: string, r: ShieldResult, value: string, from = 0): boolean {
  const at = paper.indexOf(value, from);
  if (at < 0) throw new Error(`value not in paper: ${JSON.stringify(value)}`);
  for (let i = at; i < at + value.length; i++) if (!r.offsetMap.some((s) => s.start <= i && i < s.end)) return false;
  return true;
}

/** Letter and digit runs of `value` (as read), none of which may be left in the redacted text (as read). */
function leftovers(r: ShieldResult, value: string): string[] {
  const rest = readText(r.text.replace(new RegExp(TOKEN_RE.source, "g"), " ")).text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return (readText(value).text.match(/[\p{L}\p{N}]{2,}/gu) ?? []).map((p) => p.toLowerCase()).filter((p) => rest.includes(p));
}

describe("bypass inputs: each identifier is hidden in full", () => {
  // [paper, values that must each be hidden in full]
  const CASES: [string, string[]][] = [
    // Zero-width and invisible characters inside names and ids.
    ["Patient: Ma​ria Lo⁠pez\n\nMa‍ria, take one pill.", ["Ma​ria Lo⁠pez", "Ma‍ria"]],
    ["MRN: 884​129­07\n\nCall about 88412907.", ["884​129­07", "88412907"]],
    // Lookalike letters: Cyrillic a in the label value, Latin in the body (and the other way round).
    ["Patient: Mаria Lopez\n\nMaria, take one pill.", ["Mаria Lopez", "Maria"]],
    ["Patient: Maria Lopez\n\nMаria, take one pill. Ms. Lоpez called.", ["Maria Lopez", "Mаria", "Lоpez"]],
    // Fullwidth digits and letters, fullwidth colon.
    ["MRN: ８８４１２９０７\n\nCall about 88412907.", ["８８４１２９０７", "88412907"]],
    ["Patient：Ｍａｒｉａ Lopez", ["Ｍａｒｉａ Lopez"]],
    // Non-breaking and other spaces, tabs.
    ["Patient: Maria Lopez DOB: 01/01/1970", ["Maria Lopez", "01/01/1970"]],
    ["Patient:\tMaria Lopez\tDOB:\t01/01/1970\tMRN:\t88412907", ["Maria Lopez", "01/01/1970", "88412907"]],
    // The value on the next line, and a label broken across two lines.
    ["Patient Name:\nMaria Lopez\nPhone: 404-555-0182", ["Maria Lopez", "404-555-0182"]],
    ["DOB:\n01/01/1970", ["01/01/1970"]],
    ["MRN\n  88412907", ["88412907"]],
    ["Date of\nBirth: 01/01/1970", ["01/01/1970"]],
    ["Medical Record\nNumber: A1209938", ["A1209938"]],
    ["Patient\nName: Maria Lopez", ["Maria Lopez"]],
    // Quotes, brackets and punctuation right next to the value.
    ["Patient: \"Maria Lopez\"", ["Maria Lopez"]],
    ["Patient: “Maria Lopez”", ["Maria Lopez"]],
    ["MRN: (88412907)", ["88412907"]],
    ["DOB: '01/01/1970'", ["01/01/1970"]],
    ["MRN:88412907; DOB:01/01/1970", ["88412907", "01/01/1970"]],
    // Mixed-case and dashed labels.
    ["PATIENT NAME: MARIA LOPEZ", ["MARIA LOPEZ"]],
    ["Pt: Maria Lopez", ["Maria Lopez"]],
    ["Patient Name - Maria Lopez", ["Maria Lopez"]],
    ["Patient Name – Maria Lopez", ["Maria Lopez"]],
    ["Patient Name — Maria Lopez", ["Maria Lopez"]],
    ["Name of patient: Maria Lopez", ["Maria Lopez"]],
    ["Last Name: Lopez   First Name: Maria", ["Lopez", "Maria"]],
    // Names: ALL CAPS, middle initials, hyphen and apostrophe, accents, long names.
    ["PATIENT: MARY-KATE O'NEIL\n\nMary-Kate, rest today. Ms. O'Neil can call.", ["MARY-KATE O'NEIL", "Mary-Kate", "O'Neil"]],
    ["Patient: Maria J. Lopez\n\nMaria J. Lopez should rest.", ["Maria J. Lopez"]],
    ["Patient: José López\n\nJosé, rest today.", ["José López", "José"]],
    ["Patient: Maria del Carmen de la Cruz Garcia", ["Maria del Carmen de la Cruz Garcia"]],
    // Birth dates in every common shape.
    ["DOB: 1970-01-01", ["1970-01-01"]],
    ["DOB: Jan 1 1970", ["Jan 1 1970"]],
    ["DOB: 1 Jan 1970", ["1 Jan 1970"]],
    ["DOB: 1-Jan-1970", ["1-Jan-1970"]],
    ["DOB: Jan-01-1970", ["Jan-01-1970"]],
    ["DOB: 01 / 01 / 1970", ["01 / 01 / 1970"]],
    ["DOB: 1970/01/01", ["1970/01/01"]],
    ["DOB: 19700101", ["19700101"]],
    ["DOB: 01–01–1970", ["01–01–1970"]],
    // Record numbers with letters, dashes, dots and slashes.
    ["MRN: AB-12-34-56", ["AB-12-34-56"]],
    ["MRN: ABC.123.456", ["ABC.123.456"]],
    ["MRN: 12-34-5678", ["12-34-5678"]],
    ["Member ID: XJH/4421/9087", ["XJH/4421/9087"]],
    ["Insurance ID: GA‐0098‐1123", ["GA‐0098‐1123"]],
    // Placeholder brackets inside an identifier: the identifier is hidden whole, brackets and all.
    ["MRN: 1234⟦ID_A⟧5678\n\nCall about 1234⟦ID_A⟧5678.", ["1234⟦ID_A⟧5678"]],
    ["Patient: Mar⟦NAME_A⟧ia Lopez", ["Mar⟦NAME_A⟧ia Lopez"]],
    ["Patient: Maria⟦ Lopez", ["Maria⟦ Lopez"]],
    ["SSN: 123-45-⟦SSN_A⟧6789", ["123-45-⟦SSN_A⟧6789"]],
    // Identifiers INSIDE fake brackets: only an exact placeholder is skipped, anything else in brackets is read.
    ["Patient: ⟦John Smith⟧\nPhone: ⟦404-555-0182⟧\nDOB: ⟦01/01/1970⟧\n\nJohn, rest.", ["John Smith", "404-555-0182", "01/01/1970", "John"]],
    ["Patient: Maria Lopez\n\nCall ⟦Maria Lopez 404-555-0182⟧ today.", ["Maria Lopez", "Maria Lopez"]],
    ["MRN: ⟦NAME_A 88412907⟧", ["88412907"]],
    // A placeholder at the value position never makes the real value after it count as already hidden.
    ["Patient:\n⟦NAME_A⟧ Maria Lopez", ["Maria Lopez"]],
    ["Name   DOB   MRN ⟦ID_A⟧\nMaria Lopez   01/01/1970   88412907", ["Maria Lopez", "01/01/1970", "88412907"]],
    ["Patient: ⟦NAME_A⟧   DOB: ⟦DOB_A⟧\nName   DOB   MRN\nMaria Lopez   01/01/1970   88412907", ["Maria Lopez", "01/01/1970", "88412907"]],
  ];
  test.each(CASES)("%j", (paper, values) => {
    const r = shield(paper);
    let from = 0;
    for (const v of values) {
      expect(coveredInFull(paper, r, v, from), `${JSON.stringify(v)} hidden in full in ${JSON.stringify(r.text)}`).toBe(true);
      from = paper.indexOf(v, from) + v.length;
      expect(leftovers(r, v), JSON.stringify(r.text)).toEqual([]);
    }
  });

  it("the same identifier written with an invisible character or a lookalike gets the same placeholder", () => {
    const r = shield("Patient: Maria Lopez\n\nMaria, rest. Ma​ria, rest. Mаria, call.");
    expect(r.offsetMap).toHaveLength(4);
    expect(new Set(r.offsetMap.slice(1).map((s) => s.token)).size).toBe(1);
  });

  it("care words, clinic and doctor stay (the reading does not widen what is hidden)", () => {
    const paper = "Patient: Maria Lopez   DOB: 01/01/1970\nGrady Primary Care  Dr. Lee  Clinic phone: 404-616-1234\nVisit:\t10/14/2026\n\nTake Lisinopril 10 mg every morning. Call 404–616–1234 with questions.";
    const r = shield(paper);
    for (const keep of ["Grady Primary Care", "Dr. Lee", "404-616-1234", "10/14/2026", "Lisinopril 10 mg", "404–616–1234"]) expect(r.text).toContain(keep);
  });
});

describe("second-model review findings", () => {
  it("a birth date or street address written again anywhere is hidden too", () => {
    const paper = "Patient: Maria Lopez   DOB: 01/02/1980\nAddress: 1427 Pine St NW\n\nHistory reviewed on 01/02/1980. Mail to 1427 Pine St NW.\nVisit: 10/14/2026";
    const r = shield(paper);
    expect(r.text).not.toContain("01/02/1980");
    expect(r.text).not.toContain("1427 Pine");
    expect(r.text).toContain("10/14/2026");
  });

  test.each([
    "Procedure name: Colonoscopy",
    "Diagnosis name: Type 2 diabetes",
    "Vaccine name: Shingrix",
    "Test name: Hemoglobin A1c",
    "Medication name: Metformin",
    "Device name: Glucose Monitor",
  ])("a clinical name field stays: %s", (paper) => {
    expect(shield(paper).text).toBe(paper);
  });

  test.each(["NAME_A", "Name_A", "name_a", "NAME A", "⟦name_a⟧"])("placeholder variant %j never reaches voice, call or UI", (t) => {
    expect(hasToken(`Call ${t} today.`)).toBe(true);
    expect(stripTokens(`Call ${t} today.`)).toBe("Call today.");
  });

  it("ordinary words that look a little like a placeholder stay", () => {
    for (const s of ["Bring your ID a day early.", "Email us at the clinic.", "At age a doctor may check it.", "Your NAME and DOB go here."]) expect(stripTokens(s)).toBe(s);
  });
});

describe("placeholders cannot hide from the output filter or from unshield", () => {
  it("stripTokens finds a placeholder with an invisible character, fullwidth letters or a lookalike inside it", () => {
    for (const t of ["⟦NAME​_A⟧", "⟦ＮＡＭＥ_A⟧", "NАME_A", "ＮＡＭＥ＿A"]) {
      expect(hasToken(`Call ${t} today.`), t).toBe(true);
      expect(stripTokens(`Call ${t} today.`), t).toBe("Call today.");
    }
  });

  it("unshield puts back a known placeholder written with an invisible character or bare, and drops unknown ones only when told", () => {
    const tokens = new Map([["⟦NAME_A⟧", "Maria"]]);
    expect(unshieldString("Hi ⟦NAME​_A⟧.", tokens)).toBe("Hi Maria.");
    expect(unshieldString("Hi NAME_A.", tokens)).toBe("Hi Maria.");
    expect(unshieldString("Hi ⟦NAME_Q⟧.", tokens)).toBe("Hi ⟦NAME_Q⟧.");
    expect(unshieldString("Hi ⟦NAME_Q⟧, rest.", tokens, () => true)).toBe("Hi, rest.");
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* The differential: the browser's shield and the server's guard read the same characters the same way.            */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Maria", "James", "Ana", "Terrence", "Linh", "Grace", "Sean", "Dolores", "Mei-Ling", "D'Angelo", "José"];
const LAST = ["Lopez", "Carter", "Ruiz", "Hill", "Nguyen", "Okafor", "O'Neil", "Haile", "Kim", "Brooks", "Lopez-Garcia"];
const NAME_LABELS = ["Patient: ", "PATIENT NAME: ", "Pt: ", "Patient Name - ", "Patient Name – ", "Name: ", "Pt Name:\t", "Patient: ", "Patient Name:\n"];
const DOBS = ["01/01/1970", "1970-01-01", "Jan 1 1970", "1 Jan 1970", "7/4/76", "12/31/1969", "1970/01/01"];
const DOB_LABELS = ["DOB: ", "D.O.B. ", "Date of birth: ", "Born ", "DOB:\n", "Birthdate - "];
const MRNS = ["88412907", "A1209938", "0041-7733-21", "AB-12-34-56", "ABC.123.456", "XJH 4421 9087"];
const MRN_LABELS = ["MRN: ", "MRN# ", "Medical Record #: ", "Member ID: ", "Acct #: ", "MRN\n"];
const NOISE = ["​", "⁠", "­", "﻿", "‍"];
const LOOKALIKE: Record<string, string> = { a: "а", e: "е", o: "о", p: "р", c: "с" };
const BODY = [
  "Take Lisinopril 10 mg every morning.",
  "Call Grady Primary Care at 404-616-1234 if you feel dizzy.",
  "See Dr. Lee on 10/14/2026 for a blood test.",
  "Check your blood pressure twice a day and write it down.",
  "Drink plenty of water. Come back if the fever lasts 3 days.",
];

/** Disguises a value: an invisible character, a lookalike letter, or nothing. */
function disguise(v: string, r: () => number): string {
  const k = r();
  if (k < 0.25) { const i = 1 + Math.floor(r() * (v.length - 1)); return v.slice(0, i) + NOISE[Math.floor(r() * NOISE.length)] + v.slice(i); }
  if (k < 0.45) return v.replace(/[aeopc]/, (c) => LOOKALIKE[c]);
  return v;
}

/** `at`: exact offsets of identifiers (planted papers), checked character by character instead of by leftover pieces. */
type Paper = { text: string; ids: string[]; uses: string[]; at?: { start: number; end: number }[] };

function randomPaper(r: () => number): Paper {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const first = pick(FIRST), last = pick(LAST), dob = pick(DOBS), mrn = pick(MRNS);
  const name = disguise(`${first} ${last}`, r);
  const header = [`${pick(NAME_LABELS)}${name}`, `${pick(DOB_LABELS)}${disguise(dob, r)}`, `${pick(MRN_LABELS)}${disguise(mrn, r)}`];
  const firstUse = disguise(first, r);
  const lastUse = disguise(last, r);
  const body = [...BODY].sort(() => r() - 0.5).slice(0, 3);
  body.splice(1, 0, `${firstUse}, ${body[0][0].toLowerCase()}${body[0].slice(1)}`);
  body.push(`Ms. ${lastUse}, bring this paper. Your number is ${mrn}.`);
  const sep = r() < 0.5 ? "   " : "\n";
  return { text: `${header.join(sep)}\nGrady Primary Care   Dr. Lee   Clinic phone: 404-616-1234\n\n${body.join("\n")}`, ids: [name, dob, mrn], uses: [firstUse, lastUse, mrn] };
}

/** A raw identifier is "left" when a letter or digit run of it can still be read in the redacted text. */
const leftIn = (redacted: string, value: string) => leftovers({ text: redacted, tokens: new Map(), offsetMap: [] }, value);

describe("differential: the browser shield and the server guard agree", () => {
  const r = rng(20261003);
  const papers: Paper[] = [
    ...Array.from({ length: 400 }, () => randomPaper(r)),
    // The planted papers, minus the three hard cases they plant on purpose as misses (see phiPlanted.ts).
    ...plantedPapers().map((p) => ({ text: p.text, ids: [], uses: [], at: p.planted.filter((m) => !["Jayden Carter", "Miguel", "404-555-0144"].includes(m.value)) })),
  ];

  it("the server finds nothing new in what the browser shielded, and neither path leaves a raw identifier", () => {
    const disagree: string[] = [];
    for (const p of papers) {
      // The browser: one session for the page.
      const client = shieldText(new PhiShield(), p.text);
      // The server: its own session, always run, on whatever the page sent.
      const serverOnClient = shieldText(new PhiShield(), client.result.text);
      if (serverOnClient.result.offsetMap.length) disagree.push(`${JSON.stringify(p.text)} -> server re-hid ${JSON.stringify(serverOnClient.result.offsetMap.map((s) => client.result.text.slice(s.start, s.end)))}`);
      // The server on the raw paper (a phone app): the same verdict as the browser, character for character.
      const serverRaw = shieldText(new PhiShield(), p.text);
      expect(serverRaw.result.offsetMap.map((s) => [s.start, s.end])).toEqual(client.result.offsetMap.map((s) => [s.start, s.end]));
      for (const m of p.at ?? []) {
        for (let i = m.start; i < m.end; i++) expect(client.result.offsetMap.some((s) => s.start <= i && i < s.end), `${p.text.slice(m.start, m.end)} in full`).toBe(true);
      }
      for (const v of [...p.ids, ...p.uses]) {
        expect(leftIn(client.result.text, v), `browser left ${JSON.stringify(v)} in ${JSON.stringify(client.result.text)}`).toEqual([]);
        expect(leftIn(serverRaw.result.text, v), `server left ${JSON.stringify(v)}`).toEqual([]);
      }
    }
    expect(disagree).toEqual([]);
  });

  it("adversarial: tokens planted by the paper itself are never trusted to cover a raw identifier", () => {
    for (const p of [
      "Patient: ⟦NAME_A⟧ Maria Lopez\n\nMaria, rest.",
      "Patient: Maria ⟦NAME_A⟧ Lopez",
      "MRN: ⟦MRN_A⟧ 88412907",
      "Patient: Maria Lopez⟦NAME_A⟧\n\nLopez⟦NAME_A⟧, call.",
    ]) {
      const client = shieldText(new PhiShield(), p);
      for (const v of ["Maria", "Lopez", "88412907"]) if (p.includes(v)) expect(leftIn(client.result.text, v), `${p} -> ${client.result.text}`).toEqual([]);
      expect(shieldText(new PhiShield(), client.result.text).result.offsetMap).toEqual([]);
    }
  });
});
