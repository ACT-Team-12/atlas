import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const aiMock = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("ai", () => ({ gateway: { transcription: (id: string) => ({ id }) }, transcribe: aiMock.transcribe }));
import { GET, POST } from "@/app/api/transcribe/route";
import { LANGUAGES } from "./schema";
import {
  chargeSeconds, DAILY_AUDIO_SECONDS, GATEWAY_STT_MODEL, sttProvider, HOURLY_AUDIO_SECONDS, issueQuizToken, MAX_AUDIO_BYTES, QUIZ_TOKEN_TTL_MS, resetTranscribeStateForTests,
  STT_LANG, transcribe, USES_PER_TOKEN, verifyQuizToken,
} from "./transcribe";

const SECRET = "s3cret";
const audio = (n = 4000) => new Uint8Array(n).fill(3);
const dg = (transcript: string, duration = 4) =>
  new Response(JSON.stringify({ metadata: { duration }, results: { channels: [{ alternatives: [{ transcript }] }] } }), { status: 200 });

let ip = 0;
function post(opts: { token?: string | null; language?: string; body?: Uint8Array; type?: string; headers?: Record<string, string> } = {}) {
  const language = opts.language ?? "English";
  const token = opts.token === undefined ? issueQuizToken(language, SECRET) : opts.token;
  const qs = new URLSearchParams({ language, ...(token ? { token } : {}) });
  return POST(new Request(`http://localhost/api/transcribe?${qs}`, {
    method: "POST",
    headers: { "content-type": opts.type ?? "audio/webm", "x-real-ip": `10.0.0.${++ip % 250}`, ...opts.headers },
    body: (opts.body ?? audio()) as BodyInit,
  }));
}

describe("say your answer (speech to text)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test");
    vi.stubEnv("FEEDBACK_SECRET", SECRET);
    fetchMock.mockReset();
    resetTranscribeStateForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("covers every language except Amharic, which Deepgram does not transcribe", () => {
    expect(LANGUAGES.filter((l) => !STT_LANG[l])).toEqual(["Amharic"]);
  });

  it("config is off without a key or gateway, so no mic shows", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    expect(await GET().json()).toEqual({ enabled: false, languages: [], provider: null });
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test");
    vi.stubEnv("FEEDBACK_SECRET", "");
    expect((await GET().json()).enabled).toBe(false);
  });

  it("config is on with the key and lists the supported languages", async () => {
    const j = await GET().json();
    expect(j.enabled).toBe(true);
    expect(j.languages).toContain("Spanish");
    expect(j.languages).not.toContain("Amharic");
  });

  it("refuses with 503 and never calls out when no provider is configured", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const r = await post();
    expect(r.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without a quiz token, with a forged one, or one for another language", async () => {
    expect((await post({ token: null })).status).toBe(403);
    expect((await post({ token: "123.forged" })).status).toBe(403);
    expect((await post({ language: "English", token: issueQuizToken("Spanish", SECRET) })).status).toBe(403);
    expect((await post({ token: issueQuizToken("English", "other-secret") })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("quiz tokens expire", () => {
    const tok = issueQuizToken("English", SECRET, 1_000)!;
    expect(verifyQuizToken(tok, "English", SECRET, 2_000)).toBe(true);
    expect(verifyQuizToken(tok, "English", SECRET, 1_000 + QUIZ_TOKEN_TTL_MS + 1)).toBe(false);
    expect(issueQuizToken("English", "")).toBeNull();
  });

  it("refuses oversize audio (413) without calling out, whether or not it declares its length", async () => {
    expect((await post({ body: audio(MAX_AUDIO_BYTES + 1) })).status).toBe(413);
    expect((await post({ body: audio(10), headers: { "content-length": String(MAX_AUDIO_BYTES + 1) } })).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses non-audio and empty recordings", async () => {
    expect((await post({ type: "application/json" })).status).toBe(415);
    expect((await post({ body: audio(10) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nova-3, the language, smart_format and the model-improvement opt-out, and returns only the transcript", async () => {
    fetchMock.mockResolvedValue(dg(" Two tablets in the morning. "));
    const r = await post({ language: "Spanish", type: "audio/mp4" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ transcript: "Two tablets in the morning." });
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.deepgram.com/v1/listen");
    expect(Object.fromEntries(u.searchParams)).toEqual({ model: "nova-3", language: "es", smart_format: "true", mip_opt_out: "true" });
    expect(init.headers.Authorization).toBe("Token dg-test");
    expect(init.headers["content-type"]).toBe("audio/mp4");
  });

  it("answers a Deepgram failure honestly and logs the status only", async () => {
    fetchMock.mockResolvedValue(new Response("secret words", { status: 500 }));
    const r = await post();
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/couldn't hear/);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("secret words");
  });

  it("refuses Amharic with 422 without calling out", async () => {
    await expect(transcribe(audio(), "audio/webm", "Amharic")).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits uses per quiz token", async () => {
    fetchMock.mockImplementation(async () => dg("ok", 1));
    const token = issueQuizToken("English", SECRET)!;
    for (let i = 0; i < USES_PER_TOKEN; i++) expect((await post({ token })).status).toBe(200);
    expect((await post({ token })).status).toBe(429);
  });

  it("has an hourly and a daily fuse on audio seconds, settled to the real length", () => {
    const t = Date.UTC(2026, 9, 2, 12);
    expect(chargeSeconds(HOURLY_AUDIO_SECONDS, t)).toBe(true);
    expect(chargeSeconds(1, t)).toBe(false);
    expect(chargeSeconds(-10, t)).toBe(true); // a refund
    expect(chargeSeconds(10, t)).toBe(true);
    resetTranscribeStateForTests();
    let hour = t;
    let used = 0;
    while (used + HOURLY_AUDIO_SECONDS <= DAILY_AUDIO_SECONDS) { expect(chargeSeconds(HOURLY_AUDIO_SECONDS, hour)).toBe(true); used += HOURLY_AUDIO_SECONDS; hour += 3_600_000; }
    if (Math.floor(hour / 86_400_000) === Math.floor(t / 86_400_000)) expect(chargeSeconds(HOURLY_AUDIO_SECONDS, hour)).toBe(false);
  });

  it("a tripped fuse answers 429 without calling out", async () => {
    chargeSeconds(HOURLY_AUDIO_SECONDS);
    expect((await post()).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("speech to text provider order", () => {
  it("prefers Deepgram, falls back to the gateway, and the kill switch wins", () => {
    expect(sttProvider({ DEEPGRAM_API_KEY: "k", VERCEL: "1" })).toBe("deepgram");
    expect(sttProvider({ VERCEL: "1" })).toBe("gateway");
    expect(sttProvider({ VERCEL_OIDC_TOKEN: "t" })).toBe("gateway");
    expect(sttProvider({})).toBeNull();
    expect(sttProvider({ ATLAS_STT_DISABLED: "1", DEEPGRAM_API_KEY: "k", VERCEL: "1" })).toBeNull();
  });
});

describe("gateway path (no Deepgram key)", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-test");
    vi.stubEnv("FEEDBACK_SECRET", SECRET);
    resetTranscribeStateForTests();
    aiMock.transcribe.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("config is on and names the gateway provider", async () => {
    const j = await GET().json();
    expect(j.enabled).toBe(true);
    expect(j.provider).toMatch(/Vercel AI Gateway/);
  });

  it("asks only for zero-data-retention providers and returns only the text", async () => {
    aiMock.transcribe.mockResolvedValue({ text: " Take one tablet. ", durationInSeconds: 2 });
    const r = await post();
    expect(await r.json()).toEqual({ transcript: "Take one tablet." });
    const call = aiMock.transcribe.mock.calls[0][0];
    expect(call.model).toEqual({ id: GATEWAY_STT_MODEL });
    expect(call.providerOptions.gateway).toEqual({ zeroDataRetention: true, disallowPromptTraining: true });
    expect(call.maxRetries).toBe(0);
  });

  it("answers a gateway failure honestly", async () => {
    aiMock.transcribe.mockRejectedValue(Object.assign(new Error("boom words"), { statusCode: 500 }));
    const r = await post();
    expect(r.status).toBe(502);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("boom words");
  });

  it("the kill switch turns it off (503, no call)", async () => {
    vi.stubEnv("ATLAS_STT_DISABLED", "1");
    expect((await GET().json()).enabled).toBe(false);
    expect((await post()).status).toBe(503);
    expect(aiMock.transcribe).not.toHaveBeenCalled();
  });
});
