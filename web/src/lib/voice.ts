import { createHash } from "node:crypto";
import { z } from "zod";
import { LANGUAGES } from "./schema";

/**
 * Natural read-aloud voice (ElevenLabs), server only. Browser voices are missing or robotic for several of our
 * languages on many phones. Amharic has no ElevenLabs voice, so the page keeps the phone's own voice for it.
 * The text is never logged or stored; audio is cached in memory by a hash of language + text so a judge replaying
 * the sample does not spend the monthly character allowance twice. A phone call (`keep: false`) bypasses that cache
 * and the shared in-flight request entirely, and evicts any copy of the same text before and after its own request,
 * so the call's only copy is the encrypted one deleted when the call ends (lib/call).
 */
export const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah": warm, reassuring, premade
export const VOICE_MODEL = "eleven_flash_v2_5";
/** ISO 639-1 codes ElevenLabs accepts for this model. A language missing here uses the phone's voice. */
export const VOICE_LANG: Partial<Record<(typeof LANGUAGES)[number], string>> = {
  English: "en", Spanish: "es", Vietnamese: "vi", Korean: "ko", Chinese: "zh", French: "fr",
};
export const MAX_SPEAK_CHARS = 4000; // a Spanish plan built from a paper runs about 2,000 to 3,000 characters

export const SpeakRequestSchema = z.object({
  // Not trimmed: the token signs the exact text the plan produced.
  text: z.string().min(1).max(MAX_SPEAK_CHARS).refine((t) => t.trim().length > 0, "Send some text."),
  language: z.enum(LANGUAGES).default("English"),
  /** Issued by /api/plan for exactly this text and language (speakToken.ts). */
  token: z.string().min(1).max(200),
});

export class VoiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const CACHE_MAX = 40;
const cache = new Map<string, ArrayBuffer>();
// Identical requests while one is in flight share it, so a double tap or a replay is one paid call, not two.
const inflight = new Map<string, Promise<ArrayBuffer>>();
// Phone calls per text in progress, and when (in `seq` order) the last one for a text started (see keep: false). A page
// request that overlaps a call for the same text does not cache its result.
const calls = new Map<string, number>();
const callStarted = new Map<string, number>();
let seq = 0;
// A fuse per server instance on top of the per-plan token: at most this many paid characters per hour.
export const HOURLY_CHAR_BUDGET = 40_000;
let budget = { hour: -1, used: 0 };
export function chargeBudget(chars: number, now = Date.now()): boolean {
  const hour = Math.floor(now / 3_600_000);
  if (budget.hour !== hour) budget = { hour, used: 0 };
  if (budget.used + chars > HOURLY_CHAR_BUDGET) return false;
  budget.used += chars;
  return true;
}
export const resetVoiceStateForTests = () => { cache.clear(); inflight.clear(); calls.clear(); callStarted.clear(); budget = { hour: -1, used: 0 }; };
// Length-prefixed, never joined on a separator: free text can contain any separator and collide.
export const cacheKey = (language: string, text: string) => createHash("sha256").update(`${language.length}:${language}${text.length}:${text}`).digest("hex");

export async function synthesize(text: string, language: (typeof LANGUAGES)[number], opts: { keep?: boolean } = {}): Promise<{ audio: ArrayBuffer; cached: boolean }> {
  const keep = opts.keep ?? true;
  const code = VOICE_LANG[language];
  if (!code) throw new VoiceError(`No natural voice for ${language} yet. Using your phone's voice.`, 422);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new VoiceError("Natural voice is off. Using your phone's voice.", 503);

  const k = cacheKey(language, text);
  if (!keep) {
    cache.delete(k);
    if (!chargeBudget(text.length)) throw new VoiceError("Natural voice is resting for a bit. Using your phone's voice.", 429);
    calls.set(k, (calls.get(k) ?? 0) + 1);
    callStarted.set(k, ++seq);
    try { return { audio: await vendor(key, code, text), cached: false }; } finally {
      const n = (calls.get(k) ?? 1) - 1;
      if (n > 0) calls.set(k, n); else calls.delete(k);
      if (!calls.has(k) && !inflight.has(k)) callStarted.delete(k);
      cache.delete(k); // a page read-aloud of the same text that finished meanwhile must not keep it either
    }
  }
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); return { audio: hit, cached: true }; } // refresh LRU order
  const pending = inflight.get(k);
  if (pending) return { audio: await pending, cached: true };
  if (!chargeBudget(text.length)) throw new VoiceError("Natural voice is resting for a bit. Using your phone's voice.", 429);

  const began = ++seq;
  const job = vendor(key, code, text);
  inflight.set(k, job);
  let audio: ArrayBuffer;
  try { audio = await job; } finally {
    // removed here, not in a .finally on the job, so a call's cleanup can never run between this and the check below
    if (inflight.get(k) === job) inflight.delete(k);
  }
  const overlapped = calls.has(k) || (callStarted.get(k) ?? 0) > began;
  if (!calls.has(k)) callStarted.delete(k);
  if (overlapped) return { audio, cached: false };
  cache.set(k, audio);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return { audio, cached: false };
}

async function vendor(key: string, code: string, text: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: VOICE_MODEL, language_code: code, voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(30_000),
  });
  // Status only, never the text: a 401 or 429 here means the key or the monthly allowance needs a person.
  if (!res.ok) { console.error("elevenlabs failed", res.status); throw new VoiceError(res.status === 401 || res.status === 429 ? "Natural voice is busy. Using your phone's voice." : "Natural voice failed. Using your phone's voice.", 502); }
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 1000) throw new VoiceError("Natural voice returned no audio. Using your phone's voice.", 502);
  return audio;
}
