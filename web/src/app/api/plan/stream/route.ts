import { after } from "next/server";
import { guard } from "@/lib/guard";
import { entryOf, isTestRequest, recordEvent, surfaceOf } from "@/lib/db";
import { PlanRequestSchema, makePlanClient, preparePlan, type PlanResponse } from "@/lib/plan";
import { ExtractError } from "@/lib/extract";
import { openPlanStream, streamPlan } from "@/lib/planStream";
import { encodePlanEvent, type PlanEvent } from "@/lib/planEvents";
import { issueFeedbackToken } from "@/lib/feedbackToken";
import { issueSpeakToken } from "@/lib/speakToken";
import { paidSpeechText } from "@/lib/speechText";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Same as POST /api/plan, but answers as NDJSON so the person sees each checked step as soon as it is ready. Same
 * guard bucket, same validation, same logging rule, same usage record. The last line is either {"type":"done","plan":...}
 * (the exact body /api/plan returns, tokens included) or an error. The mobile apps keep using /api/plan.
 */
export async function POST(request: Request) {
  const refused = guard(request, "plan");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const req = parsed.data;
  if (req.barriers.length === 0 && req.care.length === 0) {
    return Response.json({ error: "Pick at least one thing that gets in the way, or add your visit paper first." }, { status: 400 });
  }
  try {
    makePlanClient(); // fail fast with a plain JSON error if the server has no key
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const test = isTestRequest(request), surface = surfaceOf(request), entry = entryOf(request);
  let finished: (plan: PlanResponse | null) => void = () => {};
  const result = new Promise<PlanResponse | null>((r) => { finished = r; });
  // Recorded once, after the stream closes, and only for a finished plan.
  // Barrier categories, counts and timing only; no ZIP, location or note is recorded.
  after(async () => {
    const plan = await result;
    if (!plan) return;
    await recordEvent({
      surface, kind: "plan", language: req.language, barriers: req.barriers,
      steps: plan.stats.steps, dropped_refs: plan.stats.dropped_refs, ms: plan.stats.ms, entry,
    }, test);
  });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: PlanEvent) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(encodePlanEvent(e))); } catch { open = false; }
      };
      try {
        const ctx = preparePlan(req);
        const plan = await streamPlan(ctx, openPlanStream(ctx, abort.signal), emit);
        // The same one-time tokens as /api/plan: rate this plan once, and read this plan's own text in the natural voice.
        emit({ type: "done", plan: { ...plan, feedback_token: issueFeedbackToken(), speak_token: issueSpeakToken(req.language, paidSpeechText(plan)) } });
        finished(plan);
      } catch (e) {
        finished(null);
        // The person changed an answer or left: an expected end, so nothing is logged and no error is sent.
        if (abort.signal.aborted || request.signal.aborted) return;
        if (e instanceof ExtractError) emit({ type: "error", error: e.message, status: e.status });
        else {
          // Log the kind of error only, never the request or message, so a paper can never land in the host logs.
          console.error("plan stream failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
          emit({ type: "error", error: "Something went wrong building the plan. Try again.", status: 500 });
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
