import { after } from "next/server";
import { guard } from "@/lib/guard";
import { isTestRequest, recordEvent, surfaceOf } from "@/lib/db";
import { PlanRequestSchema, buildPlan } from "@/lib/plan";
import { ExtractError } from "@/lib/extract";
import { issueFeedbackToken } from "@/lib/feedbackToken";
import { issueSpeakToken } from "@/lib/speakToken";
import { speechText } from "@/lib/speechText";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
  if (parsed.data.barriers.length === 0 && parsed.data.care.length === 0) {
    return Response.json({ error: "Pick at least one thing that gets in the way, or add your visit paper first." }, { status: 400 });
  }
  try {
    const plan = await buildPlan(parsed.data);
    const test = isTestRequest(request), surface = surfaceOf(request);
    // Barrier categories, counts and timing only; no ZIP, location or note is recorded.
    after(() => recordEvent({
      surface, kind: "plan", language: parsed.data.language, barriers: parsed.data.barriers,
      steps: plan.stats.steps, dropped_refs: plan.stats.dropped_refs, ms: plan.stats.ms,
    }, test));
    // A one-time token so the person who got this plan can rate it once (see feedbackToken.ts).
    // And one that lets this plan, and only this plan, be read in the natural voice (see speakToken.ts).
    return Response.json({ ...plan, feedback_token: issueFeedbackToken(), speak_token: issueSpeakToken(parsed.data.language, speechText(plan)) });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    // Log the kind of error only, never the request or message, so a paper can never land in the host logs.
    console.error("plan failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong building the plan. Try again." }, { status: 500 });
  }
}
