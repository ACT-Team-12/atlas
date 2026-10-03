import { describe, expect, it } from "vitest";
import { entryOf, eventInsert, helperFunnel, isTestRequest, recordEvent, surfaceOf, liveStats, type AtlasEvent } from "./db";

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

  it("only tags a plan as a helper-link plan on the exact header value", () => {
    expect(entryOf(req({ "x-atlas-entry": "helper-link" }))).toBe("helper-link");
    expect(entryOf(req({ "x-atlas-entry": "Helper-Link" }))).toBeUndefined();
    expect(entryOf(req({ "x-atlas-entry": "helper-link; zip=30310" }))).toBeUndefined();
    expect(entryOf(req())).toBeUndefined();
  });

  it("never sends a ZIP, link or note to the database, even if one is passed by mistake", () => {
    const leaky = { surface: "web", kind: "plan", language: "Spanish", steps: 4, entry: "helper-link",
      zip: "30310", note: "my note", link: "https://atlas-team12.vercel.app/#try&via=helper&zip=30310", location: { lat: 33.7, lng: -84.4 } } as unknown as AtlasEvent;
    const q = eventInsert(leaky, false, "production");
    expect(q.sql).not.toMatch(/zip|note|link|location|lat|lng/);
    expect(JSON.stringify(q.values)).not.toMatch(/30310|my note|33\.7|via=helper/);
    expect(q.sql).toContain("entry");
    expect(q.values).toContain("helper-link");
    // Without the tag (or before migration 007), the insert is exactly the old one.
    const plain = eventInsert(leaky, false, "production", false);
    expect(plain.sql).not.toContain("entry");
    expect(eventInsert({ surface: "web", kind: "plan" }, false, "production").sql).not.toContain("entry");
  });
});

describe("helper-link funnel without a database", () => {
  it("says not available instead of reporting zeros", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    await expect(helperFunnel()).resolves.toEqual({ available: false, reason: "no-database" });
    if (saved) process.env.DATABASE_URL = saved;
  });
});
