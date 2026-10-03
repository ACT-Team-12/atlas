import { describe, expect, it, vi } from "vitest";

const synthesize = vi.fn(async (_text: string, _language: string, _opts?: { keep?: boolean }) => ({ audio: new ArrayBuffer(8), cached: false }));
vi.mock("../voice", async (orig) => ({ ...(await orig<typeof import("../voice")>()), synthesize }));

describe("the plan call's natural voice", () => {
  it("asks for audio that is never kept in the read-aloud cache, so it cannot outlive the call", async () => {
    const { defaultVoice } = await import("./flow");
    expect(await defaultVoice("Take one pill", "English")).toBeInstanceOf(ArrayBuffer);
    expect(synthesize).toHaveBeenCalledWith("Take one pill", "English", { keep: false });
  });
  it("is null (Vonage reads it instead) when the natural voice fails", async () => {
    const { defaultVoice } = await import("./flow");
    synthesize.mockRejectedValueOnce(new Error("down"));
    expect(await defaultVoice("x", "English")).toBeNull();
  });
});
