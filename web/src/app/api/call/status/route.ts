import { guard } from "@/lib/guard";
import { callConfig } from "@/lib/call/config";
import { publicStatus, settlePendingEnds } from "@/lib/call/flow";
import { CallStoreDown, callStore, END_PENDING } from "@/lib/call/store";

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
  try {
    let row = await store.get(id, now);
    // A plan call whose end is pending (END_PENDING in lib/call/store.ts): ask Vonage again now, so the page shows the
    // end and the data goes as soon as Vonage reports it, not only at the next sweep. Wipes only on Vonage's own word.
    if (row?.phase === "calling" && row.note === END_PENDING) {
      // When the end could not be checked, say status is unavailable (503, the panel shows it and backs off) rather
      // than answer the stale "calling" row as if it were known.
      const settled = await settlePendingEnds({ store, cfg, now }, id);
      if (!settled || settled.failed > 0) {
        return Response.json({ error: "Call status is not available right now." }, { status: 503, headers: NO_STORE });
      }
      row = await store.get(id, now);
    }
    return Response.json(publicStatus(row), { headers: NO_STORE });
  } catch (e) {
    if (!(e instanceof CallStoreDown)) throw e;
    return Response.json({ error: "Call status is not available right now." }, { status: 503, headers: NO_STORE });
  }
}
