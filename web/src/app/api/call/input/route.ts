import { guard } from "@/lib/guard";
import { callConfig, verifyTicket } from "@/lib/call/config";
import { handleInput } from "@/lib/call/flow";
import { goodbyeNcco } from "@/lib/call/ncco";
import { CallStoreDown, callStore } from "@/lib/call/store";
import { signedByVonage } from "@/lib/call/webhook";

export const dynamic = "force-dynamic";

const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return null; } };

/**
 * Vonage keypad input after the plan: "1" replays it (at most twice); anything else says goodbye. The plan text is only
 * returned for a call Vonage confirms is live and whose uuid matches the stored call (flow.ts); with
 * ATLAS_VONAGE_SIGNATURE_SECRET set the request must also carry Vonage's signature. Anything uncertain says goodbye.
 */
export async function POST(request: Request) {
  const refused = guard(request, "call-hook", 300);
  if (refused) return refused;
  const cfg = callConfig();
  if (!cfg) return Response.json(goodbyeNcco("English"));
  const t = verifyTicket(cfg.secret, new URL(request.url).searchParams.get("t"), "input");
  if (!t) return new Response("forbidden", { status: 403 });
  const raw = await request.text().catch(() => "");
  if (!signedByVonage(request, raw, cfg)) return new Response("unauthorized", { status: 401 });
  const body = parse(raw) as { uuid?: unknown; dtmf?: { digits?: unknown } } | null;
  const store = await callStore();
  if (!store) return Response.json(goodbyeNcco("English"));
  try {
    return Response.json(await handleInput({ store, cfg }, t, body?.dtmf?.digits, body?.uuid));
  } catch (e) {
    if (!(e instanceof CallStoreDown)) throw e;
    return new Response("unavailable", { status: 503 }); // never the plan text; Vonage ends the step
  }
}
