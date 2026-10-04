import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAB_REPORTS, PLANT_KINDS, plantsFor, runLabPlantedTest } from "./labPlanted";

const OUT = fileURLToPath(new URL("../data/eval/lab-planted.json", import.meta.url));
const COMMAND = "node scripts/lab-planted.mjs";

describe("lab results: planted mistakes (no AI)", () => {
  it("the sample lab reports are labeled samples, and every truth line is a full line of its report", () => {
    expect(LAB_REPORTS.length).toBeGreaterThanOrEqual(4);
    for (const r of LAB_REPORTS) {
      expect(r.text).toMatch(/written by Team ATLAS, not a real patient/);
      const lines = r.text.split("\n");
      for (const row of r.rows) {
        expect(lines).toContain(row.line);
        expect(row.line).toContain(row.value);
        if (row.range_text) expect(row.line).toContain(row.range_text);
      }
    }
  });

  it("covers every kind of planted mistake", () => {
    const kinds = new Set(LAB_REPORTS.flatMap((r) => plantsFor(r).map((p) => p.kind)));
    expect([...kinds].sort()).toEqual([...PLANT_KINDS].sort());
  });

  const report = runLabPlantedTest();

  it("judges every correct row the same as the hand-labeled truth, except rows marked cautious, which show as can't tell", () => {
    expect(report.real.wrong).toEqual([]);
    // Only a row the fixture itself marks cautious may differ, and only as "can't tell" (never folded as in range).
    const marked = LAB_REPORTS.flatMap((r) => r.rows.filter((x) => x.cautious).map((x) => `${r.id}/${x.test}`));
    expect(report.real.cautious.map((c) => `${c.report}/${c.test}`)).toEqual(marked);
    expect(marked.length).toBeLessThanOrEqual(1);
    expect(report.real.right + report.real.cautious.length).toBe(report.real.total);
  });

  it("drops or correctly judges every planted mistake", () => {
    expect(report.planted.slipped).toEqual([]);
    expect(report.planted.caught).toBe(report.planted.total);
  });

  // `node scripts/lab-planted.mjs` sets WRITE_LAB_PLANTED=1 to write the file the /tests page reads.
  it("the published result file matches a fresh run", () => {
    if (process.env.WRITE_LAB_PLANTED === "1") {
      writeFileSync(OUT, JSON.stringify({ measured_at: new Date().toISOString(), command: COMMAND, ...report }, null, 2) + "\n");
    }
    expect(existsSync(OUT)).toBe(true);
    const { measured_at, command, ...saved } = JSON.parse(readFileSync(OUT, "utf8"));
    expect(typeof measured_at).toBe("string");
    expect(command).toBe(COMMAND);
    expect(saved).toEqual(JSON.parse(JSON.stringify(report)));
  });
});
