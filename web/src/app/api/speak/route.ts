import { guard } from "@/lib/guard";
import { SpeakRequestSchema, synthesize, VoiceError } from "@/lib/voice";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Natural voice for "Read it out loud". Returns audio/mpeg, or a JSON error the page answers with the phone's voice. */
export async function POST(request: Request) {
  const refused = guard(request, "speak");
  if (refused) return refused;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const parsed = SpeakRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  try {
    const { audio, cached } = await synthesize(parsed.data.text, parsed.data.language);
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600", "x-atlas-voice-cache": cached ? "hit" : "miss" } });
  } catch (e) {
    if (e instanceof VoiceError) return Response.json({ error: e.message }, { status: e.status });
    // Kind of error only, never the text.
    console.error("speak failed", e instanceof Error ? e.name : typeof e);
    return Response.json({ error: "Natural voice failed. Using your phone's voice." }, { status: 500 });
  }
}
