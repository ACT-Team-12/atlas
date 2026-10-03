import { guard } from "@/lib/guard";
import { callConfig } from "@/lib/call/config";
import { verifyAndCall } from "@/lib/call/flow";
import { callStore } from "@/lib/call/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const REFUSED: Record<string, [number, string]> = {
  expired: [410, "That code expired or used its 3 tries. Ask for a new call."],
  token: [403, "This plan can't be read on a call any more. Make the plan again, then try."],
  "capped-plan": [429, "This number already got 3 plan calls today. Try again tomorrow."],
  "capped-site": [429, "ATLAS has made all of today's calls. Try again tomorrow."],
  failed: [502, "The plan call could not be placed. Your number and plan were deleted. Try again."],
};

/** POST { id, code }: step 2. The right code places the plan call right away. */
export async function POST(request: Request) {
  const refused = guard(request, "call-verify", 15);
  if (refused) return refused;
  const cfg = callConfig();
  const store = cfg ? await callStore() : null;
  if (!cfg || !store) return Response.json({ error: "Phone calls are off on this site." }, { status: 503, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Send JSON." }, { status: 400, headers: NO_STORE });
  await store.sweep(Date.now()); // opportunistic; the cron (/api/call/sweep) is the floor
  const r = await verifyAndCall({ store, cfg }, { id: body.id, code: body.code });
  if (r.state === "calling") return Response.json({ last4: r.last4, mode: r.mode, uncertain: r.uncertain === true }, { headers: NO_STORE });
  if (r.state === "wrong") {
    const left = r.attemptsLeft;
    return Response.json({ error: `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`, attempts_left: left }, { status: 400, headers: NO_STORE });
  }
  const [status, error] = REFUSED[r.state];
  return Response.json({ error }, { status, headers: NO_STORE });
}
