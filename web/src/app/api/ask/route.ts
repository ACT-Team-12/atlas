import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { ASK_DAILY_LIMIT, AskRequestSchema, answerFromPaper, type AskResponse } from "@/lib/ask";
import { isUrgentQuestion } from "@/lib/askText";
import { secondsToUtcMidnight, takeDailySlot } from "@/lib/db";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// "Ask my paper": the AI may only point at the paper's own words; our code checks every quote (lib/ask.ts).
export async function POST(request: Request) {
  const refused = guard(request, "ask");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  // An emergency question never reaches the AI and never spends a slot: the page shows 911 / 211 guidance instead.
  if (isUrgentQuestion(parsed.data.question)) return Response.json({ kind: "urgent" } satisfies AskResponse);
  // A ceiling shared by every server instance, in Postgres (db/migrations/004_daily_usage.sql; "ask" is a new bucket
  // name in the existing table, no migration). Fails closed like /api/prep: no count, no paid model call.
  const slot = await takeDailySlot("ask", ASK_DAILY_LIMIT);
  if (slot.status === "unavailable") {
    return Response.json(
      { error: "ATLAS can't answer questions right now because its daily limit can't be checked. Please try again later, or ask your clinic or pharmacist." },
      { status: 503, headers: { "x-atlas-limit": "unavailable", "Retry-After": "300" } },
    );
  }
  const limitHeader = { "x-atlas-limit": "shared-daily" };
  if (slot.status === "over") {
    return Response.json(
      { error: "ATLAS has answered as many questions as it can today. Please try again tomorrow, or ask your clinic or pharmacist." },
      { status: 429, headers: { ...limitHeader, "Retry-After": String(secondsToUtcMidnight()) } },
    );
  }
  try {
    // Nothing is stored: not the question, not the paper, only the day's count.
    return Response.json(await answerFromPaper(parsed.data, request.signal), { headers: limitHeader });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status, headers: limitHeader });
    // The kind of error only, never the request or message, so a paper or question can never land in the host logs.
    console.error("ask failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong answering that. Try again." }, { status: 500, headers: limitHeader });
  }
}
