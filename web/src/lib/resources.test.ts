import { describe, expect, it } from "vitest";
import { BARRIERS, DATASET, afterHoursClinics, formatHours, locateZip, nearestClinics, openNow, opensEvenings, opensWeekends, programsFor, type Clinic } from "./resources";
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

  it("never suggests a dental-only site for a medical follow-up (found by the Clarkston persona run)", () => {
    const clarkston = nearestClinics(locateZip("30021")!, 4);
    expect(clarkston.some((n) => /dental/i.test(n.clinic.name))).toBe(false);
    expect(clarkston[0].clinic.name).toMatch(/Ethne Health/);
    for (const z of ["30317", "30340", "30303"]) expect(nearestClinics(locateZip(z)!, 4).some((n) => /dental/i.test(n.clinic.name))).toBe(false);
  });

  it("matches programs by barrier", () => {
    const t = programsFor(["transport"]).map((p) => p.id);
    expect(t).toContain("marta-mobility");
    expect(programsFor([]).length).toBe(0);
  });
});

describe("listed clinic hours", () => {
  const clinics = data.clinics as unknown as Clinic[];
  const byName = (re: RegExp) => clinics.find((c) => re.test(c.name))!;

  it("every listed period is a valid weekday and time range, and cites its source", () => {
    const sourceIds = new Set(data.sources.map((s) => s.id));
    const withHours = clinics.filter((c) => c.hours?.length);
    expect(withHours.length).toBeGreaterThanOrEqual(15);
    for (const c of withHours) {
      expect(sourceIds.has(c.hours_source_id!)).toBe(true);
      for (const p of c.hours!) {
        expect(p.day).toBeGreaterThanOrEqual(0);
        expect(p.day).toBeLessThanOrEqual(6);
        expect(p.open).toMatch(/^\d\d:\d\d$/);
        expect(p.close > p.open).toBe(true);
      }
    }
  });

  it("never takes hours from another business at the same address (school, shelter)", () => {
    expect(byName(/McNair/).hours ?? null).toBeNull();
    expect(byName(/Salvation Army/).hours ?? null).toBeNull();
    expect(byName(/School Based Health Center at Kipp Vision/).hours ?? null).toBeNull(); // listing said "Open 24 hours"
  });

  it("formats runs of days and finds evening and weekend clinics", () => {
    const main = byName(/Main Center/);
    expect(formatHours(main.hours)).toBe("Mon-Fri 8am-8pm, Sat 9am-2pm");
    expect(opensEvenings(main)).toBe(true);
    expect(opensWeekends(main)).toBe(true);
    expect(formatHours([{ day: 0, open: "08:00", close: "16:30" }])).toBe("Mon 8am-4:30pm");
    expect(formatHours(null)).toBeNull();
    const after = afterHoursClinics(locateZip("30310")!, 2);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((a) => opensEvenings(a.clinic) || opensWeekends(a.clinic))).toBe(true);
  });

  it("knows open-now in Atlanta time, whatever the server's time zone", () => {
    const main = byName(/Main Center/);
    expect(openNow(main, new Date("2026-10-06T14:00:00Z"))).toBe(true); // Tue 10am EDT
    expect(openNow(main, new Date("2026-10-07T01:30:00Z"))).toBe(false); // Tue 9:30pm EDT
    expect(openNow(main, new Date("2026-10-04T15:00:00Z"))).toBe(false); // Sun 11am EDT
    expect(openNow(byName(/McNair/))).toBeNull();
  });
});
