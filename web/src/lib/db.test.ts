import { describe, expect, it } from "vitest";
import { isTestRequest, recordEvent, surfaceOf, liveStats } from "./db";

const req = (headers: Record<string, string> = {}) => new Request("https://atlas-team12.vercel.app/api/plan", { method: "POST", headers });

describe("measurement helpers", () => {
  it("flags our own test runs so they never count as real use", () => {
    expect(isTestRequest(req({ "x-atlas-test": "1" }))).toBe(true);
    expect(isTestRequest(req())).toBe(false);
    expect(isTestRequest(req({ "x-atlas-test": "yes" }))).toBe(false);
  });

  it("only trusts the two native app surfaces, everything else is web", () => {
    expect(surfaceOf(req({ "x-atlas-surface": "ios" }))).toBe("ios");
    expect(surfaceOf(req({ "x-atlas-surface": "android" }))).toBe("android");
    expect(surfaceOf(req({ "x-atlas-surface": "'; drop table atlas_events;--" }))).toBe("web");
    expect(surfaceOf(req())).toBe("web");
  });

  it("does nothing and never throws when no database is configured", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    await expect(recordEvent({ surface: "web", kind: "read", steps: 3 }, false)).resolves.toBe("failed");
    await expect(liveStats()).resolves.toBeNull();
    if (saved) process.env.DATABASE_URL = saved;
  });
});
