// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { coveredTopNow, landingTop, readableRect } from "./ReadyCue";

const heading = (top: number, height = 40) => ({ top, bottom: top + height, height });

describe("readableRect: the cue hides only when the result's heading is plainly on screen", () => {
  it("portrait phone (390x844): a heading in the middle counts; under the sticky header or the bottom bar does not", () => {
    expect(readableRect(heading(300), 844)).toBe(true);
    expect(readableRect(heading(60), 844)).toBe(false); // under the sticky tab bar
    expect(readableRect(heading(800), 844)).toBe(false); // only its top edge has come into view
  });
  it("landscape phone (844x390): the band follows the height, so it does not collapse (Codex review, round 2)", () => {
    expect(readableRect(heading(150), 390)).toBe(true);
    expect(readableRect(heading(20), 390)).toBe(false);
  });
  it("ultrawide desktop (3440x1440): still decided by height", () => {
    expect(readableRect(heading(600, 60), 1440)).toBe(true);
    expect(readableRect(heading(1400, 60), 1440)).toBe(false);
  });
  it("a hidden heading (zero height) never counts", () => {
    expect(readableRect({ top: 300, bottom: 300, height: 0 }, 844)).toBe(false);
  });
  it("short landscape phone (667x375) with the stuck tab bar covering 64-120px: under it does not count (round 3)", () => {
    expect(readableRect(heading(80), 375, 120)).toBe(false); // passed the 15% line (56px) but sits under the bar
    expect(readableRect(heading(130), 375, 120)).toBe(true);
  });
});

describe("coveredTopNow: measures what is stuck to the top", () => {
  afterEach(() => { document.body.replaceChildren(); });
  const box = (top: number, bottom: number, mark: boolean) => {
    const el = document.createElement("div");
    if (mark) el.setAttribute("data-covers-top", "");
    el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
    document.body.appendChild(el);
  };
  it("takes the lowest bottom edge of the marked elements, ignoring unmarked ones and ones low on the screen", () => {
    box(12, 60, true); // the header
    box(64, 120, true); // the stuck tab bar
    box(0, 300, false); // something else
    box(600, 650, true); // a marked element far down the page is not covering the top
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    expect(coveredTopNow()).toBe(120);
  });
});

describe("landingTop: where Show me puts a heading", () => {
  afterEach(() => { document.body.replaceChildren(); });
  it("clears the phone tab bar's sticky footprint even before it is stuck (Codex review, round 6)", () => {
    const bar = document.createElement("div");
    bar.setAttribute("data-sticky-bar", "");
    bar.style.top = "64px";
    Object.defineProperty(bar, "offsetHeight", { configurable: true, value: 90 }); // tabs plus a note line
    const heading = document.createElement("h3");
    heading.style.scrollMarginTop = "112px";
    document.body.append(bar, heading);
    expect(landingTop(heading)).toBe(162); // 64 + 90 + 8, past the fixed 112px margin
  });
  it("desktop (no bar shown): the heading's own margin", () => {
    const heading = document.createElement("h3");
    heading.style.scrollMarginTop = "112px";
    document.body.append(heading);
    expect(landingTop(heading)).toBe(112);
  });
});
