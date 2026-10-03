import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db";
import { sweepSttUsage } from "@/lib/sttUsage";

export const dynamic = "force-dynamic";

/**
 * Hourly Vercel cron (vercel.json): deletes "Say your answer" usage counters whose window has ended, so the keyed
 * network-address hashes are gone within two days. Vercel sends "Authorization: Bearer $CRON_SECRET"; anything
 * else is refused, and without CRON_SECRET the route refuses everyone.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Not configured." }, { status: 503 });
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ deleted: 0, note: "no database" });
  try {
    return Response.json({ deleted: await sweepSttUsage(pool) });
  } catch (e) {
    // Kind of error only. A failed sweep returns 500 so it shows red in the Vercel cron log.
    console.error("stt sweep failed", e instanceof Error ? e.name : typeof e, (e as { code?: string })?.code ?? "");
    return Response.json({ error: "Sweep failed." }, { status: 500 });
  }
}
