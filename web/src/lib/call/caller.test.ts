import { describe, expect, it } from "vitest";
import { callerId } from "./caller";

describe("caller id for the per-caller cap", () => {
  it("counts a whole IPv6 /64 as one caller (one home or phone gets a /64, so per-address keys are free to rotate)", () => {
    const a = callerId("s", "2001:db8:1:2:aaaa::1");
    expect(callerId("s", "2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(callerId("s", "2001:0db8:0001:0002::9")).toBe(a);
    expect(callerId("s", "2001:db8:1:3::1")).not.toBe(a);
  });
  it("keeps IPv4 per address, and treats an IPv4-mapped IPv6 address as that IPv4 address", () => {
    expect(callerId("s", "203.0.113.7")).not.toBe(callerId("s", "203.0.113.8"));
    expect(callerId("s", "::ffff:203.0.113.7")).toBe(callerId("s", "203.0.113.7"));
  });
  it("is an HMAC (no IP is stored) and depends on the secret", () => {
    expect(callerId("s", "203.0.113.7")).toMatch(/^[0-9a-f]{32}$/);
    expect(callerId("t", "203.0.113.7")).not.toBe(callerId("s", "203.0.113.7"));
  });
});
