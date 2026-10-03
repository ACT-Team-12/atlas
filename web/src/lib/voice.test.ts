import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, chargeBudget, HOURLY_CHAR_BUDGET, MAX_SPEAK_CHARS, resetVoiceStateForTests, SpeakRequestSchema, synthesize, VOICE_LANG, VoiceError } from "./voice";
import { issueSpeakToken, verifySpeakToken, SPEAK_TOKEN_TTL_MS } from "./speakToken";
import { paidSpeechText as speechText } from "./speechText";
import { LANGUAGES } from "./schema";

const mp3 = (n = 4000) => new Uint8Array(n).fill(7).buffer;

describe("natural voice", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    fetchMock.mockReset();
    resetVoiceStateForTests();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("covers every language except Amharic, which keeps the phone's voice", () => {
    const missing = LANGUAGES.filter((l) => !VOICE_LANG[l]);
    expect(missing).toEqual(["Amharic"]);
  });

  it("refuses Amharic with 422 and never calls out", async () => {
    await expect(synthesize("Selam", "Amharic")).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is off (503) without a key and never calls out", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    await expect(synthesize("hello", "English")).rejects.toBeInstanceOf(VoiceError);
    await expect(synthesize("hello", "English")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the language code and model, then serves a repeat from memory", async () => {
    fetchMock.mockResolvedValue(new Response(mp3(), { status: 200 }));
    const text = `Toma una tableta cada mañana ${Math.random()}`;
    const a = await synthesize(text, "Spanish");
    expect(a.cached).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/text-to-speech/");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ text, model_id: "eleven_flash_v2_5", language_code: "es" });
    expect(init.headers["xi-api-key"]).toBe("test-key");
    const b = await synthesize(text, "Spanish");
    expect(b.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a phone call's audio (keep: false) is never cached, and leaves no copy of the same text behind", async () => {
    fetchMock.mockImplementation(async () => new Response(mp3(), { status: 200 }));
    const text = `Your plan ${Math.random()}`;
    expect((await synthesize(text, "English", { keep: false })).cached).toBe(false);
    expect((await synthesize(text, "English")).cached).toBe(false); // nothing was kept by the call
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // the page read it aloud first (now cached): the call does not use that copy, and evicts it
    expect((await synthesize(text, "English", { keep: false })).cached).toBe(false);
    expect((await synthesize(text, "English")).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("a page read-aloud that starts during a call and ends after it does not cache either", async () => {
    let releaseCall!: () => void;
    let releasePage!: () => void;
    const callGate = new Promise<void>((r) => { releaseCall = r; });
    const pageGate = new Promise<void>((r) => { releasePage = r; });
    fetchMock.mockImplementationOnce(async () => { await callGate; return new Response(mp3(), { status: 200 }); });
    fetchMock.mockImplementationOnce(async () => { await pageGate; return new Response(mp3(), { status: 200 }); });
    const text = `Your plan ${Math.random()}`;
    const call = synthesize(text, "English", { keep: false });
    const page = synthesize(text, "English");
    releaseCall();
    await call;
    releasePage();
    await page;
    fetchMock.mockImplementation(async () => new Response(mp3(), { status: 200 }));
    expect((await synthesize(text, "English")).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a page read-aloud of the same text running during a call does not leave it cached", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementation(async () => { await gate; return new Response(mp3(), { status: 200 }); });
    const text = `Your plan ${Math.random()}`;
    const page = synthesize(text, "English");
    const call = synthesize(text, "English", { keep: false });
    release();
    await page;
    await call;
    expect(fetchMock).toHaveBeenCalledTimes(2); // the call did not join the page's request
    fetchMock.mockImplementation(async () => new Response(mp3(), { status: 200 }));
    expect((await synthesize(text, "English")).cached).toBe(false); // the call's finish evicted the page's copy
  });

  it("turns a vendor error or empty audio into a 502 the page answers with the phone's voice", async () => {
    fetchMock.mockResolvedValueOnce(new Response("quota", { status: 429 }));
    await expect(synthesize(`a ${Math.random()}`, "English")).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(new Response(mp3(10), { status: 200 }));
    await expect(synthesize(`b ${Math.random()}`, "English")).rejects.toMatchObject({ status: 502 });
  });

  it("keys the cache by language and text, so the same words in two languages are two entries", () => {
    expect(cacheKey("English", "hi")).not.toBe(cacheKey("Spanish", "hi"));
    expect(cacheKey("English", "a\u0000b")).not.toBe(cacheKey("English\u0000a", "b"));
  });

  it("caps the request size and requires a token", () => {
    expect(SpeakRequestSchema.safeParse({ text: "x".repeat(MAX_SPEAK_CHARS + 1), token: "t" }).success).toBe(false);
    expect(SpeakRequestSchema.safeParse({ text: "   ", token: "t" }).success).toBe(false);
    expect(SpeakRequestSchema.safeParse({ text: "hi" }).success).toBe(false);
    expect(SpeakRequestSchema.parse({ text: " hi ", token: "t" })).toMatchObject({ language: "English", text: " hi " });
  });

  it("makes one paid call for identical requests that arrive together", async () => {
    let release!: () => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { release = () => r(new Response(mp3(), { status: 200 })); }));
    const a = synthesize("same words", "English"), b = synthesize("same words", "English");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra.audio.byteLength).toBe(rb.audio.byteLength);
  });

  it("stops paying past the hourly character fuse", async () => {
    const t = 1_000 * 3_600_000;
    expect(chargeBudget(HOURLY_CHAR_BUDGET, t)).toBe(true);
    expect(chargeBudget(1, t)).toBe(false);
    expect(chargeBudget(1, t + 3_600_000)).toBe(true); // next hour
    resetVoiceStateForTests();
    for (let i = 0; i < Math.floor(HOURLY_CHAR_BUDGET / MAX_SPEAK_CHARS); i++) chargeBudget(MAX_SPEAK_CHARS);
    await expect(synthesize("x".repeat(MAX_SPEAK_CHARS), "English")).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("speak token", () => {
  const plan = { summary: "Get your blood test this week.", steps: [{ title: "Lab", action: "Go Friday" }] } as Parameters<typeof speechText>[0];
  const text = speechText(plan);

  it("accepts only the plan's own text and language", () => {
    const tok = issueSpeakToken("Spanish", text, "s3cret", 1_000)!;
    expect(verifySpeakToken(tok, "Spanish", text, "s3cret", 2_000)).toBe(true);
    expect(verifySpeakToken(tok, "Spanish", text + " and buy crypto", "s3cret", 2_000)).toBe(false);
    expect(verifySpeakToken(tok, "English", text, "s3cret", 2_000)).toBe(false);
    expect(verifySpeakToken(tok, "Spanish", text, "other", 2_000)).toBe(false);
  });

  it("expires, refuses tampering, and is off without a secret", () => {
    const tok = issueSpeakToken("English", text, "s3cret", 1_000)!;
    expect(verifySpeakToken(tok, "English", text, "s3cret", 1_000 + SPEAK_TOKEN_TTL_MS + 1)).toBe(false);
    const [t, sig] = tok.split(".");
    expect(verifySpeakToken(`${Number(t) + 1}.${sig}`, "English", text, "s3cret", 2_000)).toBe(false);
    expect(verifySpeakToken("garbage", "English", text, "s3cret", 2_000)).toBe(false);
    expect(issueSpeakToken("English", text, "")).toBeNull();
    expect(verifySpeakToken(tok, "English", text, "")).toBe(false);
  });

  it("signs exactly what the page reads aloud", () => {
    expect(text).toBe("This plan is a suggestion from ATLAS, not your paper. If anything differs, follow your paper.\nGet your blood test this week.\n1. Lab. Go Friday");
  });
});
