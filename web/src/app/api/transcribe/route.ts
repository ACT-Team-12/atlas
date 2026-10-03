import { clientIp, guard } from "@/lib/guard";
import { LANGUAGES } from "@/lib/schema";
import { budgetReady, usageStore } from "@/lib/sttUsage";
import {
  answerAloud, audioType, MAX_AUDIO_BYTES, PROVIDER_NAME, readCapped, sttProvider, TranscribeError, transcribeEnabled, transcribeLanguages, verifyQuizToken,
} from "@/lib/transcribe";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const off = () => Response.json({ error: "Speaking your answer is off right now. Tap your answer instead." }, { status: 503 });

/** Whether "Say your answer" is on, for which languages, and who turns speech into text. Off means no mic anywhere. */
export async function GET() {
  const enabled = transcribeEnabled() && (await budgetReady());
  const provider = enabled ? sttProvider() : null;
  return Response.json(
    { enabled, languages: enabled ? transcribeLanguages() : [], provider: provider ? PROVIDER_NAME[provider] : null },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Body: the raw recording (audio/webm with Opus, or audio/mp4 with AAC; at most 512 KB and 35 s, both measured).
 * Query: language and token (the quiz token /api/understand issued). Returns { transcript } and nothing else.
 * Every check that costs nothing runs first; the shared budget is reserved only for a valid recording.
 */
export async function POST(request: Request) {
  const refused = guard(request, "transcribe");
  if (refused) return refused;
  if (!transcribeEnabled()) return off();
  const store = usageStore();
  if (!store) return off();

  const url = new URL(request.url);
  const language = url.searchParams.get("language") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!(LANGUAGES as readonly string[]).includes(language)) return Response.json({ error: "Unknown language." }, { status: 400 });
  const lang = language as (typeof LANGUAGES)[number];
  // Only a quiz this server wrote, so this route is not a free speech-to-text service.
  if (!token || token.length > 200 || verifyQuizToken(token, lang) === null) {
    return Response.json({ error: "Start the quiz again to answer out loud." }, { status: 403 });
  }
  const type = audioType(request.headers.get("content-type"));
  if (!type) return Response.json({ error: "Send the recording as audio." }, { status: 415 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_AUDIO_BYTES) return Response.json({ error: "That recording is too long. Keep it under 20 seconds." }, { status: 413 });
  // The real limit: counted on the bytes actually received, while they stream in.
  const audio = await readCapped(request.body);
  if (!audio) return Response.json({ error: "That recording is too long. Keep it under 20 seconds." }, { status: 413 });
  if (audio.byteLength < 200) return Response.json({ error: "We didn't catch any sound. Try again." }, { status: 400 });

  try {
    const transcript = await answerAloud({ audio, type, language: lang, token, ip: clientIp(request), store });
    return Response.json({ transcript }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof TranscribeError) return Response.json({ error: e.message }, { status: e.status });
    // Kind of error only, never the audio or the words.
    console.error("transcribe failed", e instanceof Error ? e.name : typeof e);
    return Response.json({ error: "We couldn't hear that. Try again, or tap your answer." }, { status: 500 });
  }
}
