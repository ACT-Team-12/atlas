import { guard } from "@/lib/guard";
import { callConfig, verifyTicket } from "@/lib/call/config";
import { handleInput } from "@/lib/call/flow";
import { goodbyeNcco } from "@/lib/call/ncco";
import { callStore } from "@/lib/call/store";

export const dynamic = "force-dynamic";

/** Vonage keypad input after the plan: "1" replays it (at most twice); anything else says goodbye. */
export async function POST(request: Request) {
  const refused = guard(request, "call-hook", 300);
  if (refused) return refused;
  const cfg = callConfig();
  if (!cfg) return Response.json(goodbyeNcco("English"));
  const t = verifyTicket(cfg.secret, new URL(request.url).searchParams.get("t"), "input");
  if (!t) return new Response("forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { dtmf?: { digits?: unknown } } | null;
  const store = await callStore();
  if (!store) return Response.json(goodbyeNcco("English"));
  return Response.json(await handleInput({ store, cfg }, t, body?.dtmf?.digits));
}
