import { after } from "next/server";
import { guard } from "@/lib/guard";
import { isTestRequest, recordEvent, surfaceOf } from "@/lib/db";
import { RequestSchema, type CarePlanResponse } from "@/lib/schema";
import { ExtractError, makeClient } from "@/lib/extract";
import { openModelStream, streamCarePlan } from "@/lib/extractStream";
import { encodeEvent, type ExtractEvent } from "@/lib/extractEvents";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Same as POST /api/extract, but answers as NDJSON so each verified step can be shown as soon as it
 * is ready. Same guard bucket, same validation, same logging rule, same usage record. The last
 * line is either {"type":"done","plan":...} (the exact body /api/extract returns) or an error.
 * The mobile apps keep using /api/extract; its contract does not change.
 */
export async function POST(request: Request) {
  const refused = guard(request, "extract");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const req = parsed.data;
  try {
    makeClient(); // fail fast with a plain JSON error if the server has no key
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const test = isTestRequest(request), surface = surfaceOf(request);
  let finished: (plan: CarePlanResponse | null) => void = () => {};
  const result = new Promise<CarePlanResponse | null>((r) => { finished = r; });
  // Recorded once, after the stream closes, and only for a finished read. Counts and timing only; the paper is never recorded.
  after(async () => {
    const plan = await result;
    if (!plan) return;
    await recordEvent({
      surface, kind: "read", language: req.language, reading_level: req.reading_level,
      source_kind: plan.source_kind, steps: plan.stats.grounded, held_back: plan.stats.refused, ms: plan.stats.ms,
    }, test);
  });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: ExtractEvent) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(encodeEvent(e))); } catch { open = false; }
      };
      try {
        const t0 = Date.now();
        const plan = await streamCarePlan(req, openModelStream(req, abort.signal), emit, t0);
        emit({ type: "done", plan });
        finished(plan);
      } catch (e) {
        finished(null);
        // The person cleared the paper or left: an expected end, so nothing is logged and no error is sent.
        if (abort.signal.aborted || request.signal.aborted) return;
        if (e instanceof ExtractError) emit({ type: "error", error: e.message, status: e.status });
        else {
          // Log the kind of error only, never the request or message, so a paper can never land in the host logs.
          console.error("extract stream failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
          emit({ type: "error", error: "Something went wrong reading that document. Try again.", status: 500 });
        }
      } finally {
        if (open) { open = false; try { controller.close(); } catch {} }
      }
    },
    cancel() {
      abort.abort();
      finished(null);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
