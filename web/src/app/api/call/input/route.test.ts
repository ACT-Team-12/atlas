import { describe, expect, it, vi } from "vitest";

let store: unknown = null;
vi.mock("@/lib/call/store", async (orig) => ({ ...(await orig<typeof import("@/lib/call/store")>()), callStore: async () => store }));
vi.mock("@/lib/call/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/call/config")>()),
  callConfig: () => ({ applicationId: "a", privateKey: "k", from: "+19432445023", secret: "s", baseUrl: "https://atlas.example", siteDailyCap: 40, signatureSecret: null }),
}));
vi.spyOn(console, "warn").mockImplementation(() => {});
const input = await import("./route");
const { signTicket } = await import("@/lib/call/config");

const req = () => {
  const t = encodeURIComponent(signTicket("s", { k: "x", p: "input", g: 0 }));
  return new Request(`https://atlas.example/api/call/input?t=${t}`, {
    method: "POST", headers: { "x-real-ip": "10.1.2.1", "content-type": "application/json" },
    body: JSON.stringify({ uuid: "call-2", dtmf: { digits: "4821" } }),
  });
};

describe("keypad input when the call store cannot be opened", () => {
  it("answers 503 (an outage), never a 200 goodbye that would end the verified caller's call as handled", async () => {
    store = null;
    const r = await input.POST(req());
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("talk");
  });
});
