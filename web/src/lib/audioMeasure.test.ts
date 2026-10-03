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
    const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], [...el([0xd7], [1]), ...el([0x83], [2]), ...codec])); // track 1, audio
    const block = el([0xa3], [0x81, 0, 0, 0x80, (31 << 3) | 3, 6]);
    const cluster = el([0x1f, 0x43, 0xb6, 0x75], Array.from({ length: 400 }, () => block).flat());
    const file = new Uint8Array([...el([0x1a, 0x45, 0xdf, 0xa3], []), ...el([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster])]);
    expect(measureAudio(file)?.seconds).toBe(48);
  });
});

/**
 * Files built to make our measurement and a real decoder disagree (security review, 2026-10-02). For each, ffmpeg 8
 * was the ground truth: it decoded 2.82 s from the oversize-Void file and 2.04 s from the repeated edit list, while
 * the first version of this parser measured 0 s and 1.07 s. Anything we do not fully understand must be refused.
 */
describe("parser differentials fail closed", () => {
  it("WebM: an element that runs past the end is refused (ffmpeg resyncs past it and decodes the rest)", () => {
    expect(measureAudio(fx("crafted-oversize-void.webm"))).toBeNull();
  });

  it("WebM: an element ID we do not know is refused", () => {
    expect(measureAudio(fx("crafted-unknown-element.webm"))).toBeNull();
  });

  it("WebM: trailing junk is refused", () => {
    const b = fx("chromium-mediarecorder.webm");
    expect(measureAudio(new Uint8Array([...b, 0x42, 0x42, 0x42]))).toBeNull();
  });

  it("MP4: an edit list that plays the media twice is refused (ffmpeg decodes 2x)", () => {
    expect(measureAudio(fx("crafted-elst-repeat.m4a"))).toBeNull();
  });

  it("MP4: when the sample entry and the codec config disagree on the rate, the longer reading wins", () => {
    // mp4a says 22,050 Hz, the AudioSpecificConfig says 96,000 Hz: a decoder trusting the first plays about 1.07 s.
    expect(measureAudio(fx("crafted-rate-mismatch.m4a"))!.seconds).toBeGreaterThan(1);
  });

  it("MP4: timing tables that claim far more time than the frames are believed (longest reading wins)", () => {
    expect(measureAudio(fx("crafted-stts-inflated.m4a"))!.seconds).toBeGreaterThan(35);
  });

  it("MP4: unknown, index or trailing boxes are refused", () => {
    const b = fx("short.m4a");
    const box = (type: string, n = 8) => [0, 0, 0, n, ...new TextEncoder().encode(type), ...new Array(n - 8).fill(0)];
    expect(measureAudio(new Uint8Array([...b, ...box("uuid", 24)]))).toBeNull();
    expect(measureAudio(new Uint8Array([...b, ...box("mfra")]))).toBeNull();
    expect(measureAudio(new Uint8Array([...b, ...box("sidx", 12)]))).toBeNull();
    expect(measureAudio(new Uint8Array([...b, 1, 2, 3]))).toBeNull();
  });

  it("still reads every real recording", () => {
    for (const f of ["chromium-mediarecorder.webm", "webkit-mediarecorder.webm", "webkit-mediarecorder.mp4", "short.webm", "short-live.webm", "short.m4a", "short-frag.mp4"]) {
      expect(measureAudio(fx(f)), f).not.toBeNull();
    }
  });
});

describe("parsing is bounded (Codex round 2, 2026-10-02)", () => {
  // A plain AAC file plus one tiny moof whose trun claims 4,294,967,295 samples with no per-sample fields.
  const tinyBomb = () => {
    const box = (type: string, body: number[]) => { const n = body.length + 8; return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...new TextEncoder().encode(type), ...body]; };
    const tfhd = box("tfhd", [0, 0, 0, 0x08, 0, 0, 0, 1, 0, 0, 4, 0]); // default sample duration 1024
    const trun = box("trun", [0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
    return new Uint8Array([...fx("short.m4a"), ...box("moof", [...box("mfhd", [0, 0, 0, 0, 0, 0, 0, 1]), ...box("traf", [...tfhd, ...trun])])]);
  };

  it("a trun claiming billions of samples is refused at once", () => {
    const t0 = performance.now();
    expect(measureAudio(tinyBomb())).toBeNull();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("a sample table listing more frames than 35 s could hold is refused", () => {
    const b = fx("short.m4a");
    const i = [...b].findIndex((_, k) => b[k] === 0x73 && b[k + 1] === 0x74 && b[k + 2] === 0x73 && b[k + 3] === 0x7a); // "stsz"
    b.set([0, 0x01, 0, 0], i + 4 + 8); // sample_count = 65,536
    expect(measureAudio(b)).toBeNull();
  });

  it("a trun before its traf's tfhd is refused", () => {
    const box = (type: string, body: number[]) => { const n = body.length + 8; return [0, 0, n >> 8, n & 255, ...new TextEncoder().encode(type), ...body]; };
    const traf = box("traf", [...box("trun", [0, 0, 0, 0, 0, 0, 0, 1]), ...box("tfhd", [0, 0, 0, 0, 0, 0, 0, 1])]);
    expect(measureAudio(new Uint8Array([...fx("short.m4a"), ...box("moof", [...box("mfhd", [0, 0, 0, 0, 0, 0, 0, 1]), ...traf])]))).toBeNull();
  });
});
