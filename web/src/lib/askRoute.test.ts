import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_AVS } from "./sample";

// The model call and the database are replaced; this tests the route's own order of checks.
const takeDailySlot = vi.fn();
const answerFromPaper = vi.fn();
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), takeDailySlot: (...a: unknown[]) => takeDailySlot(...a) }));
vi.mock("@/lib/ask", async (orig) => ({ ...(await orig<typeof import("./ask")>()), answerFromPaper: (...a: unknown[]) => answerFromPaper(...a) }));

const { POST } = await import("@/app/api/ask/route");

let ip = 0;
const req = (body: unknown, realIp = `10.1.0.${++ip}`) => new Request("http://localhost/api/ask", {
  method: "POST", headers: { "content-type": "application/json", "x-real-ip": realIp }, body: JSON.stringify(body),
});
const ask = (question: string) => ({ source_text: SAMPLE_AVS, language: "English", question });
const ok = { kind: "answer", quotes: [], lead_in: null, lead_in_dropped: null, dropped: [], model: "m", ms: 1 };

afterEach(() => { takeDailySlot.mockReset(); answerFromPaper.mockReset(); });

describe("/api/ask", () => {
  it("answers under the shared daily ceiling, in the 'ask' bucket", async () => {
    takeDailySlot.mockResolvedValue({ status: "ok", used: 1, limit: 1000 });
    answerFromPaper.mockResolvedValue(ok);
    const r = await POST(req(ask("when do I stop ibuprofen?")));
    expect(r.status).toBe(200);
    expect(takeDailySlot).toHaveBeenCalledWith("ask", expect.any(Number));
    expect(r.headers.get("x-atlas-limit")).toBe("shared-daily");
  });

  it("an urgent question never reaches the AI or spends a slot", async () => {
    const r = await POST(req(ask("I have chest pain and trouble breathing")));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ kind: "urgent" });
    expect(takeDailySlot).not.toHaveBeenCalled();
    expect(answerFromPaper).not.toHaveBeenCalled();
  });

  it("refuses with 429 and never calls the model when today's ceiling is used up", async () => {
    takeDailySlot.mockResolvedValue({ status: "over", used: 1001, limit: 1000 });
    const r = await POST(req(ask("can I drive?")));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(answerFromPaper).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the ceiling can't be checked", async () => {
    takeDailySlot.mockResolvedValue({ status: "unavailable" });
    const r = await POST(req(ask("can I drive?")));
    expect(r.status).toBe(503);
    expect(r.headers.get("x-atlas-limit")).toBe("unavailable");
    expect(answerFromPaper).not.toHaveBeenCalled();
  });

  it("rate limits one network address like the other AI routes (per-IP window)", async () => {
    takeDailySlot.mockResolvedValue({ status: "ok", used: 1, limit: 1000 });
    answerFromPaper.mockResolvedValue(ok);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await POST(req(ask("can I drive?"), "10.9.9.9"))).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(answerFromPaper).toHaveBeenCalledTimes(30);
  });

  it("refuses another site's browser", async () => {
    const r = await POST(new Request("http://localhost/api/ask", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "x-real-ip": "10.2.0.1" }, body: JSON.stringify(ask("can I drive?")),
    }));
    expect(r.status).toBe(403);
    expect(takeDailySlot).not.toHaveBeenCalled();
  });

  it("refuses an invalid request before it spends a slot", async () => {
    expect((await POST(req({ source_text: SAMPLE_AVS, question: "x".repeat(301) }))).status).toBe(400);
    expect((await POST(req({ source_text: "short", question: "can I drive?" }))).status).toBe(400);
    expect(takeDailySlot).not.toHaveBeenCalled();
  });

  it("never logs the question or the paper when the model fails", async () => {
    takeDailySlot.mockResolvedValue({ status: "ok", used: 1, limit: 1000 });
    answerFromPaper.mockRejectedValue(new Error("boom: can I drive?"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await POST(req(ask("can I drive?")));
    expect(r.status).toBe(500);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/drive|AFTER VISIT/);
    err.mockRestore();
  });
});
