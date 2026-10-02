import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { readLabPhoto, ResultsReadRequestSchema } from "@/lib/results";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Copies a photo or screenshot of lab results into text for the person to check. Nothing is judged here.
export async function POST(request: Request) {
  const refused = guard(request, "results-read");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = ResultsReadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    // Nothing is recorded for this route: no counts, no image, no text.
    return Response.json(await readLabPhoto(parsed.data));
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    // Log the kind of error only, never the request or message, so a photo or its text can never land in the host logs.
    console.error("results read failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong reading that photo. Try again." }, { status: 500 });
  }
}
