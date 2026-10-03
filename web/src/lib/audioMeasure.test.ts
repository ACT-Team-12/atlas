import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureAudio, opusPacketMs, sniffContainer } from "./audioMeasure";

const fx = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));

describe("measuring a recording before any paid call (Codex review, 2026-10-02)", () => {
  // Durations from ffprobe on the same files: short ~1.0 s, long45 ~45 s.
  it.each([
    ["short.webm", "audio/webm", 1.0],
    ["short-live.webm", "audio/webm", 1.0], // unknown-size Segment and Cluster, like Chrome's MediaRecorder
    ["short.m4a", "audio/mp4", 1.0],
    ["short-frag.mp4", "audio/mp4", 1.0], // fragmented, like Safari's MediaRecorder
    ["long45.webm", "audio/webm", 45],
    ["long45-frag.mp4", "audio/mp4", 45],
    // Real MediaRecorder output, recorded in Playwright's Chromium and WebKit (an oscillator for about 2.8 s).
    ["chromium-mediarecorder.webm", "audio/webm", 2.76],
    ["webkit-mediarecorder.mp4", "audio/mp4", 2.82],
  ])("%s is %s of about %ss", (name, container, seconds) => {
    const m = measureAudio(fx(name));
    expect(m?.container).toBe(container);
    expect(m!.seconds).toBeGreaterThan(seconds - 0.2);
    expect(m!.seconds).toBeLessThan(seconds + 0.2);
  });

  it("reads live recordings whose Segment and Cluster sizes are 'unknown' (all ones)", () => {
    const b = fx("short.webm");
    let marked = 0;
    for (const id of [[0x18, 0x53, 0x80, 0x67], [0x1f, 0x43, 0xb6, 0x75]]) {
      for (let i = 0; i + 4 < b.length; i++) {
        if (b[i] !== id[0] || b[i + 1] !== id[1] || b[i + 2] !== id[2] || b[i + 3] !== id[3]) continue;
        const first = b[i + 4];
        let len = 1;
        while (!(first & (0x80 >> (len - 1)))) len++;
        b[i + 4] = (0x80 >> (len - 1)) | (0xff >> len);
        for (let k = 1; k < len; k++) b[i + 4 + k] = 0xff;
        marked++;
      }
    }
    expect(marked).toBeGreaterThanOrEqual(2);
    expect(measureAudio(b)?.seconds).toBeCloseTo(measureAudio(fx("short.webm"))!.seconds, 3);
  });

  it("reads WebKit's WebM recording (no duration in its header) as a few seconds", () => {
    const m = measureAudio(fx("webkit-mediarecorder.webm"));
    expect(m?.container).toBe("audio/webm");
    expect(m!.seconds).toBeGreaterThan(1);
    expect(m!.seconds).toBeLessThan(5);
  });

  it("identifies the container by its bytes, not by what the sender says", () => {
    expect(sniffContainer(fx("short.webm"))).toBe("audio/webm");
    expect(sniffContainer(fx("short.m4a"))).toBe("audio/mp4");
    expect(sniffContainer(new TextEncoder().encode("OggS....not allowed"))).toBeNull();
    expect(measureAudio(new Uint8Array(4000).fill(3))).toBeNull();
  });

  it("refuses a file it cannot fully read", () => {
    const b = fx("short.webm").slice(0, 40);
    expect(measureAudio(b)?.seconds ?? 0).toBeLessThan(0.1); // a header only holds no audio
    const junk = fx("short.webm");
    junk[4] = 0x00; // breaks the first size field
    expect(measureAudio(junk)).toBeNull();
  });

  it("counts Opus frames from each packet, so silent-gap timestamps cannot hide length", () => {
    expect(opusPacketMs(new Uint8Array([0xfc]))).toBe(20); // CELT 20 ms, one frame
    expect(opusPacketMs(new Uint8Array([(31 << 3) | 3, 6]))).toBe(120); // six 20 ms frames
    expect(opusPacketMs(new Uint8Array([(31 << 3) | 3, 7]))).toBeNull(); // over 120 ms is invalid
    // A hand-built WebM: one track, 400 blocks of 120 ms each = 48 s, all with timecode 0.
    const sizeOf = (n: number) => [0x10, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; // a 4-byte EBML size
    const el = (id: number[], body: number[]) => [...id, ...sizeOf(body.length), ...body];
    const codec = el([0x86], [...new TextEncoder().encode("A_OPUS")]);
    const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], codec));
    const block = el([0xa3], [0x81, 0, 0, 0x80, (31 << 3) | 3, 6]);
    const cluster = el([0x1f, 0x43, 0xb6, 0x75], Array.from({ length: 400 }, () => block).flat());
    const file = new Uint8Array([...el([0x1a, 0x45, 0xdf, 0xa3], []), ...el([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster])]);
    expect(measureAudio(file)?.seconds).toBe(48);
  });
});
