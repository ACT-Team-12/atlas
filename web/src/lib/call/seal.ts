import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { subKey } from "./config";

/**
 * Encryption for what a call needs for a few minutes: the phone number, the plan's read-aloud text, its token and
 * the voice MP3. AES-256-GCM with a key derived from ATLAS_CALL_SECRET. The additional data binds each value to its
 * field, its call session and its expiry, so a value cannot be moved to another session or kept past its time by
 * editing the expiry: past `exp` it refuses to open even if the row has not been swept from Postgres yet.
 */
export const SEAL_VERSION = "v1";

const aad = (field: string, session: string, exp: number) => Buffer.from(`${field.length}:${field}${session.length}:${session}${exp}`);

export function seal(secret: string, field: string, session: string, exp: number, data: Buffer | string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subKey(secret, "seal"), iv);
  c.setAAD(aad(field, session, exp));
  const body = Buffer.concat([c.update(typeof data === "string" ? Buffer.from(data, "utf8") : data), c.final()]);
  const head = Buffer.alloc(8);
  head.writeBigUInt64BE(BigInt(exp));
  return Buffer.concat([Buffer.from(SEAL_VERSION), head, iv, c.getAuthTag(), body]);
}

export function open(secret: string, field: string, session: string, sealed: Buffer | null | undefined, now = Date.now()): Buffer | null {
  if (!sealed || sealed.length < 2 + 8 + 12 + 16) return null;
  try {
    if (sealed.subarray(0, 2).toString() !== SEAL_VERSION) return null;
    const exp = Number(sealed.readBigUInt64BE(2));
    if (!Number.isSafeInteger(exp) || exp < now) return null;
    const iv = sealed.subarray(10, 22);
    const tag = sealed.subarray(22, 38);
    const d = createDecipheriv("aes-256-gcm", subKey(secret, "seal"), iv);
    d.setAAD(aad(field, session, exp));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(sealed.subarray(38)), d.final()]);
  } catch {
    return null;
  }
}

export const openText = (secret: string, field: string, session: string, sealed: Buffer | null | undefined, now = Date.now()) =>
  open(secret, field, session, sealed, now)?.toString("utf8") ?? null;
