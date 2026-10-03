// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordedTooLong, SayAnswer } from "./SayAnswer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A fake microphone stream whose tracks remember whether they were stopped. */
function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

type Rec = { state: string; start: () => void; stop: () => void; onstop: (() => void) | null; ondataavailable: ((e: { data: Blob }) => void) | null };
let recorders: Rec[] = [];
let ctorThrows = false, startThrows = false;
class FakeRecorder implements Rec {
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  state = "inactive";
  onstop: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor() {
    if (ctorThrows) throw new DOMException("bad", "NotSupportedError");
    recorders.push(this);
  }
  start() { if (startThrows) throw new DOMException("bad", "InvalidStateError"); this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["x"]) }); this.onstop?.(); }
}

let root: Root, host: HTMLDivElement;
let getUserMedia: ReturnType<typeof vi.fn>;

function render(enabled = true) {
  act(() => { root.render(<SayAnswer enabled={enabled} language="English" token="t" onTranscript={() => {}} />); });
}
const button = () => host.querySelector("button") as HTMLButtonElement;
const status = () => host.querySelector("[aria-live]")?.textContent ?? "";

beforeEach(() => {
  recorders = []; ctorThrows = false; startThrows = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transcript: "two tablets" }), { status: 200 })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Say your answer: the microphone is always released (Codex review, 2026-10-02)", () => {
  it("renders nothing when off", () => {
    render(false);
    expect(host.innerHTML).toBe("");
  });

  it("a second tap while the permission prompt is open does not open a second microphone", async () => {
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render();
    await act(async () => { button().click(); button().click(); button().click(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const { stream } = fakeStream();
    await act(async () => { resolve(stream); });
    expect(recorders).toHaveLength(1);
  });

  it("stops the microphone if the recorder cannot be created", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    ctorThrows = true;
    render();
    await act(async () => { button().click(); });
    expect(track.stop).toHaveBeenCalled();
    expect(status()).toMatch(/couldn't start recording/i);
    // and it can try again afterwards
    ctorThrows = false;
    const second = fakeStream();
    getUserMedia.mockResolvedValue(second.stream);
    await act(async () => { button().click(); });
    expect(recorders).toHaveLength(1);
  });

  it("stops the microphone if the recorder cannot start", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    startThrows = true;
    render();
    await act(async () => { button().click(); });
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops a microphone that arrives after the component is gone", async () => {
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render();
    await act(async () => { button().click(); });
    act(() => root.unmount());
    root = createRoot(host); // so afterEach can unmount something
    const { stream, track } = fakeStream();
    await act(async () => { resolve(stream); });
    expect(track.stop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
  });

  it("stops the microphone when recording is stopped, and when unmounted mid-recording", async () => {
    const a = fakeStream();
    getUserMedia.mockResolvedValue(a.stream);
    render();
    await act(async () => { button().click(); });
    expect(status()).toMatch(/Listening/);
    await act(async () => { button().click(); }); // Stop
    expect(a.track.stop).toHaveBeenCalled();

    const b = fakeStream();
    getUserMedia.mockResolvedValue(b.stream);
    await act(async () => { button().click(); });
    expect(recorders.at(-1)?.state).toBe("recording");
    act(() => root.unmount());
    root = createRoot(host);
    expect(b.track.stop).toHaveBeenCalled();
  });

  it("a blocked microphone shows a plain message", async () => {
    getUserMedia.mockRejectedValue(new DOMException("no", "NotAllowedError"));
    render();
    await act(async () => { button().click(); });
    expect(status()).toMatch(/microphone is blocked/);
  });
});

describe("Say your answer never sends more than 20 seconds (review finding, 2026-10-03)", () => {
  let clock = 0;
  beforeEach(() => { clock = 0; vi.spyOn(performance, "now").mockImplementation(() => clock); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("the timing rule: up to 20 s is sent, anything longer is not", () => {
    expect(recordedTooLong(1_000, 21_000)).toBe(false);
    expect(recordedTooLong(1_000, 21_001)).toBe(true);
    expect(recordedTooLong(0, 95_000)).toBe(true);
  });

  it("a recording that ran past 20 s (a throttled background timer) is refused with a plain message, not sent", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    render();
    await act(async () => { button().click(); });
    clock = 25_000; // the tab was in the background and the timer never fired
    await act(async () => { button().click(); }); // Stop
    expect(fetch).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(status()).toMatch(/longer than 20 seconds/);
    expect(button().textContent).toMatch(/Say your answer/);
  });

  it("a recording stopped inside 20 s is still sent", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    render();
    await act(async () => { button().click(); });
    clock = 19_900;
    await act(async () => { button().click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops when the page is hidden", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    render();
    await act(async () => { button().click(); });
    expect(recorders.at(-1)?.state).toBe("recording");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    }
    expect(recorders.at(-1)?.state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops when the page is left (pagehide)", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    render();
    await act(async () => { button().click(); });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(recorders.at(-1)?.state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
  });
});
