import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { StreamBroken } from "./extractEvents";
import { ReadCancelled, streamThenPlain } from "./readCancel";

const PAPER = "Take 1 tablet of metformin by mouth 2 times a day.";

/** A recording fetch: the stream request stalls until `breakStream()`, then fails the way a cut connection does. */
function harness() {
  const sent: { url: string; body: string }[] = [];
  let breakStream = () => {};
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });
    if (url.endsWith("/stream")) {
      await new Promise<void>((r) => { breakStream = r; });
      throw new StreamBroken("Network error");
    }
    return { ok: true, json: async () => ({ items: [] }) };
  });
  const body = JSON.stringify({ text: PAPER });
  const stream = (signal: AbortSignal) => fetchMock("/api/extract/stream", { body, signal });
  const plain = (signal: AbortSignal) => fetchMock("/api/extract", { body, signal });
  return { sent, stream, plain, breakStream: () => breakStream() };
}

describe("a read whose stream breaks", () => {
  it("is read again the plain way when nothing cleared it", async () => {
    const h = harness();
    const ac = new AbortController();
    const onBroken = vi.fn();
    const p = streamThenPlain(h.stream, h.plain, ac.signal, () => true, onBroken);
    await Promise.resolve();
    h.breakStream();
    await expect(p).resolves.toEqual({ ok: true, json: expect.any(Function) });
    expect(h.sent.map((s) => s.url)).toEqual(["/api/extract/stream", "/api/extract"]);
    expect(onBroken).toHaveBeenCalledTimes(1);
  });

  it("after Clear, no second request carries the paper", async () => {
    const h = harness();
    const ac = new AbortController();
    const onBroken = vi.fn();
    const p = streamThenPlain(h.stream, h.plain, ac.signal, () => true, onBroken);
    await Promise.resolve();
    ac.abort(); // "Clear it from this device" while the stream is still open
    h.breakStream();
    await expect(p).rejects.toBeInstanceOf(ReadCancelled);
    expect(h.sent).toHaveLength(1);
    expect(h.sent.filter((s) => s.body.includes(PAPER))).toHaveLength(1);
    expect(onBroken).not.toHaveBeenCalled();
  });

  it("a read replaced by a newer one is not retried either", async () => {
    const h = harness();
    let current = true;
    const p = streamThenPlain(h.stream, h.plain, new AbortController().signal, () => current);
    await Promise.resolve();
    current = false;
    h.breakStream();
    await expect(p).rejects.toBeInstanceOf(ReadCancelled);
    expect(h.sent).toHaveLength(1);
  });

  it("any other failure is passed on unchanged and never retried", async () => {
    const plain = vi.fn();
    const err = new Error("This paper is too long.");
    await expect(streamThenPlain(() => Promise.reject(err), plain, new AbortController().signal, () => true)).rejects.toBe(err);
    expect(plain).not.toHaveBeenCalled();
  });
});

describe("the care-plan screen's read", () => {
  const ui = readFileSync(new URL("../ui/CarePlanTool.tsx", import.meta.url), "utf8");
  const body = (name: string) => {
    const at = ui.indexOf(`function ${name}(`);
    expect(at, name).toBeGreaterThanOrEqual(0);
    return ui.slice(at, ui.indexOf("\n  }\n", at));
  };

  it("retries only through streamThenPlain, with the read's own abort signal", () => {
    const read = body("readPaper");
    expect(read).toMatch(/streamThenPlain\(/);
    expect(read).toMatch(/ac\.signal, \(\) => readRun\.current === run/);
    expect(read).not.toMatch(/catch \(e\) \{\s*if \(!\(e instanceof StreamBroken\)\)/);
    // A photo is converted before it is sent; a Clear during that must stop it.
    expect(read).toMatch(/fileToBase64[\s\S]*if \(readRun\.current !== run\) return;[\s\S]*streamThenPlain/);
  });

  it("a stale read cannot set an error or end a newer read", () => {
    const read = body("readPaper");
    expect(read).toMatch(/catch \(e\) \{ if \(readRun\.current === run\) \{/);
    expect(read).toMatch(/finally \{ if \(readRun\.current === run\) setReading\(false\); \}/);
  });

  it("erasing the open paper aborts the read in flight", () => {
    expect(body("eraseOpenPaper")).toMatch(/readAbort\.current\?\.abort\(\);/);
  });
});
