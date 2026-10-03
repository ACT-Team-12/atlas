import { guard } from "@/lib/guard";
import { ExtractError } from "@/lib/extract";
import { UnderstandRequestSchema, buildQuestions } from "@/lib/understand";
import { issueQuizToken } from "@/lib/transcribe";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = guard(request, "understand");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = UnderstandRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  try {
    // answer_token lets this quiz, and only a quiz this server wrote, use "Say your answer" (see transcribe.ts).
    return Response.json({ ...(await buildQuestions(parsed.data)), answer_token: issueQuizToken(parsed.data.language) });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ error: e.message }, { status: e.status });
    // Log the kind of error only, never the request or message, so a paper can never land in the host logs.
    console.error("understand failed", e instanceof Error ? e.name : typeof e, (e as { status?: number })?.status ?? "");
    return Response.json({ error: "Something went wrong writing the questions. Try again." }, { status: 500 });
  }
}
