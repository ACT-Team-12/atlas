import { describe, expect, it } from "vitest";
import { NATIONAL, isGeorgiaZip, locateAnyZip, nationalPrograms, nearestNationalClinics, regionOf } from "./national";
import { SPECIALTY_NAME, nearestClinics, programsFor } from "./resources";
import { mergeNearest } from "./plan";

const at = (zip: string) => locateAnyZip(zip)!;

describe("nationwide: any US ZIP finds real HRSA health centers", () => {
  it("loads every US ZIP and over 9,000 general-care HRSA sites", () => {
    expect(NATIONAL.zipCount).toBeGreaterThan(33000);
    expect(NATIONAL.clinicCount).toBeGreaterThan(9000);
    expect(locateAnyZip("43215")).not.toBeNull(); // Columbus, OH
    expect(locateAnyZip("00000")).toBeNull();
  });

  it("knows Georgia ZIPs by their USPS prefix", () => {
    for (const z of ["30030", "31401", "39901"]) expect(isGeorgiaZip(z)).toBe(true);
    for (const z of ["43215", "35203", "29201", "32099"]) expect(isGeorgiaZip(z)).toBe(false);
  });

  it("tells metro Atlanta, the rest of Georgia and the rest of the US apart, by ZIP and by shared location", () => {
    expect(regionOf(at("30030"), "30030")).toBe("metro");
    expect(regionOf(at("31401"), "31401")).toBe("georgia"); // Savannah
    expect(regionOf(at("43215"), "43215")).toBe("us");
    expect(regionOf({ lat: 33.77, lng: -84.39 })).toBe("metro");
    // Outside metro a shared location can't be placed in a state reliably, so it never gets state-only programs.
    expect(regionOf(at("31401"))).toBe("us");
    expect(regionOf({ lat: 32.4709, lng: -85.0008 })).toBe("us"); // Phenix City, AL, next to Columbus, GA
    expect(regionOf(at("43215"))).toBe("us");
  });

  it("finds nearby centers in Ohio, nearest first, with no school or dental-only sites", () => {
    const near = nearestNationalClinics(at("43215"), 4);
    expect(near.length).toBe(4);
    expect(near.every((n) => n.clinic.city.endsWith(", OH") && n.km <= 60)).toBe(true);
    expect(near.map((n) => n.km)).toEqual([...near.map((n) => n.km)].sort((a, b) => a - b));
    expect(near.some((n) => /\bdental\b/i.test(n.clinic.name))).toBe(false);
  });

  it("suggests nothing when no center is within 60 km, and never sends someone far away to Atlanta", () => {
    expect(nearestNationalClinics({ lat: 30, lng: -40 }, 4)).toEqual([]); // mid-Atlantic Ocean
    expect(nearestClinics(at("43215"), 4)).toEqual([]);
    expect(nearestClinics(at("30030"), 4).length).toBe(4);
  });

  it("never offers a specialty-only site (pharmacy, eye, mental health, women's, student) as the nearest health center", () => {
    for (const n of ["CVS Pharmacy", "Vision Center", "Eye Clinic", "Behavioral Health", "Mental Health Services", "Women's Clinic",
      "Children's Clinic", "Laboratory", "WIC Office", "Davis and Elkins College Wellness Center", "Recovery Consultants: Tucker"])
      expect(SPECIALTY_NAME.test(n)).toBe(true);
    for (const n of ["Grace Health Medical Campus", "Valley Health Care Elkins - Health Center", "MedCura Decatur", "Labette Health Clinic"])
      expect(SPECIALTY_NAME.test(n)).toBe(false);
    // ZIPs where the first build's nearest site was a pharmacy, a mental health office, a vision center and a women's clinic.
    for (const z of ["26241", "97304", "95476", "40701"])
      for (const { clinic } of nearestNationalClinics(at(z), 4)) expect(SPECIALTY_NAME.test(clinic.name)).toBe(false);
  });

  it("only offers programs that apply where the person is", () => {
    const ids = (r: "metro" | "georgia" | "us") => programsFor(["transport", "insurance", "cost", "tech"], r).map((p) => p.id);
    expect(ids("metro")).toEqual(expect.arrayContaining(["marta-mobility", "georgia-medicaid-apply", "lifeline"]));
    expect(ids("georgia")).toEqual(expect.arrayContaining(["georgia-medicaid-apply", "lifeline"]));
    expect(ids("georgia").some((id) => id.startsWith("marta") || id.startsWith("grady"))).toBe(false);
    expect(ids("us")).toEqual(["lifeline"]);
  });

  it("national programs carry a quote that was found on their own official page", () => {
    for (const p of nationalPrograms()) {
      expect(p.evidence_quote.length).toBeGreaterThan(30);
      expect(p.source_url).toMatch(/^https:\/\//);
      expect((p as { quote_verified_live?: string }).quote_verified_live).toMatch(/^2026-10-02/);
    }
  });

  it("shows one card per site when an Atlanta record and an HRSA row describe the same place", () => {
    const a = nearestNationalClinics(at("43215"), 1)[0];
    const merged = mergeNearest([a, { ...a, km: a.km + 1 }, ...nearestNationalClinics(at("43215"), 3)], 4);
    expect(new Set(merged.map((m) => `${m.clinic.name}|${m.clinic.zip}`)).size).toBe(merged.length);
  });
});
