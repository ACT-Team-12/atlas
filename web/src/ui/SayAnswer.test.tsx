// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SayAnswer } from "./SayAnswer";

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
