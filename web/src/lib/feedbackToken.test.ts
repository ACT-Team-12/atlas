import { describe, expect, it } from "vitest";
import { FEEDBACK_TOKEN_TTL_MS, issueFeedbackToken, verifyFeedbackToken } from "./feedbackToken";

const S = "test-secret-not-real";
describe("feedback tokens", () => {
  it("round-trips and returns the nonce", () => {
    const t = issueFeedbackToken(S, 1_000_000)!;
    expect(verifyFeedbackToken(t, S, 1_000_000 + 5_000)).toBe(t.split(".")[0]);
  });
  it("rejects a forged, tampered, expired or wrong-secret token", () => {
    const t = issueFeedbackToken(S, 1_000_000)!;
    expect(verifyFeedbackToken("abc.123.def", S, 1_000_000)).toBeNull();
    expect(verifyFeedbackToken(t.replace(/\.\d+\./, ".999999999999."), S, 1_000_000)).toBeNull();
    expect(verifyFeedbackToken(t, S, 1_000_000 + FEEDBACK_TOKEN_TTL_MS + 1)).toBeNull();
    expect(verifyFeedbackToken(t, "other-secret", 1_000_000)).toBeNull();
  });
  it("issues nothing without a secret, so feedback is closed rather than unauthenticated", () => {
    expect(issueFeedbackToken(undefined)).toBeNull();
    expect(verifyFeedbackToken("a.b.c", undefined)).toBeNull();
  });
  it("gives every plan a different nonce", () => {
    expect(issueFeedbackToken(S)!.split(".")[0]).not.toBe(issueFeedbackToken(S)!.split(".")[0]);
  });
});
