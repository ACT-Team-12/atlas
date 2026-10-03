import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The measured length is what this test controls; the real parser is covered in audioMeasure.test.ts.
const measure = vi.hoisted(() => ({ seconds: 0 }));
vi.mock("./audioMeasure", () => ({ measureAudio: () => ({ container: "audio/webm", seconds: measure.seconds }) }));
import { answerAloud, issueQuizToken, MAX_RECORDING_SECONDS, OVER_PRODUCT_LIMIT } from "./transcribe";
import { clientKey, localUsageForTests } from "./sttUsage";

const SECRET = "s3cret";
const T = Date.UTC(2026, 9, 3, 12);
const hour = Math.floor(T / 3_600_000);
const IP = "192.0.2.77";
const clip = () => new Uint8Array(readFileSync(new URL("./__fixtures__/short.webm", import.meta.url)));
const dg = (duration: number) =>
  new Response(JSON.stringify({ metadata: { duration }, results: { channels: [{ alternatives: [{ transcript: "ok" }] }] } }), { status: 200 });

/** The server matches the privacy page: 20 s of recording (plus 1 s encoder slack), not the parser's 35 s ceiling. */
describe("the 20 second product limit is enforced on the server", () => {
  const fetchMock = vi.fn();
  let store = localUsageForTests();
  const go = () => answerAloud({ audio: clip(), type: "audio/webm", language: "English", token: issueQuizToken("English", 5, SECRET, T)!, ip: IP, now: T, store });
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test");
    vi.stubEnv("FEEDBACK_SECRET", SECRET);
    fetchMock.mockReset();
    store = localUsageForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("is 21 s: 20 s plus 1 s of encoder slack", () => {
    expect(MAX_RECORDING_SECONDS).toBe(21);
  });

  it("accepts a recording measured at 20.5 s", async () => {
    measure.seconds = 20.5;
    fetchMock.mockResolvedValue(dg(20.5));
    await expect(go()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses 22 s with a plain message, before any provider call or reservation", async () => {
    measure.seconds = 22;
    await expect(go()).rejects.toMatchObject({ status: 413, message: OVER_PRODUCT_LIMIT });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.used("lgh", hour)).toBe(0);
    expect(store.used(`lch:${clientKey(IP, SECRET)}`, hour)).toBe(0);
  });
});
