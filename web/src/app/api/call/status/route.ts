import { guard } from "@/lib/guard";
import { callConfig } from "@/lib/call/config";
import { publicStatus } from "@/lib/call/flow";
import { callStore } from "@/lib/call/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** POST { id }: the person's own view of their call (polled by the page). Last 4 digits only, never the text. */
export async function POST(request: Request) {
  const refused = guard(request, "call-status", 240);
  if (refused) return refused;
  const cfg = callConfig();
  const store = cfg ? await callStore() : null;
  if (!cfg || !store) return Response.json({ error: "Phone calls are off on this site." }, { status: 503, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && body.id.length <= 64 ? body.id : null;
  if (!id) return Response.json({ error: "Send the call id." }, { status: 400, headers: NO_STORE });
  const now = Date.now();
  await store.sweep(now);
  return Response.json(publicStatus(await store.get(id, now)), { headers: NO_STORE });
}
