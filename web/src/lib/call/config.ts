import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseUsPhone } from "./phone";

/**
 * "ATLAS calls you" is on only when every variable it needs is present (wired-or-cut): the Vonage application id and
 * its private key, the caller-id number, the secret that seals numbers and signs callback tickets, Postgres (codes,
 * caps and the short-lived encrypted plan live there and fail closed without it), and an https base URL Vonage can
 * reach for the audio and the call events. Anything missing: the feature reports itself off and the page hides it.
 */
export const CALL_ENV = ["ATLAS_VONAGE_APPLICATION_ID", "ATLAS_VONAGE_PRIVATE_KEY", "ATLAS_VONAGE_FROM_NUMBER", "ATLAS_CALL_SECRET", "DATABASE_URL"] as const;

export type CallConfig = {
  applicationId: string;
  privateKey: string;
  from: string;
  secret: string;
  baseUrl: string;
  /** Calls (code and plan together) this whole site may place per UTC day. */
  siteDailyCap: number;
};

export const DEFAULT_SITE_DAILY_CAP = 40;

/** A PEM pasted into an env var often arrives with literal "\n" escapes, or base64-encoded; accept both. */
export function normalizePem(raw: string): string {
  const s = raw.trim();
  if (s.includes("-----BEGIN")) return s.replace(/\\n/g, "\n").trim();
  try {
    const dec = Buffer.from(s, "base64").toString("utf8");
    return dec.includes("-----BEGIN") ? dec.trim() : s;
  } catch {
    return s;
  }
}

/**
 * The public origin Vonage calls back. ATLAS_PUBLIC_URL wins; otherwise production uses its production domain and a
 * preview uses its own deployment URL. Must be https: Vonage cannot reach a laptop.
 */
export function publicBaseUrl(src: Record<string, string | undefined>): string | null {
  const v = (k: string) => src[k]?.trim() || "";
  const raw = v("ATLAS_PUBLIC_URL")
    || (v("VERCEL_ENV") === "production" && v("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${v("VERCEL_PROJECT_PRODUCTION_URL")}` : "")
    || (v("VERCEL_URL") ? `https://${v("VERCEL_URL")}` : "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function callConfig(src: Record<string, string | undefined> = process.env): CallConfig | null {
  const v = (k: string) => src[k]?.trim() || "";
  if (!CALL_ENV.every((k) => v(k))) return null;
  const from = parseUsPhone(v("ATLAS_VONAGE_FROM_NUMBER"));
  if (!from) return null;
  const baseUrl = publicBaseUrl(src);
  if (!baseUrl) return null;
  const privateKey = normalizePem(v("ATLAS_VONAGE_PRIVATE_KEY"));
  if (!privateKey.includes("-----BEGIN")) return null;
  const capRaw = v("ATLAS_CALL_DAILY_CAP");
  const cap = capRaw ? Number(capRaw) : DEFAULT_SITE_DAILY_CAP;
  return {
    applicationId: v("ATLAS_VONAGE_APPLICATION_ID"), privateKey, from, secret: v("ATLAS_CALL_SECRET"), baseUrl,
    siteDailyCap: Number.isInteger(cap) && cap >= 0 ? Math.min(cap, 200) : DEFAULT_SITE_DAILY_CAP,
  };
}

/** One key per purpose, all derived from ATLAS_CALL_SECRET, so a ticket key can never open a sealed plan. */
export const subKey = (secret: string, purpose: string) => createHash("sha256").update(`atlas-call:${purpose}:${secret}`).digest();

/**
 * Short-lived signed tickets in the URLs Vonage calls back (audio, keypad input, events). They name a call session
 * and a purpose, never a number or any text. `c` says which of the session's two calls an event is about, and `n` how
 * many times the plan has been replayed.
 */
export type TicketPurpose = "audio" | "input" | "event";
export type CallTicket = { k: string; p: TicketPurpose; c?: "code" | "plan"; n?: number; exp: number };
export const TICKET_TTL_MS = 30 * 60_000;

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", subKey(secret, "ticket")).update(body).digest();

export function signTicket(secret: string, t: Omit<CallTicket, "exp">, ttlMs = TICKET_TTL_MS, now = Date.now()): string {
  const body = b64u(JSON.stringify({ ...t, exp: now + ttlMs }));
  return `${body}.${b64u(mac(secret, body))}`;
}

export function verifyTicket(secret: string, token: string | null, purpose: TicketPurpose, now = Date.now()): CallTicket | null {
  if (!token || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const got = Buffer.from(sig, "base64url");
  const want = mac(secret, body);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as CallTicket;
    if (t.p !== purpose || typeof t.k !== "string" || typeof t.exp !== "number" || t.exp < now) return null;
    return t;
  } catch {
    return null;
  }
}
