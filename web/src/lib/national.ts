import clinicData from "@/data/national-clinics.json";
import zipData from "@/data/national-zips.json";
import programData from "@/data/national-programs.json";
import metroZips from "@/data/zips.json";
import { type Clinic, type Program, km } from "./resources";

/**
 * Nationwide fallback, server only (imported by plan.ts, never by a client component: these files are ~3 MB).
 * Metro Atlanta keeps its richer records in resources.json. Everywhere else ATLAS points to the nearest HRSA-funded
 * health centers from the same HRSA file, and to national programs whose quotes were found on their own pages.
 */
type Row = [string, string, string, string, string, string, string, string, string, number, number, number | null, string];
const C = clinicData as unknown as { source: string; retrieved: string; stats: Record<string, number>; rows: Row[] };
const Z = zipData as unknown as { zips: Record<string, [number, number]> };
const M = metroZips as unknown as { zips: Record<string, [number, number]> };
const P = programData as unknown as { programs: Program[] };

export const NATIONAL = { clinicCount: C.rows.length, zipCount: Object.keys(Z.zips).length, source: C.source, retrieved: C.retrieved };
export const nationalPrograms = (): Program[] => P.programs;

/** Where the person is, for deciding which local programs apply. */
export type Region = "metro" | "georgia" | "us";
const ATL = { lat: 33.749, lng: -84.388 };
const METRO_KM = 60; // same radius that defines the metro ZIP list (scripts/build_zips.py)

/** Georgia ZIP prefixes (USPS): 300 to 319, 398, 399. */
export const isGeorgiaZip = (zip: string) => /^(3[01]\d|39[89])\d\d$/.test(zip);

export function locateAnyZip(zip: string): { lat: number; lng: number } | null {
  const p = Z.zips[zip.trim()];
  return p ? { lat: p[0], lng: p[1] } : null;
}

/** The ZIP whose center is closest to a point (used to tell which state a shared location is in). */
export function nearestZip(loc: { lat: number; lng: number }): string | null {
  let best: string | null = null, bestKm = Infinity;
  for (const [z, [lat, lng]] of Object.entries(Z.zips)) {
    if (Math.abs(lat - loc.lat) > 1 || Math.abs(lng - loc.lng) > 1.5) continue;
    const d = km(loc, { lat, lng });
    if (d < bestKm) { bestKm = d; best = z; }
  }
  return best;
}

export function regionOf(loc: { lat: number; lng: number }, zip?: string): Region {
  if (zip ? zip in M.zips : km(loc, ATL) <= METRO_KM) return "metro";
  const z = zip ?? nearestZip(loc);
  return z && isGeorgiaZip(z) ? "georgia" : "us";
}

function toClinic(r: Row): Clinic {
  const [id, name, org, address, city, state, zip, phone, website, lat, lng, hours_per_week, type] = r;
  return {
    id, name, org, address, city: `${city}, ${state}`, zip, county: "", phone, website, lat, lng, hours_per_week,
    setting: "", health_center_type: type === "look-alike" ? "FQHC Look-Alike" : "Federally Qualified Health Center (FQHC)",
    nearest_rail: null, nearest_bus: null, barriers: ["cost", "insurance"], source_id: "hrsa-national", hours: null,
  };
}

/** Nearest HRSA sites outside the Atlanta records, within maxKm. An empty list means none close enough to suggest. */
export function nearestNationalClinics(loc: { lat: number; lng: number }, n = 4, maxKm = 60) {
  const near: { row: Row; km: number }[] = [];
  for (const r of C.rows) {
    if (Math.abs(r[9] - loc.lat) > 1 || Math.abs(r[10] - loc.lng) > 1.5) continue; // ~110 km box before the exact distance
    const d = km(loc, { lat: r[9], lng: r[10] });
    if (d <= maxKm) near.push({ row: r, km: d });
  }
  return near.sort((a, b) => a.km - b.km).slice(0, n).map(({ row, km }) => ({ clinic: toClinic(row), km }));
}
