import { guard } from "@/lib/guard";
import { LANGUAGES } from "@/lib/schema";
import {
  audioType, chargeToken, PROVIDER_NAME, sttProvider, MAX_AUDIO_BYTES, readCapped, transcribe, TranscribeError, transcribeEnabled, transcribeLanguages, verifyQuizToken,
} from "@/lib/transcribe";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Whether "Say your answer" is on, for which languages, and who turns speech into text. Off means no mic anywhere. */
export function GET() {
  const enabled = transcribeEnabled();
  const provider = enabled ? sttProvider() : null;
  return Response.json(
    { enabled, languages: enabled ? transcribeLanguages() : [], provider: provider ? PROVIDER_NAME[provider] : null },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Body: the raw recording (audio/webm, audio/mp4 or audio/ogg, at most 512 KB).
 * Query: language and token (the quiz token /api/understand issued). Returns { transcript } and nothing else.
 */
export async function POST(request: Request) {
  const refused = guard(request, "transcribe");
  if (refused) return refused;
  if (!transcribeEnabled()) return Response.json({ error: "Speaking your answer is off right now. Tap your answer instead." }, { status: 503 });

  const url = new URL(request.url);
  const language = url.searchParams.get("language") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!(LANGUAGES as readonly string[]).includes(language)) return Response.json({ error: "Unknown language." }, { status: 400 });
  const lang = language as (typeof LANGUAGES)[number];
  // Only a quiz this server wrote, so this route is not a free speech-to-text service.
  if (!token || token.length > 200 || !verifyQuizToken(token, lang)) {
    return Response.json({ error: "Start the quiz again to answer out loud." }, { status: 403 });
  }
  const type = audioType(request.headers.get("content-type"));
  if (!type) return Response.json({ error: "Send the recording as audio." }, { status: 415 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_AUDIO_BYTES) return Response.json({ error: "That recording is too long. Keep it under 20 seconds." }, { status: 413 });
  const audio = await readCapped(request.body);
  if (!audio) return Response.json({ error: "That recording is too long. Keep it under 20 seconds." }, { status: 413 });
  if (audio.byteLength < 200) return Response.json({ error: "We didn't catch any sound. Try again." }, { status: 400 });
  if (!chargeToken(token)) return Response.json({ error: "You've answered out loud a lot on this quiz. Tap your answer instead." }, { status: 429 });

  try {
    return Response.json({ transcript: await transcribe(audio, type, lang) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof TranscribeError) return Response.json({ error: e.message }, { status: e.status });
    // Kind of error only, never the audio or the words.
    console.error("transcribe failed", e instanceof Error ? e.name : typeof e);
    return Response.json({ error: "We couldn't hear that. Try again, or tap your answer." }, { status: 500 });
  }
}
