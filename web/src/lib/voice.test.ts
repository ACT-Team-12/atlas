import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, MAX_SPEAK_CHARS, SpeakRequestSchema, synthesize, VOICE_LANG, VoiceError } from "./voice";
import { LANGUAGES } from "./schema";

const mp3 = (n = 4000) => new Uint8Array(n).fill(7).buffer;

describe("natural voice", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    fetchMock.mockReset();
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

  it("caps the request size", () => {
    expect(SpeakRequestSchema.safeParse({ text: "x".repeat(MAX_SPEAK_CHARS + 1) }).success).toBe(false);
    expect(SpeakRequestSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(SpeakRequestSchema.parse({ text: "hi" }).language).toBe("English");
  });
});
