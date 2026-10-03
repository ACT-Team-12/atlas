import { describe, expect, it } from "vitest";
import { readable, unreadable } from "./textReading";
import { cues, cuesDiffer } from "./prepCues";
import { certifyBlocker, conceptsIn } from "./semanticGuard";
import { combine, numberCheckAnyForm } from "./meaning";
import { PREP_TRUTH } from "./prepPlanted";
import { PAPERS } from "./checkerTest";

/**
 * Differential property test (security review of fix/certify-hardening): the cue reader, the concept reader and the
 * number readers read every way of writing the same text the same way, or the text is unreadable and the step is
 * never certified. No variant may make one path see less than the plain text shows.
 */
const BASE = [
  ...PREP_TRUTH.flatMap((t) => [t.quote, t.plain]),
  ...PAPERS.flatMap((p) => p.expected),
  "Do not take aspirin 7 days before your procedure.", "Don't eat after midnight.", "It doesn't matter; take 2 tablets at 8 AM.",
  "Take 2 tablets every 4 hours, only as needed.", "Tome 2 tabletas por la mañana, después del desayuno.",
  "Ne prenez pas le fer 7 jours avant.", "Không uống thuốc sau nửa đêm.", "Take 1 tablet twice a day until it is gone.",
];

const VARIANTS: [string, (t: string) => string][] = [
  ["NFD", (t) => t.normalize("NFD")],
  ["NFKD", (t) => t.normalize("NFKD")],
  ["upper case", (t) => t.toUpperCase()],
  ["no-break spaces", (t) => t.replace(/ /g, " ")],
  ["narrow no-break spaces", (t) => t.replace(/ /g, " ")],
  ["curly apostrophes", (t) => t.replace(/'/g, "’")],
  ["en dashes", (t) => t.replace(/-/g, "–")],
  ["fullwidth letters", (t) => t.replace(/[A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))],
  ["fullwidth digits", (t) => t.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))],
  ["zero-width space after each 'o'", (t) => t.replace(/o/g, "o​")],
  ["soft hyphens", (t) => t.replace(/a/g, "a­")],
];

describe("one reading for cues, concepts and numbers", () => {
  it("covers a real corpus", () => expect(BASE.length).toBeGreaterThan(50));

  for (const [name, f] of VARIANTS) {
    it(`${name}: the same cues, concepts and numbers, or unreadable (never certified)`, () => {
      for (const t of BASE) {
        const v = f(t);
        if (v === t) continue;
        if (unreadable(v)) {
          // Can't be read: every certification path refuses.
          expect(certifyBlocker(t, v), `${name}: ${t}`).not.toBeNull();
          expect(cuesDiffer(t, v)).toBe(true);
          expect(numberCheckAnyForm({ source_quote: t, plain_language: v }).uncheckable).toBe(true);
          expect(combine("x", { id: "x", when: "", source_quote: t, plain_language: v }, "same", "").certified).toBe(false);
          continue;
        }
        expect(cues(v), `${name} cues: ${t}`).toEqual(cues(t));
        expect([...conceptsIn(v)].sort(), `${name} concepts: ${t}`).toEqual([...conceptsIn(t)].sort());
        expect(numberCheckAnyForm({ source_quote: t, plain_language: v }), `${name} numbers: ${t}`).toEqual(numberCheckAnyForm({ source_quote: t, plain_language: t }));
        expect(readable(v).toLowerCase(), `${name}: ${t}`).toBe(readable(t).toLowerCase());
      }
    });
  }

  it("contractions read as do-not in every spelling", () => {
    for (const s of ["Don't eat.", "Don’t eat.", "DON'T EAT.", "Dont eat.", "Doesn't need food.", "Doesnt need food.", "You can't drive.", "You cant drive."]) expect(cues(s).no, s).toBe(true);
  });
});
