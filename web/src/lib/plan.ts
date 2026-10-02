import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL, ExtractError } from "./extract";
import { BARRIERS, BARRIER_LABEL, type Barrier, type Clinic, type Program, afterHoursClinics, formatHours, nearestClinics, opensEvenings, opensWeekends, programsFor, locateZip } from "./resources";
import { LANGUAGES } from "./schema";

export const PlanRequestSchema = z.object({
  care: z
    .array(
      z.object({
        id: z.string().max(40),
        kind: z.string().max(40),
        title: z.string().max(200),
        plain_language: z.string().max(800),
        when: z.string().max(200).default(""),
        source_quote: z.string().max(800),
      }),
    )
    .max(40)
    .default([]),
  barriers: z.array(z.enum(BARRIERS)).max(BARRIERS.length),
  zip: z.string().regex(/^\d{5}$/).optional(),
  location: z.object({ lat: z.number().min(33).max(34.6), lng: z.number().min(-85).max(-83.6) }).optional(),
  language: z.enum(LANGUAGES).default("English"),
  note: z.string().max(600).default(""),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

const ModelPlan = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      title: z.string(),
      action: z.string(),
      why: z.string(),
      barrier: z.string(),
      care_ids: z.array(z.string()),
      resource_ids: z.array(z.string()),
    }),
  ),
  ask_a_person: z.boolean(),
  ask_a_person_reason: z.string(),
});

export type PlanStep = z.infer<typeof ModelPlan>["steps"][number] & { dropped_refs: string[] };
export type ResourceCard =
  | { type: "clinic"; id: string; km: number | null; clinic: Clinic }
  | { type: "program"; id: string; program: Program };
export type PlanResponse = {
  summary: string;
  steps: PlanStep[];
  resources: Record<string, ResourceCard>;
  ask_a_person: boolean;
  ask_a_person_reason: string;
  located: { by: "zip" | "device" | "none"; label: string };
  stats: { candidates: number; steps: number; dropped_refs: number; ms: number };
  model: string;
};

const SYSTEM = `You are ATLAS, helping a community health worker or a patient in metro Atlanta turn a clinic visit into a plan they can finish.
You get: the care steps from the patient's own after-visit paper (with ids), the barriers they told us about, and a list of VERIFIED local resources (with ids).
Rules:
- Use ONLY the care ids and resource ids you were given. Never invent a phone number, address, program, price, eligibility rule or medical advice. Do not write phone numbers or URLs in your text; the app shows them from the verified record.
- Each step should help the person get one real thing done (get to the lab, afford the medicine, apply for coverage, understand the referral). Tie it to the care step it serves and the resource that helps.
- For "referrals" or "schedule" barriers, explain using only what the paper says (cite the care id). If the paper does not say, tell them what to ask the clinic.
- For a "schedule" barrier, prefer clinics with open_evenings or open_weekends true and you may say they list evening or weekend hours. Never state exact hours in your text (the app shows the listed hours), and suggest calling to confirm.
- Write in the requested language, at a plain reading level, kind and direct. 3 to 7 steps.
- Set ask_a_person true if a barrier has no matching verified resource, or the situation sounds urgent or unsafe, and say why.`;

export async function buildPlan(req: PlanRequest): Promise<PlanResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const t0 = Date.now();

  let loc: { lat: number; lng: number } | null = null;
  let located: PlanResponse["located"] = { by: "none", label: "No location given" };
  if (req.location) {
    loc = req.location;
    located = { by: "device", label: "Near your current location" };
  } else if (req.zip) {
    loc = locateZip(req.zip);
    located = loc ? { by: "zip", label: `Near ZIP ${req.zip}` } : { by: "none", label: `ZIP ${req.zip} is outside our metro Atlanta list` };
  }

  const resources: Record<string, ResourceCard> = {};
  for (const p of programsFor(req.barriers as Barrier[])) resources[p.id] = { type: "program", id: p.id, program: p };
  if (loc) for (const { clinic, km } of nearestClinics(loc, 4)) resources[clinic.id] = { type: "clinic", id: clinic.id, km: Math.round(km * 10) / 10, clinic };
  // Work hours are the barrier: also offer the nearest clinics with listed evening or weekend hours.
  if (loc && req.barriers.includes("schedule"))
    for (const { clinic, km } of afterHoursClinics(loc, 2)) resources[clinic.id] ??= { type: "clinic", id: clinic.id, km: Math.round(km * 10) / 10, clinic };

  const careIds = new Set(req.care.map((c) => c.id));
  const resourceIds = new Set(Object.keys(resources));

  const catalog = Object.values(resources).map((r) =>
    r.type === "clinic"
      ? { id: r.id, type: "community health center (sliding fee by law)", name: r.clinic.name, city: r.clinic.city, km_away: r.km,
          hours_per_week: r.clinic.hours_per_week, listed_hours: formatHours(r.clinic.hours) ?? "not listed",
          open_evenings: opensEvenings(r.clinic), open_weekends: opensWeekends(r.clinic), nearest_marta_rail: r.clinic.nearest_rail?.name ?? null,
          rail_km: r.clinic.nearest_rail ? Math.round(r.clinic.nearest_rail.meters / 100) / 10 : null, nearest_bus_stop: r.clinic.nearest_bus?.name ?? null }
      : { id: r.id, type: "program", name: r.program.name, helps_with: r.program.barriers, verified_quote: r.program.evidence_quote,
          languages: r.program.languages },
  );

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ModelPlan) },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          language: req.language,
          barriers: req.barriers.map((b) => ({ id: b, label: BARRIER_LABEL[b] })),
          note_from_person: req.note,
          location: located.label,
          care_steps_from_paper: req.care.map((c) => ({ id: c.id, kind: c.kind, title: c.title, what: c.plain_language, when: c.when, quote: c.source_quote })),
          verified_resources: catalog,
        }),
      },
    ],
  });
  if (msg.stop_reason === "refusal") throw new ExtractError("The AI declined to build this plan.", 422);
  const parsed = ModelPlan.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The AI returned a malformed plan. Try again.", 502);

  // Grounding check: every id must exist in what we sent. Unknown ids are dropped and counted, never shown.
  let dropped = 0;
  const steps: PlanStep[] = parsed.data.steps
    .map((s) => {
      const bad = [...s.care_ids.filter((id) => !careIds.has(id)), ...s.resource_ids.filter((id) => !resourceIds.has(id))];
      dropped += bad.length;
      // The barrier label must be one the person actually picked; anything else (or blank) is cleared.
      const barrier = (req.barriers as string[]).includes(s.barrier) ? s.barrier : "";
      return { ...s, barrier, care_ids: s.care_ids.filter((id) => careIds.has(id)), resource_ids: s.resource_ids.filter((id) => resourceIds.has(id)), dropped_refs: bad };
    })
    .filter((s) => s.care_ids.length + s.resource_ids.length > 0);

  return {
    summary: parsed.data.summary,
    steps,
    resources,
    ask_a_person: parsed.data.ask_a_person,
    ask_a_person_reason: parsed.data.ask_a_person_reason,
    located,
    stats: { candidates: resourceIds.size, steps: steps.length, dropped_refs: dropped, ms: Date.now() - t0 },
    model: MODEL,
  };
}
