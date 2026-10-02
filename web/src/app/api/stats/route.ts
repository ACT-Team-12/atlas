import { liveStats } from "@/lib/db";

export const dynamic = "force-dynamic";

// Public, no key: aggregate counts from real production use only (test runs excluded). Nothing per person.
export async function GET() {
  const stats = await liveStats();
  if (!stats) return Response.json({ error: "Stats are not reachable right now." }, { status: 503 });
  return Response.json({ ...stats, scope: "production use only, our own test runs excluded", computed_at: new Date().toISOString() }, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
