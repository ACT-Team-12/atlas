import { helperFunnel, liveStats } from "@/lib/db";
import { suppress } from "@/lib/helperFunnel";

export const dynamic = "force-dynamic";

// Public, no key: aggregate counts from real production use only (test runs excluded). Nothing per person.
// Helper-link counts under 10 are shown as "<10" (see lib/helperFunnel.ts).
export async function GET() {
  const [stats, funnel] = await Promise.all([liveStats(), helperFunnel()]);
  if (!stats) return Response.json({ error: "Stats are not reachable right now." }, { status: 503 });
  return Response.json({
    ...stats,
    helper_link_plans: stats.helper_link_plans === null ? null : suppress(stats.helper_link_plans),
    helper_funnel: funnel.available ? funnel.funnel : null,
    scope: "production use only, our own test runs excluded", computed_at: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
