import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Who started a code call, for the per-caller daily cap: an HMAC (no IP is stored) of the address Vercel reports in
 * x-real-ip. IPv4 counts per address. IPv6 counts per /64, because one home, phone or server is normally given a whole
 * /64 and could otherwise rotate through endless addresses, each with a fresh cap.
 */
export function callerKey(ip: string): string {
  const s = ip.trim().replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(s)) return s;
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":")}::/64`;
}

export const callerId = (secret: string, ip: string) =>
  createHmac("sha256", `atlas-call-ip:${secret}`).update(callerKey(ip)).digest("hex").slice(0, 32);
