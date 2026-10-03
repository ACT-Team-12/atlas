import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PREP } from "./samplePrep";

// The model call and the database are replaced; this tests the route's own order of checks.
const takeDailySlot = vi.fn();
const preparePrep = vi.fn();
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), takeDailySlot: (...a: unknown[]) => takeDailySlot(...a) }));
vi.mock("@/lib/prep", () => ({ preparePrep: (...a: unknown[]) => preparePrep(...a) }));

const { POST } = await import("@/app/api/prep/route");
const { secondsToUtcMidnight, takeDailySlot: realTake } = await vi.importActual<typeof import("./db")>("./db");

let ip = 0;
const req = (body: unknown) => new Request("http://localhost/api/prep", {
  method: "POST", headers: { "content-type": "application/json", "x-real-ip": `10.0.0.${++ip}` }, body: JSON.stringify(body),
});
const ok = { timeline: [], ask: [], held_back: { count: 0, kinds: [] }, stats: {}, model: "m", ms: 1 };

afterEach(() => { takeDailySlot.mockReset(); preparePrep.mockReset(); });

describe("/api/prep shared daily ceiling", () => {
  it("refuses with 429 and never calls the model when today's shared ceiling is used up", async () => {
    takeDailySlot.mockResolvedValue({ status: "over", used: 301, limit: 300 });
    const r = await POST(req({ text: SAMPLE_PREP }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(r.headers.get("x-atlas-limit")).toBe("shared-daily");
    expect(preparePrep).not.toHaveBeenCalled();
  });

  it("goes on under the ceiling", async () => {
    takeDailySlot.mockResolvedValue({ status: "ok", used: 5, limit: 300 });
    preparePrep.mockResolvedValue(ok);
    const r = await POST(req({ text: SAMPLE_PREP }));
    expect(r.status).toBe(200);
    expect(takeDailySlot).toHaveBeenCalledWith("prep", expect.any(Number));
    expect(r.headers.get("x-atlas-limit")).toBe("shared-daily");
  });

  it("fails closed: when the shared ceiling can't be read, refuses with 503 and never calls the model (Codex review)", async () => {
    takeDailySlot.mockResolvedValue({ status: "unavailable" });
    preparePrep.mockResolvedValue(ok);
    const r = await POST(req({ text: SAMPLE_PREP }));
    expect(r.status).toBe(503);
    expect(preparePrep).not.toHaveBeenCalled();
    expect(r.headers.get("x-atlas-limit")).toBe("unavailable");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await r.json()).error).toMatch(/call your clinic/);
  });

  it("an invalid request is refused before it spends a slot", async () => {
    const r = await POST(req({ text: "short" }));
    expect(r.status).toBe(400);
    expect(takeDailySlot).not.toHaveBeenCalled();
  });
});

describe("takeDailySlot and the reset time", () => {
  it("reports unavailable, never throws, with no database configured", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    await expect(realTake("prep", 10)).resolves.toEqual({ status: "unavailable" });
    if (saved) process.env.DATABASE_URL = saved;
  });

  it("counts down to the next UTC midnight", () => {
    expect(secondsToUtcMidnight(Date.UTC(2026, 9, 2, 23, 59, 0))).toBe(60);
    expect(secondsToUtcMidnight(Date.UTC(2026, 9, 2, 0, 0, 0))).toBe(86400);
  });
});
