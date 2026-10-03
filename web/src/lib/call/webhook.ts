import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CallConfig } from "./config";

/**
 * Vonage signed webhooks. With "Signed Webhooks" on (Vonage dashboard, API Settings), every Voice API callback carries
 * `Authorization: Bearer <JWT>`, HS256-signed with the account's signature secret. Claims: iat, jti, iss ("Vonage"),
 * api_key, optional application_id, and payload_hash (SHA-256 of the request body).
 * When ATLAS_VONAGE_SIGNATURE_SECRET is set, a callback must carry a valid one; when it is not set the callback is
 * still bound to its call by the signed ticket in its URL and the call UUID Vonage gave us (see flow.ts), and a one-time
 * warning is logged. Logs name the failure kind only, never a token or a secret.
 */
const MAX_AGE_S = 10 * 60; // Vonage retries a failed callback once; allow for that and modest clock skew
const MAX_FUTURE_S = 60;

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function verifyVonageJwt(auth: string | null, rawBody: string, secret: string, now = Date.now(), applicationId?: string): boolean {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(auth?.trim() ?? "");
  if (!m || !secret) return false;
  const [, h, p, s] = m;
  try {
    const head = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: unknown };
    if (head.alg !== "HS256") return false;
    const want = createHmac("sha256", secret).update(`${h}.${p}`).digest();
    const got = Buffer.from(s, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
    const c = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
    const nowS = now / 1000;
    if (typeof c.iat !== "number" || c.iat > nowS + MAX_FUTURE_S || nowS - c.iat > MAX_AGE_S) return false;
    if (c.exp !== undefined && (typeof c.exp !== "number" || c.exp < nowS)) return false;
    if (c.iss !== undefined && c.iss !== "Vonage") return false;
    if (applicationId && c.application_id !== undefined && c.application_id !== applicationId) return false;
    if (c.payload_hash !== undefined) {
      if (typeof c.payload_hash !== "string") return false;
      const claimed = c.payload_hash.toLowerCase();
      // Vonage hashes the JSON it sent; accept the raw bytes or their canonical JSON.stringify form.
      let canonical: string | null = null;
      try { canonical = rawBody ? sha256hex(JSON.stringify(JSON.parse(rawBody))) : null; } catch {}
      if (claimed !== sha256hex(rawBody) && claimed !== canonical) return false;
    }
    return true;
  } catch {
    return false;
  }
}

let warned = false;

/** True when a Vonage callback may be acted on: a valid signature when a signature secret is configured. */
export function signedByVonage(request: Request, rawBody: string, cfg: CallConfig, now = Date.now()): boolean {
  if (!cfg.signatureSecret) {
    if (!warned) {
      warned = true;
      console.warn("call webhook signature not checked: ATLAS_VONAGE_SIGNATURE_SECRET is not set");
    }
    return true;
  }
  const ok = verifyVonageJwt(request.headers.get("authorization"), rawBody, cfg.signatureSecret, now, cfg.applicationId);
  if (!ok) console.error("call webhook refused: bad or missing Vonage signature");
  return ok;
}
