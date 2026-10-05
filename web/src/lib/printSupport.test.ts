import { describe, expect, it } from "vitest";
import { canPrintFromPage } from "./printSupport";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0 Mobile/15E148 Safari/605.1.15",
  iphoneSlack: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Slack/25.09.10",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.0",
  ipadDesktopSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidWebView: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36",
  desktopChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

describe("canPrintFromPage", () => {
  it("prints where window.print works: Safari on iPhone and iPad, Chrome on Android and desktop, desktop Safari", () => {
    expect(canPrintFromPage(UA.iphoneSafari, 5)).toBe(true);
    expect(canPrintFromPage(UA.ipadDesktopSafari, 5)).toBe(true);
    expect(canPrintFromPage(UA.ipadDesktopSafari, 0)).toBe(true); // a Mac
    expect(canPrintFromPage(UA.androidChrome, 5)).toBe(true);
    expect(canPrintFromPage(UA.desktopChrome, 0)).toBe(true);
  });

  it("shows the sheet instead where it does nothing: other iPhone browsers (Akhil's Chrome), in-app browsers, Android web views", () => {
    expect(canPrintFromPage(UA.iphoneChrome, 5)).toBe(false);
    expect(canPrintFromPage(UA.iphoneFirefox, 5)).toBe(false);
    expect(canPrintFromPage(UA.iphoneEdge, 5)).toBe(false);
    expect(canPrintFromPage(UA.iphoneSlack, 5)).toBe(false);
    expect(canPrintFromPage(UA.iphoneInstagram, 5)).toBe(false);
    expect(canPrintFromPage(UA.androidWebView, 5)).toBe(false);
  });
});
