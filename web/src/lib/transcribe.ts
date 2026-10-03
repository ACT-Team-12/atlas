import { createHmac, timingSafeEqual } from "node:crypto";
import { LANGUAGES } from "./schema";
import { measureAudio } from "./audioMeasure";
import {
  CLIENT_DAILY_SECONDS, CLIENT_HOURLY_SECONDS, clientKey, envPrefix, SITE_DAILY_SECONDS, SITE_HOURLY_SECONDS, tokenKey, type Ask, type UsageStore,
} from "./sttUsage";

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
 * Paid per second of audio, so the route only serves a quiz /api/understand issued (a signed quiz token), and every
 * limit in sttUsage.ts (uses per token, audio-seconds per client and for the whole site, per hour and per day) is
 * reserved in one shared all-or-nothing step BEFORE the provider is called, sized by the length measured from the
 * file itself (over 35 s is refused unsent), then settled to the length the provider reports.
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
/** Opus can go as low as 6 kbps, so no honest file holds more seconds than bytes x 8 / 6,000. */
const MIN_BITS_PER_SECOND = 6_000;
/** Browsers record WebM/Opus (Chrome, Firefox, Android) or MP4/AAC (Safari); both providers read both containers. */
export const AUDIO_TYPES = ["audio/webm", "audio/mp4"] as const;
export const QUIZ_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
/** Uses per quiz token: one answer per question plus a few retries. A quiz has 1 to 20 questions. */
export const usesFor = (questions: number) => Math.min(20, Math.max(1, Math.floor(questions))) + 3;

export class TranscribeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** On only with a provider and the token secret: otherwise no mic button anywhere. */
export function transcribeEnabled(): boolean {
  return sttProvider() !== null && Boolean(process.env.FEEDBACK_SECRET);
}
export const transcribeLanguages = () => LANGUAGES.filter((l) => STT_LANG[l]);

// ---- Quiz token: proves the recording belongs to a quiz this server wrote, in this language, with this many questions. ----
const b64 = (b: Buffer) => b.toString("base64url");
const sign = (secret: string, payload: string) => b64(createHmac("sha256", secret).update(`quiz.${payload}`).digest());

export function issueQuizToken(language: string, questions: number, secret = process.env.FEEDBACK_SECRET, now = Date.now()): string | null {
  if (!secret) return null;
  const t = String(now), n = String(Math.min(20, Math.max(1, Math.floor(questions))));
  return `${t}.${n}.${sign(secret, `${t}.${n}.${language.length}:${language}`)}`;
}

/** The question count the token was issued for, or null when it is not genuine, fresh, and for this language. */
export function verifyQuizToken(token: string, language: string, secret = process.env.FEEDBACK_SECRET, now = Date.now()): number | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [t, n, sig] = parts;
  const at = Number(t);
  if (!/^\d+$/.test(t) || !/^\d{1,2}$/.test(n) || !Number.isFinite(at) || at > now + 60_000 || now - at > QUIZ_TOKEN_TTL_MS) return null;
  const expected = Buffer.from(sign(secret, `${t}.${n}.${language.length}:${language}`));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected) ? Number(n) : null;
}

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

const TOO_LONG = "That recording is too long. Keep it under 20 seconds.";

/**
 * One spoken answer: reserve every limit at once (shared, before any paid call), transcribe, settle.
 * Who pays for a failure: a failure before the audio left this server (the connection was refused, the host was not
 * found) returns the site's reservation, because nothing could have been billed. Once the audio was sent, a failure
 * (a timeout, an error reply, an unusable reply) may still be billed, so the site keeps its reservation and those
 * seconds stay inside the site caps. Either way the failure stays on that client's own count, so bad input from one
 * client cannot drain everyone's budget.
 */
export async function answerAloud(req: {
  audio: Uint8Array; type: string; language: (typeof LANGUAGES)[number]; token: string; ip: string; now?: number; store: UsageStore;
}): Promise<string> {
  const now = req.now ?? Date.now();
  const code = STT_LANG[req.language];
  if (!code) throw new TranscribeError(`Speaking your answer isn't available in ${req.language} yet. Tap your answer instead.`, 422);
  const provider = sttProvider();
  if (!provider) throw new TranscribeError("Speaking your answer is off right now. Tap your answer instead.", 503);
  const questions = verifyQuizToken(req.token, req.language, undefined, now);
  if (questions === null) throw new TranscribeError("Start the quiz again to answer out loud.", 403);

  const p = envPrefix(), hour = Math.floor(now / 3_600_000), day = Math.floor(now / 86_400_000);
  // Measured from the file (audioMeasure.ts), never from the sender's Content-Type or timestamps.
  const measured = measureAudio(req.audio);
  if (!measured || measured.container !== req.type) throw new TranscribeError("We couldn't read that recording. Try again, or tap your answer.", 415);
  if (measured.seconds > MAX_AUDIO_SECONDS) throw new TranscribeError(TOO_LONG, 413);
  // Backstop if the measurement and the provider's decoder ever disagree: also bound the length by what the bytes
  // could hold at Opus's lowest bitrate, and reserve the longer of the two, up to the 35 s the quiz allows.
  const byteBound = (req.audio.byteLength * 8) / MIN_BITS_PER_SECOND;
  const client = clientKey(req.ip), reserved = Math.max(1, Math.ceil(Math.min(MAX_AUDIO_SECONDS, Math.max(measured.seconds, byteBound))));
  const site = [{ bucket: `${p}gh`, win: hour }, { bucket: `${p}gd`, win: day }];
  const mine = [{ bucket: `${p}ch:${client}`, win: hour }, { bucket: `${p}cd:${client}`, win: day }];
  const asks: Ask[] = [
    { bucket: `${p}t:${tokenKey(req.token)}`, win: 0, amount: 1, cap: usesFor(questions), ttlSec: QUIZ_TOKEN_TTL_MS / 1000 + 3600 },
    { ...mine[0], amount: reserved, cap: CLIENT_HOURLY_SECONDS, ttlSec: 7_200 },
    { ...mine[1], amount: reserved, cap: CLIENT_DAILY_SECONDS, ttlSec: 172_800 },
    { ...site[0], amount: reserved, cap: SITE_HOURLY_SECONDS, ttlSec: 7_200 },
    { ...site[1], amount: reserved, cap: SITE_DAILY_SECONDS, ttlSec: 172_800 },
  ];
  let held;
  try {
    held = await req.store.reserve(asks, now);
  } catch (e) {
    // Fail closed for this request only: nothing was reserved, so nothing is left locked.
    console.error("stt budget unavailable", e instanceof Error ? e.name : typeof e);
    throw new TranscribeError("Speaking answers is busy. Tap your answer instead.", 503);
  }
  if (!held.ok) {
    const why = held.bucket.startsWith(`${p}t:`) ? "You've answered out loud a lot on this quiz. Tap your answer instead."
      : held.bucket.startsWith(`${p}c`) ? "You've used a lot of speaking time. Tap your answer instead, or try again later."
      : "Speaking answers is resting for a bit. Tap your answer instead.";
    throw new TranscribeError(why, 429);
  }

  // `sent` stays false only while the audio provably has not reached the provider.
  const settle = { seconds: reserved, sent: false };
  let text: string, failed = true;
  try {
    text = provider === "deepgram" ? await viaDeepgram(req.audio, req.type, code, settle) : await viaGateway(req.audio, settle);
    failed = false;
  } finally {
    const delta = settle.seconds - reserved;
    const fix = !failed
      ? [...site, ...mine].map((b) => ({ ...b, delta })) // what the provider actually heard, even past a cap
      : settle.sent
        ? site.map((b) => ({ ...b, delta })) // the audio went out and may be billed: the site keeps it (or what was heard)
        : site.map((b) => ({ ...b, delta: -reserved })); // never left this server, so never billed: the site gets it back
    await req.store.adjust(fix).catch((e) => console.error("stt budget settle failed", e instanceof Error ? e.name : typeof e));
  }
  if (settle.seconds > MAX_AUDIO_SECONDS) {
    // The provider heard more than we measured: a crafted file or a decoder difference. It is already counted above;
    // also use up this client's hourly and daily allowance so it cannot happen again from them today, and say so.
    console.error("stt overrun", provider, Math.round(settle.seconds));
    await req.store.adjust(mine.map((b, i) => ({ ...b, delta: i === 0 ? CLIENT_HOURLY_SECONDS : CLIENT_DAILY_SECONDS })))
      .catch((e) => console.error("stt budget settle failed", e instanceof Error ? e.name : typeof e));
    throw new TranscribeError(TOO_LONG, 413);
  }
  return text;
}

const seconds = (d: unknown) => (typeof d === "number" && Number.isFinite(d) && d >= 0 ? Math.ceil(d) : null);

/** Network error codes that mean the request never reached the provider, so nothing could have been billed. */
const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ERR_INVALID_URL", "UND_ERR_INVALID_ARG"]);
/**
 * True only when the error proves the audio never left this server (walks the `cause` chain for a pre-send code).
 * Anything else, including a timeout, a reset mid-upload or an error reply, counts as sent: it may be billed.
 */
export function failedBeforeSend(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 6; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && NOT_SENT_CODES.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

type Settle = { seconds: number; sent: boolean };

async function viaDeepgram(audio: Uint8Array, type: string, code: string, settle: Settle): Promise<string> {
  const params = new URLSearchParams({ model: STT_MODEL, language: code, smart_format: "true", mip_opt_out: "true" });
  let res: Response;
  try {
    res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": type },
      body: audio as BodyInit,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    settle.sent = !failedBeforeSend(e);
    console.error("deepgram unreachable", e instanceof Error ? e.name : typeof e, settle.sent ? "sent" : "not sent");
    throw new TranscribeError(UNHEARD, 502);
  }
  settle.sent = true; // a reply of any kind means the provider received the audio
  // Status only, never the audio or words.
  if (!res.ok) {
    console.error("deepgram failed", res.status);
    throw new TranscribeError(res.status === 401 || res.status === 402 || res.status === 429 ? BUSY : UNHEARD, 502);
  }
  const json = (await res.json()) as { metadata?: { duration?: number }; results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
  settle.seconds = seconds(json.metadata?.duration) ?? settle.seconds;
  const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof transcript !== "string") throw new TranscribeError(UNHEARD, 502);
  return transcript.trim();
}

async function viaGateway(audio: Uint8Array, settle: Settle): Promise<string> {
  const { gateway, transcribe: run } = await import("ai");
  let result;
  settle.sent = true; // from here the audio may reach the provider; only a provable pre-send failure clears this
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
    if (status === undefined && failedBeforeSend(e)) settle.sent = false;
    console.error("gateway stt failed", e instanceof Error ? e.name : typeof e, status ?? "");
    throw new TranscribeError(status === 401 || status === 402 || status === 403 || status === 429 ? BUSY : UNHEARD, 502);
  }
  settle.seconds = seconds(result.durationInSeconds) ?? settle.seconds;
  if (typeof result.text !== "string") throw new TranscribeError(UNHEARD, 502);
  return result.text.trim();
}
