import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The natural voice costs money per character, so /api/speak only reads text that /api/plan itself produced.
 * /api/plan signs a hash of the plan's read-aloud text and its language; /api/speak refuses anything else.
 * A caller can no longer spend the voice allowance on arbitrary text, and every voiced read costs them a
 * rate-limited plan first (Codex review, 2026-10-02). The token carries a hash and a time, never the text.
 */
export const SPEAK_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const b64 = (b: Buffer) => b.toString("base64url");
const digest = (language: string, text: string) =>
  createHash("sha256").update(`${language.length}:${language}${text.length}:${text}`).digest("hex");
const sign = (secret: string, payload: string) => b64(createHmac("sha256", secret).update(`speak.${payload}`).digest());

export function issueSpeakToken(language: string, text: string, secret = process.env.FEEDBACK_SECRET, now = Date.now()): string | null {
  if (!secret) return null;
  const t = String(now);
  return `${t}.${sign(secret, `${t}.${digest(language, text)}`)}`;
}

export function verifySpeakToken(token: string, language: string, text: string, secret = process.env.FEEDBACK_SECRET, now = Date.now()): boolean {
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [t, sig] = parts;
  const at = Number(t);
  if (!/^\d+$/.test(t) || !Number.isFinite(at) || at > now + 60_000 || now - at > SPEAK_TOKEN_TTL_MS) return false;
  const expected = Buffer.from(sign(secret, `${t}.${digest(language, text)}`));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
