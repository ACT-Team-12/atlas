import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { MeaningRequestSchema, checkMeaning } from "@/lib/meaning";
import { guardMeaning } from "@/lib/phiGuard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = guard(request, "meaning");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = MeaningRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  try {
    // The steps' quotes and explanations are shielded for the AI checker (phiGuard.ts).
    return Response.json(await guardMeaning(parsed.data, (req) => checkMeaning(req, request.signal)));
  } catch (e) {
    // The person cleared the paper, deleted the plan or read a new one: nobody is waiting, so nothing is logged.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    // Log the kind of error only, never the request or message, so a paper can never land in the host logs.
    console.error("meaning failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "The double-check is not available right now." }, { status: 500 });
  }
}
