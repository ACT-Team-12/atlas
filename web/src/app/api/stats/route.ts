import { helperFunnel, liveStats } from "@/lib/db";
import { publicStats } from "@/lib/publicStats";

export const dynamic = "force-dynamic";

// Public, no key: aggregate counts from real production use only (test runs excluded). Nothing per person.
// No exact count under 10 and none that lets one be worked out by subtracting (lib/publicStats.ts, lib/helperFunnel.ts).
export async function GET() {
  const [stats, funnel] = await Promise.all([liveStats(), helperFunnel()]);
  if (!stats) return Response.json({ error: "Stats are not reachable right now." }, { status: 503 });
  return Response.json({
    ...publicStats(stats, funnel),
    helper_funnel: funnel.available ? funnel.funnel : null,
    scope: "production use only, our own test runs excluded", computed_at: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
