import { describe, expect, it } from "vitest";
import { PhiShield, shield } from "./phiShield";
import { guardMeaning, guardUnderstand } from "./phiGuard";

/**
 * Cost bounds for the shield (security review: resource amplification). /api/extract accepts 20,000 characters, so
 * every adversarial paper here is 20,000 characters, and the whole shield must finish in well under 100 ms.
 */
const N = 20_000;
const fill = (unit: string) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
const W = Array.from({ length: 5000 }, (_, i) => `N${i.toString(36)}x`); // many distinct name-like words

export const ADVERSARIAL: Record<string, string> = {
  "thousands of Name: labels, each a different name": W.map((w) => `Name: ${w[0].toUpperCase()}${w.slice(1)} `).join("").slice(0, N),
  "one line of thousands of labels with no other field": fill("MRN: 12345 DOB: x Phone: "),
  "Name: labels on separate lines (header chain)": W.map((w) => `Patient: Q${w}\nPhone: 404-555-0100\n`).join("").slice(0, N),
  "a single huge name value": `Patient: ${fill("Aaaa ")}`.slice(0, N),
  "pathological whitespace after labels": `Address: 1 A St\nA${" ".repeat(N - 40)}\n`,
  "address then a long city line": `Patient: Ana Ruiz\nAddress: 1 Elm St\n${fill("a ")}`.slice(0, N),
  "address then a city line that is all spaces after one word": `Patient: Ana Ruiz\nAddress: 1 Elm St\nAtlanta${" ".repeat(N - 50)}`,
  "thousands of placeholders already in the text": fill("⟦NAME_A⟧ Maria "),
  "Mr followed by long whitespace": fill(`Mr${" ".repeat(300)}`),
  "digits and long dashes (age phrase)": fill(`12${"-".repeat(200)}`),
  "email-like run": `Patient: Ana Ruiz\nEmail: a@${fill("a.")}`.slice(0, N),
  "id-like run": `MRN: ${fill("A1")}`.slice(0, N),
  "honorifics with distinct surnames": W.map((w) => `Ms. Q${w} `).join("").slice(0, N),
  // The shared reading and the new readers (value on the next line, a label across two lines, quoted values).
  "invisible characters everywhere": fill("Pa​t⁠ient: M­aria﻿ "),
  "one letter then thousands of combining marks": `Patient: M${"́".repeat(N - 20)}`,
  "compatibility characters that expand": fill("ﷺﬁ⑴Ｍ"),
  "lookalikes and fullwidth digits": fill("MRN： ８８４ Маria "),
  "stray brackets and fake placeholders": fill("⟦⟧⟦NAME_A 1⟧ ⟦ID_A⟧"),
  "a run of invisible characters before each bracket": fill(`${"​".repeat(40)} ⟦NAME_A⟧ `),
  "labels ending every line, values below": fill("DOB:\nPatient:\nMRN\n"),
  "a label broken across every pair of lines": fill("Medical Record\nNumber: A1209938 Date of\nBirth: 01/01/1970 "),
  "quoted values after every label": fill('MRN: "(((88412907 Patient: "Maria '),
  "id fields with junk words before the id": fill("MRN: a b c d e f g h 1234567 "),
  "header tables of placeholders": fill("Name   DOB   MRN ⟦ID_A⟧\nMaria Lopez   01/01/1970   88412907\n"),
  "one huge word": fill("a"),
};

// Letter-only names (a digit ends a name word, so "Zed12" is not a name).
const alpha = (i: number) => i.toString(26).replace(/[0-9]/g, (d) => "qrstuvwxyz"[Number(d)]);
const time = (f: () => void) => {
  f(); // warm up the regexes once
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe("worst-case cost of the shield on a 20,000-character paper", () => {
  for (const [name, text] of Object.entries(ADVERSARIAL)) {
    it(`${name}: under 100 ms`, () => {
      expect(text.length).toBeLessThanOrEqual(N);
      const ms = time(() => shield(text));
      expect(ms).toBeLessThan(100);
    });
  }

  it("fails closed: with far more identifiers than any cap, every later use is still hidden, under 100 ms", () => {
    // 600 patients' headers, then every name, and MRN again unlabeled in the body. A capped spread (the first
    // cost fix kept 48) would let the later uses through; there is no cap now.
    const people = Array.from({ length: 600 }, (_, i) => ({ name: `Zed${alpha(i)}`, mrn: String(10_000_000 + i * 7) }));
    const header = people.map((p) => `Patient: ${p.name}   MRN: ${p.mrn}`).join("\n");
    const body = people.map((p) => `${p.name}, call about ${p.mrn}.`).join(" ");
    const text = `${header}\n\n${body}`.slice(0, N);
    const s = new PhiShield();
    const t = performance.now();
    const r = s.shield(text);
    expect(performance.now() - t).toBeLessThan(100);
    expect(s.spreadCount).toBeGreaterThan(48);
    const leftBody = r.text.slice(r.text.indexOf("\n\n"));
    for (const p of people) {
      if (!text.includes(`${p.name}, call about ${p.mrn}.`)) continue; // cut off by the 20,000-character limit
      expect(leftBody).not.toMatch(new RegExp(`(?<![\\w])${p.name}(?![\\w])`));
      expect(leftBody).not.toContain(p.mrn);
    }
  });

  it("fails closed across requests too: a later text in the session hides every learned name", () => {
    const s = new PhiShield();
    const names = Array.from({ length: 300 }, (_, i) => `Quinn${alpha(i)}`);
    s.learn(names.map((n) => `Name: ${n}`).join("\n"));
    const later = s.shield(names.map((n) => `${n}, take your pills.`).join(" ")).text;
    for (const n of names) expect(later).not.toContain(n);
  });

  it("many fields with many names (the meaning and quiz routes) stay under 100 ms", async () => {
    const paper = ADVERSARIAL["thousands of Name: labels, each a different name"];
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, plain_language: paper.slice(0, 800), when: paper.slice(0, 200), source_quote: paper.slice(i * 100, i * 100 + 800) }));
    let t = performance.now();
    await guardMeaning({ items }, async () => ({}));
    expect(performance.now() - t).toBeLessThan(100);
    const qItems = items.slice(0, 20).map((it) => ({ id: it.id, kind: "x", title: it.when, source_quote: it.source_quote }));
    t = performance.now();
    await guardUnderstand({ source_text: paper, language: "English", items: qItems }, async () => ({ questions: [], dropped: [], model: "m", ms: 0 }));
    expect(performance.now() - t).toBeLessThan(100);
  });
});
