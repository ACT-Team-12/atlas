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
/** One open period. day: 0 = Monday ... 6 = Sunday. Times are 24h "HH:MM", Atlanta local time. */
export type OpenPeriod = { day: number; open: string; close: string };
export type Clinic = {
  id: string; name: string; org: string; address: string; city: string; zip: string; county: string;
  phone: string; website: string; lat: number; lng: number; hours_per_week: number | null;
  setting: string; health_center_type: string; nearest_rail: Stop | null; nearest_bus: Stop | null;
  barriers: string[]; source_id: string;
  /**
   * Opening hours (scripts/add_hours.py). hours_source_id "clinic-site": quoted from the health center's own page
   * (hours_quote is on hours_url). "gmaps-hours": its Google Maps listing. null when neither gives hours.
   */
  hours?: OpenPeriod[] | null; hours_source_id?: string | null; hours_quote?: string; hours_url?: string;
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

/**
 * Nearest general-public clinics within maxKm. School-based sites are excluded: HRSA does not say they serve the public.
 * The distance cap keeps a person far from Atlanta from being sent to an Atlanta clinic.
 */
export function nearestClinics(loc: { lat: number; lng: number }, n = 4, maxKm = 60) {
  return D.clinics
    // School sites serve enrolled students; dental-only sites (named so by HRSA) can't take a medical follow-up.
    .filter((c) => c.setting !== "School" && !/\bdental\b/i.test(c.name))
    .map((c) => ({ clinic: c, km: km(loc, c) }))
    .filter((x) => x.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}` : `${hh}${h < 12 ? "am" : "pm"}`;
};

/** Open after 6pm on some weekday (evening appointments possible). */
export const opensEvenings = (c: Clinic) => (c.hours ?? []).some((p) => p.day < 5 && p.close > "18:00");
/** Open on Saturday or Sunday. */
export const opensWeekends = (c: Clinic) => (c.hours ?? []).some((p) => p.day >= 5);

/** "Mon-Fri 8am-5pm, Sat 9am-2pm": runs of days with the same hours are grouped. */
export function formatHours(hours: OpenPeriod[] | null | undefined): string | null {
  if (!hours?.length) return null;
  const byDay = DAY.map((_, d) => hours.filter((p) => p.day === d).map((p) => `${clock(p.open)}-${clock(p.close)}`).join(", "));
  const parts: string[] = [];
  for (let d = 0; d < 7; ) {
    if (!byDay[d]) { d++; continue; }
    let e = d;
    while (e + 1 < 7 && byDay[e + 1] === byDay[d]) e++;
    parts.push(`${e > d ? `${DAY[d]}-${DAY[e]}` : DAY[d]} ${byDay[d]}`);
    d = e + 1;
  }
  return parts.join(", ");
}

/** Open right now, in Atlanta time. null when hours are not listed. */
export function openNow(c: Clinic, at: Date = new Date()): boolean | null {
  if (!c.hours?.length) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  const day = DAY.indexOf(parts.weekday);
  const now = `${parts.hour}:${parts.minute}`;
  return c.hours.some((p) => p.day === day && p.open <= now && now < p.close);
}

/**
 * For people whose barrier is work hours: up to n clinics within maxKm that are open evenings or weekends,
 * nearest first, so the plan can offer a time that fits a shift.
 */
export function afterHoursClinics(loc: { lat: number; lng: number }, n = 2, maxKm = 20) {
  return D.clinics
    .filter((c) => c.setting !== "School" && !/\bdental\b/i.test(c.name) && (opensEvenings(c) || opensWeekends(c)))
    .map((c) => ({ clinic: c, km: km(loc, c) }))
    .filter((x) => x.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/**
 * Where each program can actually help. Metro: Atlanta-area services (MARTA, Grady for Fulton/DeKalb, the Atlanta food
 * bank and 211). Georgia: state benefits. National: federal programs. An id missing here is treated as metro only.
 */
export const PROGRAM_SCOPE: Record<string, "metro" | "georgia" | "national"> = {
  "united-way-211": "metro", "marta-mobility": "metro", "marta-language-line": "metro", "marta-reduced-fare": "metro",
  "grady-financial-assistance": "metro", "acfb-food-map": "metro", "acfb-benefits-help": "metro",
  "georgia-gateway": "georgia", "georgia-medicaid-apply": "georgia", lifeline: "national",
};

/** Programs that match the barriers and apply where the person is (default metro, for callers with no location). */
export function programsFor(barriers: Barrier[], region: "metro" | "georgia" | "us" = "metro") {
  const set = new Set<string>(barriers);
  const ok = (id: string) => {
    const s = PROGRAM_SCOPE[id] ?? "metro";
    return region === "metro" || s === "national" || (region === "georgia" && s === "georgia");
  };
  return D.programs.filter((p) => ok(p.id) && p.barriers.some((b) => set.has(b)));
}

export function programById(id: string) {
  return D.programs.find((p) => p.id === id);
}
export function clinicById(id: string) {
  return D.clinics.find((c) => c.id === id);
}
