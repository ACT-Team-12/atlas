import { timingSafeEqual } from "node:crypto";
import { guard } from "@/lib/guard";
import { callConfig } from "@/lib/call/config";
import { settlePendingEnds } from "@/lib/call/flow";
import { callStore } from "@/lib/call/store";

export const dynamic = "force-dynamic";

/**
 * The retention floor for "ATLAS calls you", run by Vercel Cron every 5 minutes (vercel.json): wipes the encrypted
 * data of sessions that can go no further and deletes rows past 30 minutes, even when nobody uses calls.
 * With CRON_SECRET set (Vercel sends it as `Authorization: Bearer <CRON_SECRET>`), that header is required. Without it
 * the route still accepts Vercel's cron user agent, rate-limited: a sweep only removes data that is already expired, so
 * a spoofed trigger can do nothing but run the cleanup early. 503 when the sweep could not run, so it shows as failed.
 * It also asks Vonage again about plan calls whose end a callback reported while Vonage still said live (END_PENDING in
 * lib/call/store.ts) and wipes those Vonage now reports ended. The marker alone never wipes or ends anything.
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
  // Counts only, never ids. A call Vonage still reports live keeps its marker for the next run. When the pending ends
  // could not be listed or checked (database or Vonage failing), the run answers 503 so the cron shows as failed
  // instead of green while encrypted data waits for the 17-minute backstop.
  const cfg = callConfig();
  const pending = cfg ? await settlePendingEnds({ store, cfg }) : null;
  const pendingOk = !cfg || (pending !== null && pending.failed === 0);
  return Response.json({ swept: ok, pending }, { status: ok && pendingOk ? 200 : 503, headers: { "cache-control": "no-store" } });
}
