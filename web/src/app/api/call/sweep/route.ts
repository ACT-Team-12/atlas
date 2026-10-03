import { timingSafeEqual } from "node:crypto";
import { guard } from "@/lib/guard";
import { callStore } from "@/lib/call/store";

export const dynamic = "force-dynamic";

/**
 * The retention floor for "ATLAS calls you", run by Vercel Cron every 5 minutes (vercel.json): wipes the encrypted
 * data of sessions that can go no further and deletes rows past 30 minutes, even when nobody uses calls.
 * With CRON_SECRET set (Vercel sends it as `Authorization: Bearer <CRON_SECRET>`), that header is required. Without it
 * the route still accepts Vercel's cron user agent, rate-limited: a sweep only removes data that is already expired, so
 * a spoofed trigger can do nothing but run the cleanup early. 503 when the sweep could not run, so it shows as failed.
 */
let warned = false;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (!warned) {
      warned = true;
      console.warn("call sweep: CRON_SECRET is not set; accepting the Vercel cron user agent");
    }
    return (request.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
  }
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: Request) {
  const refused = guard(request, "call-sweep", 30);
  if (refused) return refused;
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });
  const store = await callStore();
  if (!store) return Response.json({ swept: false, reason: "no database" }, { status: 503 });
  const ok = await store.sweep(Date.now());
  return Response.json({ swept: ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
