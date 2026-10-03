import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { resetTranscribeStateForTests, sttProvider, transcribe } from "./transcribe";

/**
 * One real call through our own transcribe(), only when asked: STT_LIVE_CLIPS=path.webm:audio/webm,...
 * The provider comes from the environment (DEEPGRAM_API_KEY for Deepgram, else the gateway's OIDC token).
 * Skipped in CI and in a normal `pnpm test`. Prints the transcript and latency, never a credential.
 */
const clips = (process.env.STT_LIVE_CLIPS ?? "").split(",").filter(Boolean);

describe.skipIf(clips.length === 0)("live speech to text", () => {
  it.each(clips)("transcribes %s", async (spec) => {
    vi.stubEnv("FEEDBACK_SECRET", "live");
    resetTranscribeStateForTests();
    const [path, type] = spec.split(":");
    const t0 = Date.now();
    const text = await transcribe(new Uint8Array(readFileSync(path)), type, "English");
    console.log(JSON.stringify({ provider: sttProvider(), type, ms: Date.now() - t0, text }));
    expect(text.toLowerCase()).toContain("tablet");
  }, 30_000);
});
