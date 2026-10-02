import { guard } from "@/lib/guard";
import { callConfig, verifyTicket } from "@/lib/call/config";
import { handleEvent } from "@/lib/call/flow";
import { callStore } from "@/lib/call/store";

export const dynamic = "force-dynamic";

/**
 * Vonage call events. Only events carrying a valid ticket (each call's own event_url) change anything; events sent to
 * the application-level URL without one are acknowledged and ignored. Always 204, so Vonage does not retry.
 * The plan call ending (completed, unanswered, busy, failed...) wipes the encrypted number, text and audio.
 */
export async function POST(request: Request) {
  const refused = guard(request, "call-hook", 300);
  if (refused) return refused;
  const cfg = callConfig();
  const t = cfg ? verifyTicket(cfg.secret, new URL(request.url).searchParams.get("t"), "event") : null;
  if (t) {
    const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
    const store = await callStore();
    if (store) await handleEvent({ store }, t, body?.status);
  }
  return new Response(null, { status: 204 });
}
