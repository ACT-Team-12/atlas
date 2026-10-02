import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time feedback tokens. /api/plan issues one with every plan it builds; /api/feedback accepts an answer
 * only with a valid, unexpired token whose nonce has not been used (unique index in Postgres). This stops
 * anyone from inflating the public "real use" numbers with direct POSTs (Codex review, 2026-10-02).
 * The token carries a random nonce and a time, nothing about the person or their paper.
 */
export const FEEDBACK_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const b64 = (b: Buffer) => b.toString("base64url");
const sign = (secret: string, payload: string) => b64(createHmac("sha256", secret).update(payload).digest());

export function issueFeedbackToken(secret = process.env.FEEDBACK_SECRET, now = Date.now()): string | null {
  if (!secret) return null;
  const payload = `${b64(randomBytes(16))}.${now}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Returns the nonce if the token is genuine and fresh, else null. */
export function verifyFeedbackToken(token: string, secret = process.env.FEEDBACK_SECRET, now = Date.now()): string | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [nonce, t, sig] = parts;
  const expected = Buffer.from(sign(secret, `${nonce}.${t}`));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const at = Number(t);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > FEEDBACK_TOKEN_TTL_MS) return null;
  return nonce;
}
