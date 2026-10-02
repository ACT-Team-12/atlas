import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { explainResults, ResultsRequestSchema } from "@/lib/results";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = guard(request, "results");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = ResultsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    // Nothing is recorded for this route: no counts, no text.
    return Response.json(await explainResults(parsed.data));
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    console.error("results failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong reading that report. Try again." }, { status: 500 });
  }
}
