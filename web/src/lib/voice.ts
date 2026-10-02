import { createHash } from "node:crypto";
import { z } from "zod";
import { LANGUAGES } from "./schema";

/**
 * Natural read-aloud voice (ElevenLabs), server only. Browser voices are missing or robotic for several of our
 * languages on many phones. Amharic has no ElevenLabs voice, so the page keeps the phone's own voice for it.
 * The text is never logged or stored; audio is cached in memory by a hash of language + text so a judge replaying
 * the sample does not spend the monthly character allowance twice.
 */
export const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah": warm, reassuring, premade
export const VOICE_MODEL = "eleven_flash_v2_5";
/** ISO 639-1 codes ElevenLabs accepts for this model. A language missing here uses the phone's voice. */
export const VOICE_LANG: Partial<Record<(typeof LANGUAGES)[number], string>> = {
  English: "en", Spanish: "es", Vietnamese: "vi", Korean: "ko", Chinese: "zh", French: "fr",
};
export const MAX_SPEAK_CHARS = 2500;

export const SpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEAK_CHARS),
  language: z.enum(LANGUAGES).default("English"),
});

export class VoiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const CACHE_MAX = 40;
const cache = new Map<string, ArrayBuffer>();
// Length-prefixed, never joined on a separator: free text can contain any separator and collide.
export const cacheKey = (language: string, text: string) => createHash("sha256").update(`${language.length}:${language}${text.length}:${text}`).digest("hex");

export async function synthesize(text: string, language: (typeof LANGUAGES)[number]): Promise<{ audio: ArrayBuffer; cached: boolean }> {
  const code = VOICE_LANG[language];
  if (!code) throw new VoiceError(`No natural voice for ${language} yet. Using your phone's voice.`, 422);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new VoiceError("Natural voice is off. Using your phone's voice.", 503);

  const k = cacheKey(language, text);
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); return { audio: hit, cached: true }; } // refresh LRU order

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: VOICE_MODEL, language_code: code, voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new VoiceError(res.status === 401 || res.status === 429 ? "Natural voice is busy. Using your phone's voice." : "Natural voice failed. Using your phone's voice.", 502);
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 1000) throw new VoiceError("Natural voice returned no audio. Using your phone's voice.", 502);
  cache.set(k, audio);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return { audio, cached: false };
}
