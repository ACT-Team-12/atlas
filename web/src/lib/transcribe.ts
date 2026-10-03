import { createHmac, timingSafeEqual } from "node:crypto";
import { LANGUAGES } from "./schema";

/**
 * "Say your answer" for the teach-back quiz: speech to text, server only.
 *
 * Some people can't type or read well enough to answer comfortably, so they can say the answer instead. The audio
 * goes to one speech-to-text provider once and only the transcript comes back. ATLAS never stores or logs the audio
 * or the words; errors are logged by kind only. Provider, in order:
 *   1. Deepgram (nova-3) when DEEPGRAM_API_KEY is set, with its Model Improvement Program opt-out (mip_opt_out=true).
 *      Docs checked 2026-10-02: POST https://api.deepgram.com/v1/listen, "Authorization: Token <key>", smart_format,
 *      mip_opt_out; transcript at results.channels[0].alternatives[0].transcript.
 *   2. Otherwise Vercel AI Gateway (no key: the project's OIDC token), model spacexai/grok-stt, restricted to
 *      zero-data-retention providers (zeroDataRetention + disallowPromptTraining). Every OpenAI, Google and Fish
 *      transcription model on the gateway refused ZDR when probed on 2026-10-02; grok-stt accepted it and returned
 *      correct text for WebM/Opus and MP4/AAC clips in English, Spanish, Vietnamese, Korean, Chinese and French.
 * ATLAS_STT_DISABLED=1 turns both off.
 *
 * Paid per second of audio, so the route only serves a quiz /api/understand issued (a signed quiz token), and
 * three fuses sit on top of the per-IP guard: uses per token, audio seconds per hour, audio seconds per day.
 */
export const STT_MODEL = "nova-3";
export const GATEWAY_STT_MODEL = "spacexai/grok-stt";
/** Deepgram nova-3 language codes. Amharic has no Deepgram model and was not verified on the gateway, so its quiz keeps tapping only. */
export const STT_LANG: Partial<Record<(typeof LANGUAGES)[number], string>> = {
  English: "en", Spanish: "es", Vietnamese: "vi", Korean: "ko", Chinese: "zh-CN", French: "fr",
};
export type SttProvider = "deepgram" | "gateway";
/** Which provider "Say your answer" uses here, or null when it is off. */
export function sttProvider(env: Record<string, string | undefined> = process.env): SttProvider | null {
  if (/^(1|true|yes)$/i.test(env.ATLAS_STT_DISABLED ?? "")) return null;
  if (env.DEEPGRAM_API_KEY) return "deepgram";
  // On Vercel the gateway authenticates with the project's OIDC token; locally `vercel env pull` provides one.
  if (env.VERCEL === "1" || env.VERCEL_OIDC_TOKEN || env.AI_GATEWAY_API_KEY) return "gateway";
  return null;
}
export const PROVIDER_NAME: Record<SttProvider, string> = { deepgram: "Deepgram", gateway: "xAI (Grok speech-to-text) through Vercel AI Gateway" };
/** A 20 s browser recording is about 80 KB (WebM/Opus at 32 kbps) or up to about 320 KB (Safari MP4/AAC). */
export const MAX_AUDIO_BYTES = 512_000;
/** The quiz records 20 s; anything the provider says is longer than this is refused, not returned. */
export const MAX_AUDIO_SECONDS = 35;
/**
 * The fuse never trusts a length it has not measured: each call reserves the most audio its byte count could hold
 * (Opus goes as low as 6 kbps), then settles to the length the provider reports. So a low-bitrate file cannot
 * carry hours of billable audio past the hourly or daily fuse.
 */
const MIN_BITS_PER_SECOND = 6_000;
export const reserveFor = (bytes: number) => Math.max(30, Math.ceil((bytes * 8) / MIN_BITS_PER_SECOND));
/** Browsers record WebM/Opus (Chrome, Firefox, Android) or MP4/AAC (Safari); both providers read both containers. */
export const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const;
export const QUIZ_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
/** Three answers per question at most is plenty; a quiz has up to 20 questions. */
export const USES_PER_TOKEN = 40;
/** Per server instance. Each call reserves reserveFor(bytes) up front, then settles to the length the provider reports. */
export const HOURLY_AUDIO_SECONDS = 1_800;
export const DAILY_AUDIO_SECONDS = 9_000;

export class TranscribeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** On only with a provider and the token secret: otherwise no mic button anywhere. */
export function transcribeEnabled(): boolean {
  return sttProvider() !== null && Boolean(process.env.FEEDBACK_SECRET);
}
export const transcribeLanguages = () => LANGUAGES.filter((l) => STT_LANG[l]);

// ---- Quiz token: proves the recording belongs to a quiz this server wrote, in this language. ----
const b64 = (b: Buffer) => b.toString("base64url");
const sign = (secret: string, payload: string) => b64(createHmac("sha256", secret).update(`quiz.${payload}`).digest());

export function issueQuizToken(language: string, secret = process.env.FEEDBACK_SECRET, now = Date.now()): string | null {
  if (!secret) return null;
  const t = String(now);
  return `${t}.${sign(secret, `${t}.${language.length}:${language}`)}`;
}

export function verifyQuizToken(token: string, language: string, secret = process.env.FEEDBACK_SECRET, now = Date.now()): boolean {
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [t, sig] = parts;
  const at = Number(t);
  if (!/^\d+$/.test(t) || !Number.isFinite(at) || at > now + 60_000 || now - at > QUIZ_TOKEN_TTL_MS) return false;
  const expected = Buffer.from(sign(secret, `${t}.${language.length}:${language}`));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ---- Fuses (per server instance, in memory) ----
const uses = new Map<string, number>();
const USES_MAX_KEYS = 5000;
let hourly = { hour: -1, used: 0 };
let daily = { day: -1, used: 0 };

/** Counts one use of this quiz token; false once it has been used USES_PER_TOKEN times. */
export function chargeToken(token: string): boolean {
  const n = uses.get(token) ?? 0;
  if (n >= USES_PER_TOKEN) return false;
  uses.delete(token);
  uses.set(token, n + 1);
  while (uses.size > USES_MAX_KEYS) uses.delete(uses.keys().next().value as string);
  return true;
}

/**
 * Adds seconds to both windows; refuses (and adds nothing) if either would go over. A negative value refunds.
 * force records usage that already happened (a settle), even past the fuse, so the next call is refused.
 */
export function chargeSeconds(seconds: number, now = Date.now(), force = false): boolean {
  const hour = Math.floor(now / 3_600_000), day = Math.floor(now / 86_400_000);
  if (hourly.hour !== hour) hourly = { hour, used: 0 };
  if (daily.day !== day) daily = { day, used: 0 };
  if (!force && seconds > 0 && (hourly.used + seconds > HOURLY_AUDIO_SECONDS || daily.used + seconds > DAILY_AUDIO_SECONDS)) return false;
  hourly.used = Math.max(0, hourly.used + seconds);
  daily.used = Math.max(0, daily.used + seconds);
  return true;
}
export const resetTranscribeStateForTests = () => { uses.clear(); hourly = { hour: -1, used: 0 }; daily = { day: -1, used: 0 }; };

export function audioType(contentType: string | null): (typeof AUDIO_TYPES)[number] | null {
  const base = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return (AUDIO_TYPES as readonly string[]).includes(base) ? (base as (typeof AUDIO_TYPES)[number]) : null;
}

/** Reads at most `limit` bytes; null when the body is larger, so an oversize upload is never buffered whole. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, limit = MAX_AUDIO_BYTES): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

const BUSY = "Speaking answers is busy. Tap your answer instead.";
const UNHEARD = "We couldn't hear that. Try again, or tap your answer.";

/** Sends the recording to the provider and returns only the transcript text. */
export async function transcribe(audio: Uint8Array, type: string, language: (typeof LANGUAGES)[number], now = Date.now()): Promise<string> {
  const code = STT_LANG[language];
  if (!code) throw new TranscribeError(`Speaking your answer isn't available in ${language} yet. Tap your answer instead.`, 422);
  const provider = sttProvider();
  if (!provider) throw new TranscribeError("Speaking your answer is off right now. Tap your answer instead.", 503);
  const reserved = reserveFor(audio.byteLength);
  if (!chargeSeconds(reserved, now)) throw new TranscribeError("Speaking answers is resting for a bit. Tap your answer instead.", 429);

  const settle = { seconds: reserved };
  let text: string;
  try {
    text = provider === "deepgram" ? await viaDeepgram(audio, type, code, settle) : await viaGateway(audio, settle);
  } finally {
    // Settle to what the provider actually heard. Forced: it already happened, so it counts even past the fuse.
    chargeSeconds(settle.seconds - reserved, now, true);
  }
  if (settle.seconds > MAX_AUDIO_SECONDS) throw new TranscribeError("That recording is too long. Keep it under 20 seconds.", 413);
  return text;
}

const seconds = (d: unknown) => (typeof d === "number" && Number.isFinite(d) && d >= 0 ? Math.ceil(d) : null);

async function viaDeepgram(audio: Uint8Array, type: string, code: string, settle: { seconds: number }): Promise<string> {
  const params = new URLSearchParams({ model: STT_MODEL, language: code, smart_format: "true", mip_opt_out: "true" });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": type },
    body: audio as BodyInit,
    signal: AbortSignal.timeout(20_000),
  });
  // Status only, never the audio or words.
  if (!res.ok) {
    console.error("deepgram failed", res.status);
    settle.seconds = 0;
    throw new TranscribeError(res.status === 401 || res.status === 402 || res.status === 429 ? BUSY : UNHEARD, 502);
  }
  const json = (await res.json()) as { metadata?: { duration?: number }; results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
  settle.seconds = seconds(json.metadata?.duration) ?? settle.seconds;
  const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof transcript !== "string") throw new TranscribeError(UNHEARD, 502);
  return transcript.trim();
}

async function viaGateway(audio: Uint8Array, settle: { seconds: number }): Promise<string> {
  const { gateway, transcribe: run } = await import("ai");
  let result;
  try {
    result = await run({
      model: gateway.transcription(GATEWAY_STT_MODEL),
      audio,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
      // Only providers with a zero-data-retention agreement that do not train on the input.
      providerOptions: { gateway: { zeroDataRetention: true, disallowPromptTraining: true } },
    });
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    console.error("gateway stt failed", e instanceof Error ? e.name : typeof e, status ?? "");
    throw new TranscribeError(status === 401 || status === 402 || status === 403 || status === 429 ? BUSY : UNHEARD, 502);
  }
  settle.seconds = seconds(result.durationInSeconds) ?? settle.seconds;
  if (typeof result.text !== "string") throw new TranscribeError(UNHEARD, 502);
  return result.text.trim();
}
