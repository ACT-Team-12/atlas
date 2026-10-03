import { afterEach, describe, expect, it, vi } from "vitest";

const sweep = vi.fn(async () => true);
vi.mock("@/lib/call/store", () => ({ callStore: async () => ({ sweep }) }));
const { GET } = await import("./route");

const req = (headers: Record<string, string>) => new Request("https://atlas.example/api/call/sweep", { headers: { "x-real-ip": `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers } });

describe("/api/call/sweep (Vercel Cron)", () => {
  afterEach(() => { vi.unstubAllEnvs(); sweep.mockClear(); });

  it("with CRON_SECRET set, requires exactly that bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await GET(req({ "user-agent": "vercel-cron/1.0" }))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
    const ok = await GET(req({ authorization: "Bearer s3cret" }));
    expect([ok.status, await ok.json()]).toEqual([200, { swept: true }]);
  });

  it("without CRON_SECRET, accepts only Vercel's cron user agent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await GET(req({}))).status).toBe(401);
    expect((await GET(req({ "user-agent": "vercel-cron/1.0" }))).status).toBe(200);
  });

  it("answers 503 when the sweep fails, so the cron run shows as failed", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    sweep.mockResolvedValueOnce(false);
    expect((await GET(req({ authorization: "Bearer s3cret" }))).status).toBe(503);
  });
});
