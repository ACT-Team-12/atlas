import { describe, expect, it } from "vitest";
import { allowedOrigin, clientIp, rateLimit } from "./guard";

const req = (origin: string | null, headers: Record<string, string> = {}) =>
  new Request("https://atlas-team12.vercel.app/api/extract", {
    method: "POST",
    headers: { host: "atlas-team12.vercel.app", ...(origin ? { origin } : {}), ...headers },
  });

describe("guard", () => {
  it("accepts our own site and previews, refuses other sites including other vercel.app apps", () => {
    expect(allowedOrigin(req("https://atlas-team12.vercel.app"))).toBe(true);
    expect(allowedOrigin(req("https://atlas-team12-abc123-ssookra-7703s-projects.vercel.app"))).toBe(true);
    expect(allowedOrigin(req("http://localhost:3000"))).toBe(true);
    expect(allowedOrigin(req("https://evil.example.com"))).toBe(false);
    expect(allowedOrigin(req("https://attacker-app.vercel.app"))).toBe(false);
    expect(allowedOrigin(req("https://atlas-team12.vercel.app.evil.com"))).toBe(false);
  });

  it("uses the platform IP header, not a client-supplied x-forwarded-for", () => {
    expect(clientIp(req(null, { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
  });

  it("limits each key within the window, then frees it later", () => {
    const t0 = 1_000_000;
    let last = { ok: true, retryAfterSec: 0 };
    for (let i = 0; i < 31; i++) last = rateLimit("test:1.2.3.4", t0 + i);
    expect(last.ok).toBe(false);
    expect(last.retryAfterSec).toBeGreaterThan(0);
    expect(rateLimit("test:1.2.3.4", t0 + 11 * 60 * 1000).ok).toBe(true);
    expect(rateLimit("test:5.6.7.8", t0).ok).toBe(true);
  });

  it("keeps a limited key limited even when many other keys arrive", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 30; i++) rateLimit("test:victim-check", t0 + i);
    for (let i = 0; i < 100; i++) rateLimit(`test:noise-${i}`, t0 + 100);
    expect(rateLimit("test:victim-check", t0 + 200).ok).toBe(false);
  });
});
