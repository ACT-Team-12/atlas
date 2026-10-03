import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const req = (ip: string) => new Request("https://atlas.example/api/call/answer", { method: "POST", headers: { "x-real-ip": ip } });

describe("/api/call/answer (an inbound call to the ATLAS app)", () => {
  it("answers with one short goodbye and nothing else: no input, no stream, no connect, no plan data", async () => {
    for (const handler of [GET, POST]) {
      const ncco = (await (await handler(req("198.51.100.1"))).json()) as { action: string; text?: string }[];
      expect(ncco.map((a) => a.action)).toEqual(["talk"]);
      expect(String(ncco[0].text).length).toBeLessThanOrEqual(20);
    }
  });
  it("has its own small rate-limit bucket, so inbound calls cannot drain the callback bucket", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await POST(req("198.51.100.9"))).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});
