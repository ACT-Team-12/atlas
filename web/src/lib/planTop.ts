import type { PlanResponse, ResourceCard } from "./plan";
import { BARRIERS, type Barrier, type Clinic } from "./resources";

/**
 * "Start with these 3": which verified programs and clinics in a plan help with the most of the person's problems.
 *
 * Plain code, no AI. A problem is one of the barriers the person picked ("Paying for the visit", "Getting there").
 * For each resource the plan names, from the plan steps that list it in resource_ids:
 *   1. count the distinct barriers of those steps: the person's problems it helps with (more first),
 *   2. ties: the number of plan steps that list it (more first),
 *   3. ties: nearer first (a clinic's km; a program has no distance and comes after any place with one),
 *   4. still tied: the one the plan names first.
 * Each resource appears once, with the barrier chips of the steps that use it.
 */
export type RankedResource = {
  id: string;
  card: ResourceCard;
  /** Indexes of the plan steps that list this resource. */
  steps: number[];
  /** The barriers of those steps, each once, in plan order. Only barriers the person picked (the server clears others). */
  barriers: Barrier[];
  km: number | null;
};

const isBarrier = (b: string): b is Barrier => (BARRIERS as readonly string[]).includes(b);

function byDistance(a: number | null, b: number | null) {
  const fa = a != null && Number.isFinite(a), fb = b != null && Number.isFinite(b);
  if (fa && fb) return (a as number) - (b as number);
  return fa ? -1 : fb ? 1 : 0;
}

export function rankResources(plan: Pick<PlanResponse, "steps" | "resources">): RankedResource[] {
  const found = new Map<string, RankedResource & { first: number }>();
  plan.steps.forEach((s, i) => {
    for (const id of new Set(s.resource_ids)) {
      const card = plan.resources[id];
      if (!card) continue;
      let r = found.get(id);
      if (!r) {
        r = { id, card, steps: [], barriers: [], km: card.type === "clinic" ? card.km : null, first: found.size };
        found.set(id, r);
      }
      r.steps.push(i);
      if (s.barrier && isBarrier(s.barrier) && !r.barriers.includes(s.barrier)) r.barriers.push(s.barrier);
    }
  });
  return [...found.values()]
    .sort((a, b) => b.barriers.length - a.barriers.length || b.steps.length - a.steps.length || byDistance(a.km, b.km) || a.first - b.first)
    .map((r) => ({ id: r.id, card: r.card, steps: r.steps, barriers: r.barriers, km: r.km }));
}

/**
 * The line on a top card. The count is the person's own problems this place helps with, out of the barriers they
 * picked in step 2 (never plan steps or anything else). With no barrier to count, it says how many plan steps use it.
 */
export function helpsLine(r: Pick<RankedResource, "barriers" | "steps">, chosen: readonly string[]): string {
  const named = [...new Set(chosen)].filter(isBarrier);
  const n = r.barriers.filter((b) => named.includes(b)).length;
  if (named.length > 0 && n > 0) {
    return named.length === 1 ? "Helps with the problem you named:" : `Helps with ${n} of the ${named.length} problems you named:`;
  }
  return `Part of ${r.steps.length} ${r.steps.length === 1 ? "step" : "steps"} in your plan`;
}

/** The top of the plan: at most `n` resources, ranked as above. */
export const topResources = (plan: Pick<PlanResponse, "steps" | "resources">, n = 3) => rankResources(plan).slice(0, n);

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d]/g, "")}`;

/** Transit directions to a clinic (Google Maps). */
export function directionsHref(c: Pick<Clinic, "address" | "city" | "zip">) {
  const place = c.city.includes(",") ? `${c.address}, ${c.city} ${c.zip}` : `${c.address}, ${c.city}, GA ${c.zip}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}&travelmode=transit`;
}

export type PrimaryAction = { label: string; href: string; external: boolean };

/**
 * The one big button on a top card. A phone number from the verified record comes first (these are calls), then the
 * official website ("Apply online" only when the verified name or quote is about applying), then, for a clinic with
 * neither, transit directions. A program with only a text line has no button: its text line is shown instead.
 */
export function primaryAction(card: ResourceCard): PrimaryAction | null {
  if (card.type === "clinic") {
    const c = card.clinic;
    if (c.phone) return { label: `Call ${c.phone}`, href: telHref(c.phone), external: false };
    if (c.website) return { label: "Open their website", href: c.website, external: true };
    return { label: "Transit directions", href: directionsHref(c), external: true };
  }
  const p = card.program;
  if (p.access.phone) return { label: `Call ${p.access.phone}`, href: telHref(p.access.phone), external: false };
  if (p.access.url) {
    const applies = /\bappl(y|ying|ication)\b/i.test(`${p.name} ${p.evidence_quote}`);
    return { label: applies ? "Apply online" : "Open their website", href: p.access.url, external: true };
  }
  return null;
}

/** The name a card goes by. */
export const resourceName = (card: ResourceCard) => (card.type === "clinic" ? card.clinic.name : card.program.name);
