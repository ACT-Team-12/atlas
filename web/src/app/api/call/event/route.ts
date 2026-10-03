import { guard } from "@/lib/guard";
import { callConfig, verifyTicket } from "@/lib/call/config";
import { handleEvent } from "@/lib/call/flow";
import { CallStoreDown, callStore } from "@/lib/call/store";
import { signedByVonage } from "@/lib/call/webhook";

export const dynamic = "force-dynamic";

const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return null; } };

/**
 * Vonage call events. Only events carrying a valid ticket (each call's own event_url) are looked at; events sent to
 * the application-level URL without one are acknowledged and ignored. The event's body is not trusted for the call's
 * status: flow.ts checks its uuid against the stored call and asks Vonage for the real status. With
 * ATLAS_VONAGE_SIGNATURE_SECRET set the event must also carry Vonage's signature. When the event cannot be checked or
 * saved (database or Vonage unreachable) the answer is 503, so Vonage retries it.
 * The plan call ending (completed, unanswered, busy, failed...) wipes the encrypted number, text and audio.
 */
export async function POST(request: Request) {
  const refused = guard(request, "call-hook", 300);
  if (refused) return refused;
  const cfg = callConfig();
  const t = cfg ? verifyTicket(cfg.secret, new URL(request.url).searchParams.get("t"), "event") : null;
  if (!cfg || !t) return new Response(null, { status: 204 });
  const raw = await request.text().catch(() => "");
  if (!signedByVonage(request, raw, cfg)) return new Response("unauthorized", { status: 401 });
  const body = parse(raw) as { uuid?: unknown } | null;
  const store = await callStore();
  if (!store) return new Response("unavailable", { status: 503 });
  try {
    const r = await handleEvent({ store, cfg }, t, body?.uuid);
    return new Response(null, { status: r === "error" ? 503 : 204 });
  } catch (e) {
    if (!(e instanceof CallStoreDown)) throw e;
    return new Response("unavailable", { status: 503 });
  }
}
