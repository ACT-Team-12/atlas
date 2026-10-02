import { describe, expect, it } from "vitest";
import { allowedOrigin, rateLimit } from "./guard";

const req = (origin: string | null, host = "atlas-team12.vercel.app") =>
  new Request("https://atlas-team12.vercel.app/api/extract", { method: "POST", headers: { host, ...(origin ? { origin } : {}) } });

describe("guard", () => {
  it("accepts our own site and refuses other sites", () => {
    expect(allowedOrigin(req("https://atlas-team12.vercel.app"))).toBe(true);
    expect(allowedOrigin(req("http://localhost:3000"))).toBe(true);
    expect(allowedOrigin(req("https://evil.example.com"))).toBe(false);
    expect(allowedOrigin(req(null))).toBe(true);
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
});
