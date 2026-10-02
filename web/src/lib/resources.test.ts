import { describe, expect, it } from "vitest";
import { BARRIERS, DATASET, locateZip, nearestClinics, programsFor } from "./resources";
import data from "@/data/resources.json";

describe("verified resource dataset", () => {
  it("is non-empty and every record cites a source", () => {
    expect(DATASET.clinicCount).toBeGreaterThanOrEqual(30);
    expect(DATASET.programCount).toBeGreaterThanOrEqual(5);
    const sourceIds = new Set(data.sources.map((s) => s.id));
    for (const c of data.clinics) {
      expect(sourceIds.has(c.source_id)).toBe(true);
      expect(c.phone).toMatch(/\d{3}.\d{3}.\d{4}/);
    }
    for (const p of data.programs) {
      expect(p.source_url).toMatch(/^https:\/\//);
      expect(p.evidence_quote.length).toBeGreaterThan(10);
      for (const b of p.barriers) expect(BARRIERS as readonly string[]).toContain(b);
    }
  });

  it("locates a metro ZIP and returns nearby general-public clinics only", () => {
    const loc = locateZip("30340");
    expect(loc).not.toBeNull();
    const near = nearestClinics(loc!, 4);
    expect(near).toHaveLength(4);
    expect(near.every((n) => n.clinic.setting !== "School")).toBe(true);
    expect(near[0].km).toBeLessThanOrEqual(near[3].km);
    expect(locateZip("99999")).toBeNull();
  });

  it("matches programs by barrier", () => {
    const t = programsFor(["transport"]).map((p) => p.id);
    expect(t).toContain("marta-mobility");
    expect(programsFor([]).length).toBe(0);
  });
});
