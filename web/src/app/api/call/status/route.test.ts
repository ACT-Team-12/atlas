import { describe, expect, it, vi } from "vitest";
import { CallStoreDown } from "@/lib/call/store";

const store = { sweep: vi.fn(async () => true), get: vi.fn(async (): Promise<unknown> => null), getAudio: vi.fn(async () => null) };
vi.mock("@/lib/call/store", async (orig) => ({ ...(await orig<typeof import("@/lib/call/store")>()), callStore: async () => store }));
vi.mock("@/lib/call/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/call/config")>()),
  callConfig: () => ({ applicationId: "a", privateKey: "k", from: "+19432445023", secret: "s", baseUrl: "https://atlas.example", siteDailyCap: 40, signatureSecret: null }),
}));
const status = await import("./route");
const audio = await import("../audio/route");
const { signTicket } = await import("@/lib/call/config");

const post = (body: unknown) => new Request("https://atlas.example/api/call/status", { method: "POST", headers: { "x-real-ip": "10.1.1.1", "content-type": "application/json" }, body: JSON.stringify(body) });

describe("call routes keep 'database down' apart from 'no such session'", () => {
  it("status: absent is 200 gone, a database error is 503", async () => {
    const absent = await status.POST(post({ id: "x" }));
    expect([absent.status, await absent.json()]).toEqual([200, { phase: "gone" }]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    store.get.mockRejectedValueOnce(new CallStoreDown());
    expect((await status.POST(post({ id: "x" }))).status).toBe(503);
  });
  it("audio: absent is 404, a database error is 503", async () => {
    const t = encodeURIComponent(signTicket("s", { k: "x", p: "audio" }));
    const req = () => new Request(`https://atlas.example/api/call/audio?t=${t}`, { headers: { "x-real-ip": "10.1.1.2" } });
    expect((await audio.GET(req())).status).toBe(404);
    store.get.mockRejectedValueOnce(new CallStoreDown());
    expect((await audio.GET(req())).status).toBe(503);
  });
});
