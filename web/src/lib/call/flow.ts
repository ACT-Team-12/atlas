import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { LANGUAGES } from "../schema";
import { verifySpeakToken } from "../speakToken";
import { MAX_SPEAK_CHARS, synthesize } from "../voice";
import { signTicket, subKey, type CallConfig, type CallTicket } from "./config";
import { canCallIn, codeNcco, goodbyeNcco, MAX_REPLAYS, planLengthSeconds, planNcco, type NccoAction } from "./ncco";
import { last4, parseUsPhone, phoneHash } from "./phone";
import { open, openText, seal } from "./seal";
import { CODE_ATTEMPTS, CODE_TTL_MS, dayKey, reserveSlots, SESSION_TTL_MS, WIPE, type CallStore, type SessionRow } from "./store";
import { placeCall } from "./vonage";

/**
 * "ATLAS calls you": the person types their own number on the plan screen and ticks consent.
 *  1. startCall: checks the plan's speak token (only text a real plan produced is ever spoken), the language and the
 *     number, then places a short CODE call that speaks a 4-digit code. That proves the person holds that phone.
 *  2. verifyAndCall: the person types the code (3 tries, 10 minutes); ATLAS then places the PLAN call, which plays the
 *     natural-voice MP3 of the plan's read-aloud text (Vonage's own voice when that is unavailable), with
 *     "press 1 to hear it again" up to twice.
 * Caps, each reserved before a call and never given back once a call was attempted: 3 code calls and 3 plan calls per
 * number per day, a site-wide daily cap (ATLAS_CALL_DAILY_CAP, default 40), and one live code per number.
 */
type Language = (typeof LANGUAGES)[number];

export const CODE_CALLS_PER_NUMBER = 3;
export const PLAN_CALLS_PER_NUMBER = 3;
const CODE_CALL_SECONDS = 60;

export type Deps = {
  store: CallStore;
  cfg: CallConfig;
  fetchImpl?: typeof fetch;
  now?: number;
  /** For tests: a fixed code. */
  code?: string;
  /** Natural voice; null when unavailable. Defaults to lib/voice.ts (ElevenLabs, cached, hourly fuse). */
  voice?: (text: string, language: Language) => Promise<ArrayBuffer | null>;
  /** The secret the plan's speak token was signed with (defaults to FEEDBACK_SECRET). */
  speakSecret?: string;
};

const defaultVoice = async (text: string, language: Language) => {
  try { return (await synthesize(text, language)).audio; } catch { return null; }
};

const codeHash = (secret: string, id: string, numberHash: string, code: string) =>
  createHmac("sha256", subKey(secret, "code")).update(`${id}.${numberHash}.${code}`).digest("hex");

const ticket = (cfg: CallConfig, t: Omit<CallTicket, "exp">, now: number) => encodeURIComponent(signTicket(cfg.secret, t, SESSION_TTL_MS, now));
const urls = (cfg: CallConfig) => `${cfg.baseUrl}/api/call`;

export type StartInput = { phone: unknown; consent: unknown; text: unknown; language: unknown; token: unknown };
export type StartOutcome =
  | { state: "calling"; id: string; last4: string }
  | { state: "no-consent" | "language" | "token" | "phone" | "in-flight" | "capped-code" | "capped-plan" | "capped-site" | "no-db" | "failed" };

export async function startCall(deps: Deps, input: StartInput): Promise<StartOutcome> {
  const { store, cfg } = deps;
  const now = deps.now ?? Date.now();
  if (input.consent !== true) return { state: "no-consent" };
  const language = LANGUAGES.find((l) => l === input.language);
  if (!language || !canCallIn(language)) return { state: "language" };
  const text = typeof input.text === "string" ? input.text : "";
  const token = typeof input.token === "string" ? input.token : "";
  if (!text.trim() || text.length > MAX_SPEAK_CHARS || !token || token.length > 200 || !verifySpeakToken(token, language, text, deps.speakSecret ?? process.env.FEEDBACK_SECRET, now)) return { state: "token" };
  const phone = parseUsPhone(input.phone);
  if (!phone) return { state: "phone" };

  await store.sweep(now);
  const hash = phoneHash(cfg.secret, phone);
  const day = dayKey(now);
  // Do not spend a code call on a number that could not get its plan call today anyway.
  const planUsed = await store.counter(`plan:${hash}:${day}`);
  if (planUsed === null) return { state: "no-db" };
  if (planUsed >= PLAN_CALLS_PER_NUMBER) return { state: "capped-plan" };

  const id = randomBytes(16).toString("base64url");
  const exp = now + SESSION_TTL_MS;
  const code = deps.code ?? String(randomInt(0, 10_000)).padStart(4, "0");
  const started = await store.startCode({
    id, phone_hash: hash, last4: last4(phone), language,
    code_hash: codeHash(cfg.secret, id, hash, code), code_expires_at: new Date(now + CODE_TTL_MS),
    sealed_phone: seal(cfg.secret, "phone", id, exp, phone),
    sealed_text: seal(cfg.secret, "text", id, exp, text),
    sealed_token: seal(cfg.secret, "token", id, exp, token),
    expires_at: new Date(exp),
  }, now);
  if (started === "in-flight") return { state: "in-flight" };
  if (started === "error") return { state: "no-db" };

  const r = await reserveSlots(store, [{ key: `code:${hash}:${day}`, cap: CODE_CALLS_PER_NUMBER }, { key: `site:${day}`, cap: cfg.siteDailyCap }], now);
  if (!r.ok) {
    await store.drop(id);
    return { state: r.refused === 0 ? "capped-code" : "capped-site" };
  }
  const placed = await placeCall({
    applicationId: cfg.applicationId, privateKey: cfg.privateKey, to: phone, from: cfg.from,
    ncco: codeNcco(code, language), eventUrl: `${urls(cfg)}/event?t=${ticket(cfg, { k: id, p: "event", c: "code" }, now)}`,
    lengthTimer: CODE_CALL_SECONDS,
  }, deps.fetchImpl);
  if (!placed.ok) {
    // The slots stay spent (the phone may have rung). Error kind only, never the number.
    console.error("code call failed", placed.error.slice(0, 120));
    await store.drop(id);
    return { state: "failed" };
  }
  await store.update(id, { code_status: "placed" }, ["code"]);
  return { state: "calling", id, last4: last4(phone) };
}

export type VerifyOutcome =
  | { state: "calling"; last4: string; mode: "stream" | "talk" }
  | { state: "wrong"; attemptsLeft: number }
  | { state: "expired" | "token" | "capped-plan" | "capped-site" | "failed" };

export async function verifyAndCall(deps: Deps, input: { id: unknown; code: unknown }): Promise<VerifyOutcome> {
  const { store, cfg } = deps;
  const now = deps.now ?? Date.now();
  if (typeof input.id !== "string" || input.id.length > 64) return { state: "expired" };
  const id = input.id;
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^\d{4}$/.test(code)) return { state: "wrong", attemptsLeft: CODE_ATTEMPTS };
  const row = await store.takeAttempt(id, now);
  if (!row || !row.code_hash) return { state: "expired" };
  const want = Buffer.from(row.code_hash, "hex");
  const got = Buffer.from(codeHash(cfg.secret, id, row.phone_hash, code), "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    const left = CODE_ATTEMPTS - row.attempts;
    if (left <= 0) await store.update(id, { ...WIPE, phase: "expired" }, ["code"]);
    return left > 0 ? { state: "wrong", attemptsLeft: left } : { state: "expired" };
  }
  // Exactly one request moves a session past its code.
  if (!(await store.update(id, { phase: "calling", code_hash: null }, ["code"]))) return { state: "expired" };
  const fail = async (state: "token" | "capped-plan" | "capped-site" | "failed", note: string) => {
    await store.update(id, { ...WIPE, phase: "failed", note });
    return { state } as const;
  };

  const language = LANGUAGES.find((l) => l === row.language);
  const phone = parseUsPhone(openText(cfg.secret, "phone", id, row.sealed_phone, now));
  const text = openText(cfg.secret, "text", id, row.sealed_text, now);
  const token = openText(cfg.secret, "token", id, row.sealed_token, now);
  if (!language || !phone || !text || !token) return fail("failed", "session data could not be opened");
  // The call can only ever read text a real plan produced: the token is checked again right before it is spoken.
  if (!verifySpeakToken(token, language, text, deps.speakSecret ?? process.env.FEEDBACK_SECRET, now)) return fail("token", "plan token no longer valid");

  const day = dayKey(now);
  const r = await reserveSlots(store, [{ key: `plan:${row.phone_hash}:${day}`, cap: PLAN_CALLS_PER_NUMBER }, { key: `site:${day}`, cap: cfg.siteDailyCap }], now);
  if (!r.ok) return fail(r.refused === 0 ? "capped-plan" : "capped-site", r.refused === 0 ? "number cap" : "site cap");

  const audio = await (deps.voice ?? defaultVoice)(text, language).catch(() => null);
  const bytes = audio && audio.byteLength > 1000 ? Buffer.from(audio) : null;
  const exp = row.expires_at.getTime();
  if (bytes && !(await store.update(id, { sealed_audio: seal(cfg.secret, "audio", id, exp, bytes), plan_mode: "stream" }, ["calling"]))) {
    return fail("failed", "audio could not be stored");
  }
  const mode = bytes ? "stream" : "talk";
  const base = urls(cfg);
  const ncco = planNcco({
    text, language, replays: 0,
    audioUrl: bytes ? `${base}/audio?t=${ticket(cfg, { k: id, p: "audio" }, now)}` : null,
    inputUrl: `${base}/input?t=${ticket(cfg, { k: id, p: "input", n: 0 }, now)}`,
  });
  const placed = await placeCall({
    applicationId: cfg.applicationId, privateKey: cfg.privateKey, to: phone, from: cfg.from, ncco,
    eventUrl: `${base}/event?t=${ticket(cfg, { k: id, p: "event", c: "plan" }, now)}`,
    lengthTimer: planLengthSeconds({ audioBytes: bytes?.byteLength ?? null, textChars: text.length }),
  }, deps.fetchImpl);
  if (!placed.ok) {
    console.error("plan call failed", placed.error.slice(0, 120));
    return fail("failed", "the plan call could not be placed");
  }
  await store.update(id, { plan_status: "placed", plan_mode: mode }, ["calling"]);
  return { state: "calling", last4: row.last4, mode };
}

/** Vonage call statuses, in order; a later status never moves back to an earlier one. */
const RANK: Record<string, number> = { placed: 0, started: 1, ringing: 2, answered: 3, completed: 4, busy: 4, cancelled: 4, failed: 4, rejected: 4, timeout: 4, unanswered: 4 };
export const MISSED = new Set(["busy", "cancelled", "failed", "rejected", "timeout", "unanswered"]);

/** A Vonage event for one of a session's two calls. Ending the plan call wipes everything sensitive. */
export async function handleEvent(deps: Pick<Deps, "store" | "now">, t: CallTicket, status: unknown): Promise<void> {
  if (typeof status !== "string" || !(status in RANK) || (t.c !== "code" && t.c !== "plan")) return;
  const now = deps.now ?? Date.now();
  const row = await deps.store.get(t.k, now);
  if (!row) return;
  const field = t.c === "code" ? "code_status" : "plan_status";
  const current = row[field];
  if (current && (RANK[current] ?? -1) >= RANK[status]) return;
  if (t.c === "code") {
    // A code call nobody picked up ends the session; the person can ask for a new one.
    if (MISSED.has(status)) await deps.store.update(t.k, { ...WIPE, code_status: status, phase: "code_missed" }, ["code"]);
    else await deps.store.update(t.k, { code_status: status });
    return;
  }
  if (RANK[status] === 4) await deps.store.update(t.k, { ...WIPE, plan_status: status, phase: "done" });
  else await deps.store.update(t.k, { plan_status: status });
}

/** Keypad input after the plan: "1" plays it again, at most MAX_REPLAYS times; anything else says goodbye. */
export async function handleInput(deps: Pick<Deps, "store" | "cfg" | "now">, t: CallTicket, digits: unknown): Promise<NccoAction[]> {
  const now = deps.now ?? Date.now();
  const row = await deps.store.get(t.k, now);
  const language = LANGUAGES.find((l) => l === row?.language) ?? "English";
  const n = (t.n ?? 0) + 1;
  if (digits !== "1" || n > MAX_REPLAYS || !row || row.phase !== "calling") return goodbyeNcco(language);
  const text = openText(deps.cfg.secret, "text", t.k, row.sealed_text, now);
  if (!text) return goodbyeNcco(language);
  const base = urls(deps.cfg);
  return planNcco({
    text, language, replays: n,
    audioUrl: row.has_audio ? `${base}/audio?t=${ticket(deps.cfg, { k: t.k, p: "audio" }, now)}` : null,
    inputUrl: `${base}/input?t=${ticket(deps.cfg, { k: t.k, p: "input", n }, now)}`,
  });
}

/** The MP3 Vonage streams into the call, opened from Postgres so it works on any server instance. */
export async function audioFor(deps: Pick<Deps, "store" | "cfg" | "now">, t: CallTicket): Promise<Buffer | null> {
  const now = deps.now ?? Date.now();
  const row = await deps.store.get(t.k, now);
  if (!row || row.phase !== "calling") return null;
  return open(deps.cfg.secret, "audio", t.k, await deps.store.getAudio(t.k, now), now);
}

/** What the person's own page may see: never the number (last 4 only), never the text. */
export function publicStatus(row: SessionRow | null) {
  if (!row) return { phase: "gone" as const };
  return {
    phase: row.phase, last4: row.last4, code_status: row.code_status, plan_status: row.plan_status, plan_mode: row.plan_mode,
    attempts_left: Math.max(0, CODE_ATTEMPTS - row.attempts),
  };
}
