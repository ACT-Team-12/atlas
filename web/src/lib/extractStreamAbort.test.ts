import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A model stream stub: writes the start of an answer, then waits until its signal aborts and rejects the way the SDK does.
const signals: AbortSignal[] = [];
vi.mock("@/lib/extractStream", async (importOriginal) => {
  const real = await importOriginal<typeof import("./extractStream")>();
  return {
    ...real,
    openModelStream: (_req: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return {
        text: (async function* () {
          yield '{"source_text":"","items":[';
          await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Request was aborted."))));
        })(),
        final: async () => ({ parsed: null, stopReason: "end_turn" }),
      };
    },
  };
});
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db", () => ({ isTestRequest: () => true, surfaceOf: () => "web", recordEvent: vi.fn() }));

const { POST } = await import("../app/api/extract/stream/route");

const REQ = { text: "Take 1 tablet of metformin by mouth 2 times a day.", language: "English", reading_level: "simple" } as const;

beforeEach(() => {
  signals.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cancelling a streamed read", () => {
  it("ends quietly when the person clears the paper mid-stream: no error logged, no error event", async () => {
    const ac = new AbortController();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost/api/extract/stream", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
      body: JSON.stringify(REQ),
      signal: ac.signal,
    });
    const res = await POST(request);
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    ac.abort(); // "Clear it from this device" while the model is still writing
    expect(signals[0].aborted).toBe(true);
    const body = await res.text();
    expect(body).not.toContain('"type":"error"');
    expect(error).not.toHaveBeenCalled();
  });
});
