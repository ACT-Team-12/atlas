import { afterEach, describe, expect, it, vi } from "vitest";

const sweep = vi.fn(async () => true);
vi.mock("@/lib/call/store", () => ({ callStore: async () => ({ sweep }) }));
let cfg: unknown = null;
vi.mock("@/lib/call/config", () => ({ callConfig: () => cfg }));
const settlePendingEnds = vi.fn(async (): Promise<unknown> => ({ checked: 1, ended: 1, failed: 0 }));
vi.mock("@/lib/call/flow", () => ({ settlePendingEnds }));
const { GET } = await import("./route");

const req = (headers: Record<string, string>) => new Request("https://atlas.example/api/call/sweep", { headers: { "x-real-ip": `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers } });

describe("/api/call/sweep (Vercel Cron)", () => {
  afterEach(() => { vi.unstubAllEnvs(); sweep.mockClear(); settlePendingEnds.mockClear(); cfg = null; });

  it("with CRON_SECRET set, requires exactly that bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await GET(req({ "user-agent": "vercel-cron/1.0" }))).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
    const ok = await GET(req({ authorization: "Bearer s3cret" }));
    expect([ok.status, await ok.json()]).toEqual([200, { swept: true, pending: null }]);
    expect(settlePendingEnds).not.toHaveBeenCalled(); // calls not configured: nothing to ask Vonage
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

  it("with calls configured, re-checks pending call ends with Vonage and reports counts only (#54)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    cfg = { applicationId: "a" };
    const ok = await GET(req({ authorization: "Bearer s3cret" }));
    expect([ok.status, await ok.json()]).toEqual([200, { swept: true, pending: { checked: 1, ended: 1, failed: 0 } }]);
    expect(settlePendingEnds).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
