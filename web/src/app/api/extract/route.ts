import { after } from "next/server";
import { guard } from "@/lib/guard";
import { isTestRequest, recordEvent, surfaceOf } from "@/lib/db";
import { RequestSchema } from "@/lib/schema";
import { extractCarePlan, ExtractError } from "@/lib/extract";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
  try {
    const plan = await extractCarePlan(parsed.data, request.signal);
    const test = isTestRequest(request), surface = surfaceOf(request);
    // Counts and timing only; the paper itself is never recorded.
    after(() => recordEvent({
      surface, kind: "read", language: parsed.data.language, reading_level: parsed.data.reading_level,
      source_kind: plan.source_kind, steps: plan.stats.grounded, held_back: plan.stats.refused, ms: plan.stats.ms,
    }, test));
    return Response.json(plan);
  } catch (e) {
    // The person cleared the paper or left: nobody is waiting, so no error is logged and nothing is recorded.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    // Log the kind of error only, never the request or message, so a paper can never land in the host logs.
    console.error("extract failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong reading that document. Try again." }, { status: 500 });
  }
}
