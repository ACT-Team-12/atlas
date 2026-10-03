import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { LANGUAGES } from "../schema";
import { verifySpeakToken } from "../speakToken";
import { MAX_SPEAK_CHARS, synthesize } from "../voice";
import { signTicket, subKey, type CallConfig, type CallTicket } from "./config";
import { canCallIn, codeNcco, GATE_TRIES, gateNcco, goodbyeNcco, MAX_REPLAYS, planLengthSeconds, planNcco, type NccoAction } from "./ncco";
import { last4, parseUsPhone, phoneHash } from "./phone";
import { open, openText, seal } from "./seal";
import { CallStoreDown, CODE_ATTEMPTS, CODE_TTL_MS, dayKey, END_PENDING, hourKey, reserveSlots, SESSION_TTL_MS, WIPE, type CallStore, type SessionRow } from "./store";
import { getCall, placeCall } from "./vonage";

/**
 * "ATLAS calls you": the person types their own number on the plan screen and ticks consent.
 *  1. startCall: checks the plan's speak token (only text a real plan produced is ever spoken), the language and the
 *     number, then places a short CODE call that speaks a 4-digit code. That proves the person holds that phone.
 *  2. verifyAndCall: the person types the code (3 tries, 10 minutes); ATLAS then places the PLAN call, which plays the
 *     natural-voice MP3 of the plan's read-aloud text (Vonage's own voice when that is unavailable), with
 *     "press 1 to hear it again" up to twice. That call first asks for the same code on the keypad (gateInput), so
 *     voicemail or anyone else who answers hears no plan.
 * Accepted risk (a team decision, not an oversight): nothing proves the number is the person's own before the CODE
 * call, so someone can make ATLAS place a short call that says only a 4-digit code to another number. There is no
 * inbound opt-in and no captcha; the caps below bound it instead, and the page and /privacy say "Only enter your own
 * number". The plan itself is never spoken to anyone who cannot enter the code. Refusals that depend on the number's
 * history all get one answer before the code (messages.ts startRefusal); what remains observable is whether a call
 * was placed at all, which the number's owner also sees, as a ringing phone.
 * Caps, each reserved before a call and never given back once a call was attempted: 3 code calls and 3 plan calls per
 * number per day, at most 1 code call per number per 10 minutes, 4 code calls per caller (IP) per day, 10 code calls
 * per hour site-wide, a site-wide daily cap (ATLAS_CALL_DAILY_CAP, default 40), and one live code per number.
 * A plan's token can start code calls to ONE number only: the first number it calls is bound to it, so calling a
 * different number needs a new plan (a rate-limited, paid model call), never a replay of the same token.
 */
type Language = (typeof LANGUAGES)[number];

export const CODE_CALLS_PER_NUMBER = 3;
export const PLAN_CALLS_PER_NUMBER = 3;
/** Code calls one caller (by IP, counted in Postgres so every server instance agrees) may start per day. */
export const CODE_CALLS_PER_IP = 4;
/** At most one code call per number in this window, whatever happened to the last one. */
export const CODE_CALL_GAP_MS = 10 * 60_000;
/** Code calls the whole site may place in one UTC hour (a burst fuse below the daily cap). */
export const CODE_CALLS_PER_HOUR = 10;
/** How long a plan token's number binding is kept: longer than the token itself lives (6 hours). */
const TOKEN_BIND_MS = 7 * 60 * 60_000;
/** Code calls may use only this share of the site cap, so verified people can still get their plan call. */
export const CODE_SHARE_OF_SITE_CAP = 0.75;
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

export const defaultVoice = async (text: string, language: Language) => {
  // keep: false: the call's audio must not outlive the call in the read-aloud cache (privacy page, "Phone calls").
  try { return (await synthesize(text, language, { keep: false })).audio; } catch { return null; }
};

const codeHash = (secret: string, id: string, numberHash: string, code: string) =>
  createHmac("sha256", subKey(secret, "code")).update(`${id}.${numberHash}.${code}`).digest("hex");

const ticket = (cfg: CallConfig, t: Omit<CallTicket, "exp">, now: number) => encodeURIComponent(signTicket(cfg.secret, t, SESSION_TTL_MS, now));
const urls = (cfg: CallConfig) => `${cfg.baseUrl}/api/call`;

export type StartInput = { phone: unknown; consent: unknown; text: unknown; language: unknown; token: unknown; /** HMAC of the caller's IP. */ caller?: string };
export type StartOutcome =
  | { state: "calling"; id: string; last4: string; /** Vonage did not confirm the call; it may still ring. */ uncertain?: true }
  | { state: "no-consent" | "language" | "token" | "token-used" | "phone" | "in-flight" | "too-soon" | "capped-caller" | "capped-code" | "capped-plan" | "capped-site" | "failed" }
  /** `kept`: the session (encrypted number and plan) was saved and its delete could not be confirmed. */
  | { state: "no-db"; kept?: true };

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
  const planUsed = await store.counter(`plan:${hash}:${day}`, now);
  if (planUsed === null) return { state: "no-db" };
  if (planUsed >= PLAN_CALLS_PER_NUMBER) return { state: "capped-plan" };

  // One plan token, one number. The first use binds the token to this number (atomically: of two racing first uses
  // for different numbers, exactly one wins); a later use works only for that same number, so "Call me again" still
  // works after a missed call while spraying many numbers needs a new plan for each.
  const tokenKey = createHash("sha256").update(token).digest("hex").slice(0, 32);
  try {
    if (await store.takeSlot(`tok:${tokenKey}`, 1, now, TOKEN_BIND_MS)) {
      if (!(await store.takeSlot(`tokn:${tokenKey}:${hash}`, 1, now, TOKEN_BIND_MS))) return { state: "no-db" };
    } else {
      const bound = await store.counter(`tokn:${tokenKey}:${hash}`, now);
      if (bound === null) return { state: "no-db" };
      if (bound < 1) return { state: "token-used" };
    }
  } catch (e) {
    if (e instanceof CallStoreDown) return { state: "no-db" };
    throw e;
  }

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
  // An error can come after the insert committed (a dropped connection), so try the delete and say "kept" unless it
  // is confirmed.
  if (started === "error") return (await store.drop(id)) ? { state: "no-db" } : { state: "no-db", kept: true };

  const slots = [
    { key: `gap:${hash}`, cap: 1, ttlMs: CODE_CALL_GAP_MS, why: "too-soon" as const },
    ...(input.caller ? [{ key: `ip:${input.caller}:${day}`, cap: CODE_CALLS_PER_IP, why: "capped-caller" as const }] : []),
    { key: `code:${hash}:${day}`, cap: CODE_CALLS_PER_NUMBER, why: "capped-code" as const },
    { key: `sitehour:${hourKey(now)}`, cap: Math.min(CODE_CALLS_PER_HOUR, cfg.siteDailyCap), ttlMs: 2 * 60 * 60_000, why: "capped-site" as const },
    { key: `site:${day}`, cap: Math.floor(cfg.siteDailyCap * CODE_SHARE_OF_SITE_CAP), why: "capped-site" as const },
  ];
  let r: Awaited<ReturnType<typeof reserveSlots>>;
  try { r = await reserveSlots(store, slots, now); } catch (e) {
    if (!(e instanceof CallStoreDown)) throw e;
    // No call was placed: nothing to keep. Say it was kept only when the delete could not be confirmed.
    return (await store.drop(id)) ? { state: "no-db" } : { state: "no-db", kept: true };
  }
  if (!r.ok) {
    if (!(await store.drop(id))) console.error("call session not deleted after a cap refusal; the sweep will remove it");
    return { state: slots[r.refused].why };
  }
  const placed = await placeCall({
    applicationId: cfg.applicationId, privateKey: cfg.privateKey, to: phone, from: cfg.from,
    ncco: codeNcco(code, language), eventUrl: `${urls(cfg)}/event?t=${ticket(cfg, { k: id, p: "event", c: "code" }, now)}`,
    lengthTimer: CODE_CALL_SECONDS,
  }, deps.fetchImpl);
  if (!placed.ok) {
    // The slots stay spent (the phone may have rung). Error kind only, never the number.
    console.error("code call failed", placed.error);
    if (placed.unknown) {
      // Vonage may have placed it: keep the session (its code stays typeable for its 10 minutes, and the number stays
      // blocked by its live code and the 10-minute gap). The call's own events, checked against Vonage, settle it.
      await store.markPlaced(id, "code", "unknown", null, now);
      return { state: "calling", id, last4: last4(phone), uncertain: true };
    }
    if (!(await store.drop(id))) console.error("call session not deleted after Vonage refused the code call; the sweep will remove it");
    return { state: "failed" };
  }
  await store.markPlaced(id, "code", "placed", placed.uuid, now);
  return { state: "calling", id, last4: last4(phone) };
}

export type VerifyOutcome =
  | { state: "calling"; last4: string | null; mode: "stream" | "talk"; /** Vonage did not confirm the call; it may still ring. */ uncertain?: true }
  | { state: "wrong"; attemptsLeft: number }
  | { state: "token" | "capped-plan" | "capped-site" | "failed"; /** Whether the wipe of the number and plan was confirmed written. */ cleanup: "done" | "pending" }
  | { state: "expired" | "no-db" };

export async function verifyAndCall(deps: Deps, input: { id: unknown; code: unknown }): Promise<VerifyOutcome> {
  const { store, cfg } = deps;
  const now = deps.now ?? Date.now();
  if (typeof input.id !== "string" || input.id.length > 64) return { state: "expired" };
  const id = input.id;
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^\d{4}$/.test(code)) return { state: "wrong", attemptsLeft: CODE_ATTEMPTS };
  const row = await store.takeAttempt(id, now);
  if (!row || !row.code_hash || !row.phone_hash) return { state: "expired" };
  const want = Buffer.from(row.code_hash, "hex");
  const got = Buffer.from(codeHash(cfg.secret, id, row.phone_hash, code), "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    const left = CODE_ATTEMPTS - row.attempts;
    if (left <= 0) await store.update(id, { ...WIPE, phase: "expired" }, ["code"]);
    return left > 0 ? { state: "wrong", attemptsLeft: left } : { state: "expired" };
  }
  // Exactly one request moves a session past its code.
  // The code's hash stays: the plan call asks for the same code before it plays anything (handleInput).
  const moved = await store.update(id, { phase: "calling", placed_at: new Date(now) }, ["code"]);
  if (moved === "error") return { state: "no-db" };
  if (moved !== "updated") return { state: "expired" };
  // "done" only when the wipe was written. Otherwise the session stays "preparing" and is wiped by the sweep after
  // PREPARING_MAX_MS (and refused at read time from then on), so the person is never told it was deleted when it wasn't.
  const fail = async (state: "token" | "capped-plan" | "capped-site" | "failed", note: string) => {
    const wiped = await store.update(id, { ...WIPE, phase: "failed" }, ["calling"]);
    console.error("plan call refused:", note); // the reason goes to the log only, never into the kept row
    if (wiped !== "updated") console.error("call wipe not confirmed", wiped);
    return { state, cleanup: wiped === "updated" ? "done" : "pending" } as const;
  };

  const language = LANGUAGES.find((l) => l === row.language);
  const phone = parseUsPhone(openText(cfg.secret, "phone", id, row.sealed_phone, now));
  const text = openText(cfg.secret, "text", id, row.sealed_text, now);
  const token = openText(cfg.secret, "token", id, row.sealed_token, now);
  if (!language || !phone || !text || !token) return fail("failed", "session data could not be opened");
  // The call can only ever read text a real plan produced: the token is checked again right before it is spoken.
  if (!verifySpeakToken(token, language, text, deps.speakSecret ?? process.env.FEEDBACK_SECRET, now)) return fail("token", "plan token no longer valid");

  const day = dayKey(now);
  let r: Awaited<ReturnType<typeof reserveSlots>>;
  try { r = await reserveSlots(store, [{ key: `plan:${row.phone_hash}:${day}`, cap: PLAN_CALLS_PER_NUMBER }, { key: `site:${day}`, cap: cfg.siteDailyCap }], now); } catch (e) {
    if (!(e instanceof CallStoreDown)) throw e;
    return fail("failed", "call store down while reserving the plan call");
  }
  if (!r.ok) return fail(r.refused === 0 ? "capped-plan" : "capped-site", r.refused === 0 ? "number cap" : "site cap");

  const audio = await (deps.voice ?? defaultVoice)(text, language).catch(() => null);
  const bytes = audio && audio.byteLength > 1000 ? Buffer.from(audio) : null;
  const exp = row.expires_at.getTime();
  if (bytes && (await store.update(id, { sealed_audio: seal(cfg.secret, "audio", id, exp, bytes), plan_mode: "stream" }, ["calling"])) !== "updated") {
    return fail("failed", "audio could not be stored");
  }
  const mode = bytes ? "stream" : "talk";
  const base = urls(cfg);
  // Nothing about the plan goes into the call itself: it starts with a code prompt (gateNcco), and only the right code
  // returns the plan (handleInput), so voicemail or someone else answering never hears it.
  const ncco = gateNcco({ language, inputUrl: `${base}/input?t=${ticket(cfg, { k: id, p: "input", g: 0 }, now)}`, retry: false });
  const placed = await placeCall({
    applicationId: cfg.applicationId, privateKey: cfg.privateKey, to: phone, from: cfg.from, ncco,
    eventUrl: `${base}/event?t=${ticket(cfg, { k: id, p: "event", c: "plan" }, now)}`,
    lengthTimer: planLengthSeconds({ audioBytes: bytes?.byteLength ?? null, textChars: text.length }),
  }, deps.fetchImpl);
  if (!placed.ok && !placed.unknown) {
    console.error("plan call failed", placed.error);
    return fail("failed", "the plan call could not be placed");
  }
  await store.update(id, { plan_mode: mode }, ["calling"]);
  if (!placed.ok) {
    // Vonage may have placed it and the phone may be ringing: keep what the call needs (text, audio) and do not let the
    // person retry. A confirming event (checked against Vonage) moves it on; with none, the sweep wipes it after
    // UNCONFIRMED_PLAN_MS.
    console.error("plan call unconfirmed", placed.error);
    await store.markPlaced(id, "plan", "unknown", null, now);
    return { state: "calling", last4: row.last4, mode, uncertain: true };
  }
  await store.markPlaced(id, "plan", "placed", placed.uuid, now);
  return { state: "calling", last4: row.last4, mode };
}

/** Vonage call statuses, in order; a later status never moves back to an earlier one. */
const RANK: Record<string, number> = { placed: 0, started: 1, ringing: 2, answered: 3, completed: 4, busy: 4, cancelled: 4, failed: 4, rejected: 4, timeout: 4, unanswered: 4 };
export const MISSED = new Set(["busy", "cancelled", "failed", "rejected", "timeout", "unanswered"]);

type Hook = Pick<Deps, "store" | "cfg" | "now" | "fetchImpl">;
type Truth = { kind: "ok"; row: SessionRow; status: string } | { kind: "ignored" } | { kind: "error" };

/**
 * What is true about the call a callback names. The URL ticket says which session and which of its calls; the callback's
 * `uuid` must be the call UUID stored for it (or, before ours is stored, a call Vonage confirms went out to this
 * session's own number, which is then bound); and the STATUS comes from Vonage itself (GET /v1/calls/{uuid}), never
 * from the callback body. So a replayed or forged callback can neither end a live call nor unlock its plan text.
 * "error" means the answer could not be established (database or Vonage down): the caller should fail safe.
 */
async function callTruth(deps: Hook, k: string, leg: "code" | "plan", uuid: unknown, now: number): Promise<Truth> {
  if (typeof uuid !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(uuid)) return { kind: "ignored" };
  const row = await deps.store.get(k, now);
  if (!row) return { kind: "ignored" };
  const stored = leg === "code" ? row.code_uuid : row.plan_uuid;
  if (stored && stored !== uuid) {
    console.error("call callback refused: uuid does not match the call");
    return { kind: "ignored" };
  }
  const truth = await getCall({ applicationId: deps.cfg.applicationId, privateKey: deps.cfg.privateKey, uuid }, deps.fetchImpl);
  if (!truth.ok) {
    console.error("call status check failed", truth.error);
    return { kind: "error" };
  }
  if (truth.direction && truth.direction !== "outbound") return { kind: "ignored" };
  const phone = openText(deps.cfg.secret, "phone", k, row.sealed_phone, now);
  const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
  if (phone && digits(truth.to) !== digits(phone)) {
    console.error("call callback refused: the call is not to this session's number");
    return { kind: "ignored" };
  }
  if (!stored) {
    // Our own write of the UUID can land after the call's first event (or never, when placing timed out).
    if (!phone) return { kind: "ignored" }; // nothing left to check the number against: do not bind blind
    const c = await deps.store.claimUuid(k, leg, uuid, now);
    if (c === "error") return { kind: "error" };
    if (c !== "bound" && c !== "match") return { kind: "ignored" };
  }
  return { kind: "ok", row, status: truth.status };
}

/**
 * A Vonage event for one of a session's two calls. Ending the plan call wipes everything sensitive. Returns "error"
 * when the event could not be checked or saved, so the route answers 5xx and Vonage retries it.
 * `claimed` is the status in the callback body. It is never trusted to change anything, only used as a hint: when it
 * says the call ended but Vonage's own GET still reports it live (Vonage's read lagging its webhook), the answer is
 * "error", so Vonage retries and the end of the call (and the wipe) is not lost to a stale read.
 */
export async function handleEvent(deps: Hook, t: CallTicket, uuid: unknown, claimed?: unknown): Promise<"ok" | "ignored" | "error"> {
  if (t.c !== "code" && t.c !== "plan") return "ignored";
  const now = deps.now ?? Date.now();
  const truth = await callTruth(deps, t.k, t.c, uuid, now);
  if (truth.kind !== "ok") return truth.kind;
  const { row, status } = truth;
  if (!(status in RANK)) return "ignored";
  if (typeof claimed === "string" && RANK[claimed] === 4 && RANK[status] < 4) {
    console.error("call event: the callback says ended but Vonage still reports it live; asking for a retry");
    // If the retry reads stale too, or never comes, the end must not be lost: mark the session so the sweep (and the
    // person's status poll) ask Vonage again and wipe once Vonage itself reports an end. The marker is written only
    // here, after callTruth matched this UUID to the session's own call; on its own it never wipes or ends anything.
    if (t.c === "plan" && row.phase === "calling") {
      const marked = await deps.store.update(t.k, { note: END_PENDING }, ["calling"]);
      if (marked !== "updated") console.error("call event: pending-end marker not written", marked);
    }
    return "error";
  }
  const field = t.c === "code" ? "code_status" : "plan_status";
  const current = row[field];
  if (current && (RANK[current] ?? -1) >= RANK[status]) return "ok";
  if (t.c === "code") {
    // A code call nobody picked up ends the session; the person can ask for a new one. Only a database error is a
    // failure (503, Vonage retries); "phase_changed" means the session has moved on.
    const r = MISSED.has(status)
      ? await deps.store.update(t.k, { ...WIPE, code_status: status, phase: "code_missed" }, ["code"])
      : await deps.store.update(t.k, { code_status: status }, ["code"]);
    return r === "error" ? "error" : "ok"; // "phase_changed": the code was typed meanwhile, nothing to record
  }
  // A live status is written only while the call is live, so a check that read Vonage before a concurrent end (a
  // webhook retry and the sweep racing) can never move a finished session's status back.
  const r = RANK[status] === 4
    ? await deps.store.update(t.k, { ...WIPE, plan_status: status, phase: "done" })
    : await deps.store.update(t.k, { plan_status: status }, ["calling"]);
  return r === "error" ? "error" : "ok"; // "phase_changed": the session is gone (swept), nothing left to record
}

/** How many plan calls with a pending end settlePendingEnds checks per run. */
export const PENDING_ENDS_PER_RUN = 20;

/**
 * Plan calls whose end a callback reported while Vonage's GET still said live (END_PENDING): asks Vonage again for each
 * and, through handleEvent with no claimed status, wipes only those Vonage now reports ended. One still live keeps its
 * marker and is checked on the next run. With `id`, checks only that session (the person's own status poll).
 * null when the pending sessions could not be listed (database error).
 */
export async function settlePendingEnds(deps: Hook, id?: string): Promise<{ checked: number; ended: number; failed: number } | null> {
  const now = deps.now ?? Date.now();
  let pending: { id: string; plan_uuid: string }[] | null;
  if (id !== undefined) {
    let row: SessionRow | null;
    try { row = await deps.store.get(id, now); } catch (e) {
      if (e instanceof CallStoreDown) return null;
      throw e;
    }
    pending = row && row.phase === "calling" && row.note === END_PENDING && row.plan_uuid ? [{ id, plan_uuid: row.plan_uuid }] : [];
  } else {
    pending = await deps.store.pendingEnds(now, PENDING_ENDS_PER_RUN);
  }
  if (!pending) return null;
  const results = await Promise.all(pending.map(async (p) => {
    try {
      const r = await handleEvent(deps, { k: p.id, p: "event", c: "plan", exp: now + 60_000 }, p.plan_uuid);
      if (r === "error") return "failed" as const;
      return (await deps.store.get(p.id, now))?.phase === "done" ? "ended" as const : "live" as const;
    } catch (e) {
      if (e instanceof CallStoreDown) return "failed" as const;
      throw e;
    }
  }));
  return { checked: pending.length, ended: results.filter((r) => r === "ended").length, failed: results.filter((r) => r === "failed").length };
}

/**
 * Keypad input after the plan: "1" plays it again, at most MAX_REPLAYS times; anything else says goodbye. The plan text
 * is only ever returned for a call Vonage confirms is live right now; anything uncertain says goodbye.
 */
export async function handleInput(deps: Hook, t: CallTicket, digits: unknown, uuid: unknown): Promise<NccoAction[]> {
  const now = deps.now ?? Date.now();
  if (t.g !== undefined) return gateInput(deps, t, digits, uuid, now);
  const n = (t.n ?? 0) + 1;
  if (digits !== "1" || n > MAX_REPLAYS) {
    const row = await deps.store.get(t.k, now);
    return goodbyeNcco(LANGUAGES.find((l) => l === row?.language) ?? "English");
  }
  const truth = await callTruth(deps, t.k, "plan", uuid, now);
  const row = truth.kind === "ok" ? truth.row : null;
  const language = LANGUAGES.find((l) => l === row?.language) ?? "English";
  if (truth.kind !== "ok" || !row || row.phase !== "calling" || (truth.status !== "answered" && truth.status !== "started")) return goodbyeNcco(language);
  const text = openText(deps.cfg.secret, "text", t.k, row.sealed_text, now);
  if (!text) return goodbyeNcco(language);
  const base = urls(deps.cfg);
  return planNcco({
    text, language, replays: n,
    audioUrl: row.has_audio ? `${base}/audio?t=${ticket(deps.cfg, { k: t.k, p: "audio" }, now)}` : null,
    inputUrl: `${base}/input?t=${ticket(deps.cfg, { k: t.k, p: "input", n }, now)}`,
  });
}

/**
 * The code at the start of the plan call. The plan (and the signed audio URL) is returned only for the session's own
 * code, compared in constant time against its hash, on a call Vonage reports live; a wrong code or silence gets one
 * more try (GATE_TRIES in all), then goodbye.
 */
async function gateInput(deps: Hook, t: CallTicket, digits: unknown, uuid: unknown, now: number): Promise<NccoAction[]> {
  const tries = (t.g ?? 0) + 1;
  if (tries > GATE_TRIES) return goodbyeNcco("English");
  const truth = await callTruth(deps, t.k, "plan", uuid, now);
  const row = truth.kind === "ok" ? truth.row : null;
  const language = LANGUAGES.find((l) => l === row?.language) ?? "English";
  if (truth.kind !== "ok" || !row || row.phase !== "calling" || !row.code_hash || !row.phone_hash || (truth.status !== "answered" && truth.status !== "started")) return goodbyeNcco(language);
  // Tries are counted in the store too, so replaying a first-try callback cannot keep guessing. A database error throws
  // CallStoreDown (the input route answers 503), never a goodbye as if the tries were used up.
  if (!(await deps.store.takeSlot(`gate:${t.k}`, GATE_TRIES, now, SESSION_TTL_MS))) return goodbyeNcco(language);
  const base = urls(deps.cfg);
  const typed = typeof digits === "string" && /^\d{4}$/.test(digits) ? digits : "";
  const want = Buffer.from(row.code_hash, "hex");
  const got = Buffer.from(codeHash(deps.cfg.secret, t.k, row.phone_hash, typed || "none"), "hex");
  if (!typed || want.length !== got.length || !timingSafeEqual(want, got)) {
    return tries < GATE_TRIES
      ? gateNcco({ language, inputUrl: `${base}/input?t=${ticket(deps.cfg, { k: t.k, p: "input", g: tries }, now)}`, retry: true })
      : goodbyeNcco(language);
  }
  const text = openText(deps.cfg.secret, "text", t.k, row.sealed_text, now);
  if (!text) return goodbyeNcco(language);
  return planNcco({
    text, language, replays: 0,
    audioUrl: row.has_audio ? `${base}/audio?t=${ticket(deps.cfg, { k: t.k, p: "audio" }, now)}` : null,
    inputUrl: `${base}/input?t=${ticket(deps.cfg, { k: t.k, p: "input", n: 0 }, now)}`,
  });
}

/** The MP3 Vonage streams into the call, opened from Postgres so it works on any server instance. */
export async function audioFor(deps: Pick<Deps, "store" | "cfg" | "now">, t: CallTicket): Promise<Buffer | null> {
  const now = deps.now ?? Date.now();
  const row = await deps.store.get(t.k, now);
  if (!row || row.phase !== "calling" || !row.has_audio || !row.sealed_text) return null; // refused when stale (store.refuseStale)
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
