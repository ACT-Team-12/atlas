/**
 * Replays mobile/shared/medicine-changes-vectors.json against the web classifier (medicineChanges.ts). The phone apps
 * will replay the same file when they port the card, so the three apps sort every medicine line the same way.
 * mobile/shared/check-vectors.sh runs this file in web-ci.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./schema";
import { medicineChange, type DoseChange, type MedReason, type MedRow } from "./medicineChanges";
import { stopNowFromPaper } from "./stepsView";

type Case = {
  name: string;
  language: (typeof LANGUAGES)[number];
  kind: string;
  quote: string;
  paper?: string;
  expect: { row: MedRow | "none"; reason?: MedReason; dose?: DoseChange | null; medicine_name?: string | null };
};

const file = resolve(__dirname, "../../../mobile/shared/medicine-changes-vectors.json");
const { cases } = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };

function span(c: Case) {
  if (!c.paper) return null;
  const start = c.paper.indexOf(c.quote);
  if (start < 0) throw new Error(`quote not in its paper: ${c.name}`);
  return { start, end: start + c.quote.length };
}

describe("medicine-changes-vectors.json", () => {
  it("has cases in all seven app languages, every row, and no case repeated", () => {
    // A file that lost its cases must not read as "every case passes".
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(new Set(cases.map((c) => c.language))).toEqual(new Set(LANGUAGES));
    expect(new Set(cases.map((c) => c.expect.row))).toEqual(new Set(["stop", "change", "start", "keep", "ask", "none"]));
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
    for (const lang of LANGUAGES) {
      const rows = new Set(cases.filter((c) => c.language === lang).map((c) => c.expect.row));
      expect(rows.has("stop") && rows.has("start") && rows.has("keep") && rows.has("ask"), lang).toBe(true);
    }
  });

  for (const c of cases) {
    it(`${c.language}: ${c.name}`, () => {
      const got = medicineChange({ id: "x", kind: c.kind, source_quote: c.quote, span: span(c) }, c.paper ?? "");
      if (c.expect.row === "none") {
        expect(got).toBeNull();
        return;
      }
      expect(got).not.toBeNull();
      expect(got!.row).toBe(c.expect.row);
      // The card's Stop row and the list's "Right away" stop rule never disagree.
      if (got!.row === "stop") expect(stopNowFromPaper({ kind: c.kind, source_quote: c.quote, span: span(c) }, c.paper ?? "")).toBe(true);
      if (c.expect.reason) expect(got!.reason).toBe(c.expect.reason);
      if ("dose" in c.expect) expect(got!.dose).toEqual(c.expect.dose);
      if ("medicine_name" in c.expect) expect(got!.name).toBe(c.expect.medicine_name);
      // The quote is the paper's, untouched; a dose shown is two pieces of that quote.
      expect(got!.quote).toBe(c.quote.replace(/\s+/g, " ").trim());
      if (got!.dose) {
        expect(c.quote).toContain(got!.dose.was);
        expect(c.quote).toContain(got!.dose.now);
      }
    });
  }
});
