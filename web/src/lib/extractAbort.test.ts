import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A model stub: records each call's options and only settles when its signal aborts (like a long read).
const calls: { signal?: AbortSignal }[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      parse: (_params: unknown, opts?: { signal?: AbortSignal }) => {
        calls.push({ signal: opts?.signal });
        return new Promise((_, reject) => {
          if (opts?.signal?.aborted) return reject(new Error("aborted before start"));
          opts?.signal?.addEventListener("abort", () => reject(new Error("Request was aborted.")));
        });
      },
    };
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db", () => ({ isTestRequest: () => true, surfaceOf: () => "web", recordEvent: vi.fn() }));

const { extractCarePlan } = await import("./extract");
const { POST } = await import("../app/api/extract/route");

const REQ = { text: "Take 1 tablet of metformin by mouth 2 times a day.", language: "English", reading_level: "simple" } as const;

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cancelling a plain read", () => {
  it("passes the request's signal to the model call, and aborting it ends the call", async () => {
    const ac = new AbortController();
    const p = extractCarePlan(REQ, ac.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal).toBe(ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });

  it("never starts the model call for a request that was already cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(extractCarePlan(REQ, ac.signal)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("the route hands the model its own request signal and answers quietly once the person has gone", async () => {
    const ac = new AbortController();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9" },
      body: JSON.stringify(REQ),
      signal: ac.signal,
    });
    const res = POST(request);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].signal?.aborted).toBe(false);
    ac.abort(); // "Clear it from this device" while the model is still reading
    expect(calls[0].signal?.aborted).toBe(true);
    const out = await res;
    expect(out.status).toBe(499);
    expect(await out.text()).toBe("");
    expect(error).not.toHaveBeenCalled();
  });
});
