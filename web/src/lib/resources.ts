import data from "@/data/resources.json";
import zipData from "@/data/zips.json";

export const BARRIERS = ["transport", "cost", "insurance", "language", "schedule", "tech", "referrals", "food", "housing"] as const;
export type Barrier = (typeof BARRIERS)[number];

export const BARRIER_LABEL: Record<Barrier, string> = {
  transport: "Getting there (no car, long bus ride)",
  cost: "Paying for the visit, lab or medicine",
  insurance: "No insurance, or not sure what's covered",
  language: "I'd rather get help in another language",
  schedule: "Time off work, clinic hours",
  tech: "No reliable phone or internet",
  referrals: "Not sure how referrals or labs work",
  food: "Having enough food",
  housing: "A safe, steady place to stay",
};

type Stop = { name: string; stop_id: string; meters: number };
export type Clinic = {
  id: string; name: string; org: string; address: string; city: string; zip: string; county: string;
  phone: string; website: string; lat: number; lng: number; hours_per_week: number | null;
  setting: string; health_center_type: string; nearest_rail: Stop | null; nearest_bus: Stop | null;
  barriers: string[]; source_id: string;
};
export type Program = {
  id: string; name: string; barriers: string[];
  access: { phone?: string; text?: string; url?: string };
  languages: string[]; evidence_quote: string; source_url: string; source_id?: string;
  hours_note?: string; language_note?: string;
};
export type Source = { id: string; name: string; url: string; retrieved: string; notes?: string };

const D = data as unknown as { generated_at: string; area: string; sources: Source[]; clinics: Clinic[]; programs: Program[] };
const Z = zipData as unknown as { source: string; zips: Record<string, [number, number]> };

export const DATASET = { generatedAt: D.generated_at, area: D.area, sources: D.sources, clinicCount: D.clinics.length, programCount: D.programs.length };

export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function locateZip(zip: string): { lat: number; lng: number } | null {
  const p = Z.zips[zip.trim()];
  return p ? { lat: p[0], lng: p[1] } : null;
}

/** Nearest general-public clinics. School-based sites are excluded: HRSA does not say they serve the public. */
export function nearestClinics(loc: { lat: number; lng: number }, n = 4) {
  return D.clinics
    // School sites serve enrolled students; dental-only sites (named so by HRSA) can't take a medical follow-up.
    .filter((c) => c.setting !== "School" && !/\bdental\b/i.test(c.name))
    .map((c) => ({ clinic: c, km: km(loc, c) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

export function programsFor(barriers: Barrier[]) {
  const set = new Set<string>(barriers);
  return D.programs.filter((p) => p.barriers.some((b) => set.has(b)));
}

export function programById(id: string) {
  return D.programs.find((p) => p.id === id);
}
export function clinicById(id: string) {
  return D.clinics.find((c) => c.id === id);
}
