import { guard } from "@/lib/guard";
import { callConfig, verifyTicket } from "@/lib/call/config";
import { audioFor } from "@/lib/call/flow";
import { callStore } from "@/lib/call/store";

export const dynamic = "force-dynamic";

/** GET ?t=<ticket>: the natural-voice MP3 for one call, fetched by Vonage's stream action from any server instance. */
export async function GET(request: Request) {
  const refused = guard(request, "call-hook", 300);
  if (refused) return refused;
  const cfg = callConfig();
  if (!cfg) return new Response("not configured", { status: 503 });
  const t = verifyTicket(cfg.secret, new URL(request.url).searchParams.get("t"), "audio");
  if (!t) return new Response("forbidden", { status: 403 });
  const store = await callStore();
  const audio = store ? await audioFor({ store, cfg }, t) : null;
  if (!audio) return new Response("no audio", { status: 404 });
  return new Response(new Uint8Array(audio), {
    headers: { "content-type": "audio/mpeg", "content-length": String(audio.byteLength), "cache-control": "private, no-store" },
  });
}
