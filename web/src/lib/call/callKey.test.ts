import { describe, expect, it } from "vitest";
import { callMeKey } from "./callKey";

describe("the identity a CallMe panel is keyed by", () => {
  const a = { summary: "Take your pills.", speak_token: "1700000000000.aaaa" };
  const b = { summary: "Take your pills.", speak_token: "1700000999999.bbbb" };
  it("differs for two plans with the same summary (switching saved plans starts a fresh call panel)", () => {
    expect(callMeKey("English", a)).not.toBe(callMeKey("English", b));
  });
  it("differs by language, and is stable for the same plan", () => {
    expect(callMeKey("Spanish", a)).not.toBe(callMeKey("English", a));
    expect(callMeKey("English", { ...a })).toBe(callMeKey("English", a));
  });
});
