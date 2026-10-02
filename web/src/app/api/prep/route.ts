import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { preparePrep } from "@/lib/prep";
import { PrepRequestSchema } from "@/lib/prepTimeline";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// "Get ready for your procedure": the AI lists the prep steps, our code checks each quote and builds the timeline.
export async function POST(request: Request) {
  const refused = guard(request, "prep");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = PrepRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  try {
    // Nothing is recorded for this route: no counts, no text.
    return Response.json(await preparePrep(parsed.data));
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    // The kind of error only, never the request or message, so the paper can never land in the host logs.
    console.error("prep failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong reading that paper. Try again." }, { status: 500 });
  }
}
