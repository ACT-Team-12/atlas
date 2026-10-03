import { clientIp, guard } from "@/lib/guard";
import { callerId } from "@/lib/call/caller";
import { callConfig } from "@/lib/call/config";
import { startCall } from "@/lib/call/flow";
import { startRefusal } from "@/lib/call/messages";
import { callStore } from "@/lib/call/store";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** POST { phone, consent, text, language, token }: step 1, a short call that speaks a 4-digit code. */
export async function POST(request: Request) {
  const refused = guard(request, "call-start", 10);
  if (refused) return refused;
  const cfg = callConfig();
  const store = cfg ? await callStore() : null;
  if (!cfg || !store) return Response.json({ error: "Phone calls are off on this site." }, { status: 503, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Send JSON." }, { status: 400, headers: NO_STORE });
  const r = await startCall({ store, cfg }, { phone: body.phone, consent: body.consent, text: body.text, language: body.language, token: body.token,
    // Counted per caller in Postgres (every instance agrees), keyed by an HMAC so no IP is stored; IPv6 per /64.
    caller: callerId(cfg.secret, clientIp(request)),
  });
  if (r.state === "calling") return Response.json({ id: r.id, last4: r.last4, uncertain: r.uncertain === true }, { headers: NO_STORE });
  const [status, error] = startRefusal(r.state, "kept" in r && r.kept === true);
  return Response.json({ error }, { status, headers: NO_STORE });
}
