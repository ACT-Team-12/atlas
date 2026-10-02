import { createHmac } from "node:crypto";
import { clientIp, guard } from "@/lib/guard";
import { callConfig } from "@/lib/call/config";
import { startCall } from "@/lib/call/flow";
import { callStore } from "@/lib/call/store";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const REFUSED: Record<string, [number, string]> = {
  "no-consent": [400, "Tick the box to say ATLAS may call this number."],
  language: [422, "Phone calls aren't available in this language yet. Use Read it out loud or Print instead."],
  token: [403, "This plan can't be read on a call. Make the plan again, then try."],
  phone: [400, "Enter a US phone number (10 digits). Toll-free, premium and non-US numbers can't be called."],
  "in-flight": [409, "A code call to this number is already on its way. Enter that code, or try again in 10 minutes."],
  "capped-caller": [429, "Too many calls were started from here today. Try again tomorrow."],
  "capped-code": [429, "This number already got 3 code calls today. Try again tomorrow."],
  "capped-plan": [429, "This number already got 3 plan calls today. Try again tomorrow."],
  "capped-site": [429, "ATLAS has made all of today's calls. Try again tomorrow."],
  "no-db": [503, "Calls are not available right now. Nothing was saved and no call was placed."],
  failed: [502, "The code call could not be placed. Check the number and try again."],
};

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
    // Counted per caller in Postgres (every instance agrees), keyed by an HMAC so no IP is stored.
    caller: createHmac("sha256", `atlas-call-ip:${cfg.secret}`).update(clientIp(request)).digest("hex").slice(0, 32),
  });
  if (r.state === "calling") return Response.json({ id: r.id, last4: r.last4 }, { headers: NO_STORE });
  const [status, error] = REFUSED[r.state];
  return Response.json({ error }, { status, headers: NO_STORE });
}
