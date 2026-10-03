import { describe, expect, it } from "vitest";
import { plantedPapers, runPhiPlantedTest } from "./phiPlanted";

/**
 * The planted-identifier test runs in CI. The floors are the numbers measured when this test was written: a change
 * that hides fewer planted identifiers, or hides care words it should keep, fails here before it ships.
 * To see the numbers: pnpm exec vitest run src/lib/phiPlanted.test.ts (they are also live on /tests).
 */
const FLOOR = { caught: 43, falseHides: 0 };

describe("planted identifiers in the 6 eval papers", () => {
  const papers = plantedPapers();
  const r = runPhiPlantedTest(papers);

  it("plants what it says: every planted value and every protected value sits where it is recorded", () => {
    expect(papers).toHaveLength(6);
    for (const p of papers) {
      for (const m of p.planted) expect(p.text.slice(m.start, m.end)).toBe(m.value);
      for (const k of p.keep) expect(p.text.slice(k.start, k.end)).toBe(k.value);
      expect(p.keep.filter((k) => k.why === "care instruction").length).toBeGreaterThan(0);
    }
  });

  // The measured numbers are in this test's name, so `pnpm phi-planted` (verbose reporter) prints them.
  it(`measured: caught ${r.planted.caught} of ${r.planted.total} planted identifiers; ${r.falseHides.count} false hides; kept ${r.keep.kept} of ${r.keep.total} protected care words; missed: ${r.planted.missed.map((m) => `${m.kind} "${m.value}" (${m.paper})`).join(", ") || "none"}`, () => {
    expect(r.planted.total).toBeGreaterThan(40);
  });

  it(`catches at least ${FLOOR.caught} planted identifiers`, () => {
    expect(r.planted.caught).toBeGreaterThanOrEqual(FLOOR.caught);
  });

  it(`hides at most ${FLOOR.falseHides} stretches that are not planted identifiers`, () => {
    expect(r.falseHides.examples).toEqual([]);
    expect(r.falseHides.count).toBeLessThanOrEqual(FLOOR.falseHides);
  });

  it("keeps every clinic name, doctor name, clinic phone, visit date and care instruction", () => {
    expect(r.keep.lost).toEqual([]);
    expect(r.keep.kept).toBe(r.keep.total);
  });
});
