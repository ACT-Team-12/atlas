import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { preparePrep } from "@/lib/prep";
import { PrepRequestSchema, PREP_DAILY_LIMIT } from "@/lib/prepTimeline";
import { secondsToUtcMidnight, takeDailySlot } from "@/lib/db";

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
  // A ceiling shared by every server instance, in Postgres (db/migrations/004_daily_usage.sql). It fails closed: if the
  // count can't be read or written (no database, the table missing, Postgres down), no paid model call is made.
  const slot = await takeDailySlot("prep", PREP_DAILY_LIMIT);
  if (slot.status === "unavailable") {
    return Response.json(
      { error: "ATLAS can't build prep timelines right now because its daily limit can't be checked. Please try again later, or call your clinic." },
      { status: 503, headers: { "x-atlas-limit": "unavailable", "Retry-After": "300" } },
    );
  }
  const limitHeader = { "x-atlas-limit": "shared-daily" };
  if (slot.status === "over") {
    const wait = secondsToUtcMidnight();
    return Response.json(
      { error: "ATLAS has built as many prep timelines as it can today. Please try again tomorrow, or call your clinic." },
      { status: 429, headers: { ...limitHeader, "Retry-After": String(wait) } },
    );
  }
  try {
    // Only the day's count is recorded (no text, no IP).
    return Response.json(await preparePrep(parsed.data), { headers: limitHeader });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status, headers: limitHeader });
    // The kind of error only, never the request or message, so the paper can never land in the host logs.
    console.error("prep failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong reading that paper. Try again." }, { status: 500, headers: limitHeader });
  }
}
