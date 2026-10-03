import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { createHmac } from "node:crypto";

/**
 * US phone numbers for "ATLAS calls you", normalized to E.164 (+1NXXNXXXXXX). Region US exactly (full metadata):
 * Canada, the Caribbean and the US territories are refused (different, often higher, call rates), and so are
 * premium-rate, shared-cost, toll-free and service numbers, 900/976 and N11 codes in the area code OR the exchange,
 * short codes, and the 555-01XX range reserved for fiction.
 */
const PREMIUM = new Set(["900", "976"]);
const CALLABLE = new Set(["FIXED_LINE", "MOBILE", "FIXED_LINE_OR_MOBILE"]);

export function parseUsPhone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const p = parsePhoneNumberFromString(trimmed, "US");
  if (!p || !p.isValid() || p.country !== "US") return null;
  const type = p.getType();
  if (!type || !CALLABLE.has(type)) return null;
  const d = p.nationalNumber;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  const area = d.slice(0, 3);
  const exch = d.slice(3, 6);
  for (const code of [area, exch]) {
    if (PREMIUM.has(code)) return null;
    if (code[1] === "1" && code[2] === "1") return null; // N11 (211, 311, 411, 511, 611, 711, 811, 911)
  }
  if (exch === "555" && d.slice(6, 8) === "01") return null;
  return `+1${d}`;
}

export const last4 = (e164: string) => e164.slice(-4);

/** Counts calls per number without keeping the number: an HMAC keyed from ATLAS_CALL_SECRET. */
export const phoneHash = (secret: string, e164: string) => createHmac("sha256", `atlas-call-num:${secret}`).update(e164).digest("hex");
