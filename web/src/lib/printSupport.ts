/**
 * Can this browser print from a button on the page (window.print)? On iPhone and iPad every browser is Apple's web
 * view, and only Safari prints from a page: Chrome, Firefox and Edge there ignore window.print (Akhil, Oct 4: Print
 * and Handoff did nothing in Chrome on his iPhone). In-app browsers (opening a link from Slack, Instagram, Facebook,
 * LinkedIn, X, WeChat, Line, Snapchat, the Google app) and Android web views ignore it too.
 * An iPad asking for the desktop site says "Macintosh", so a touch screen with that name counts as iPad.
 * The check can't see everything (an app that embeds Safari looks like Safari), so the sheet is always shown first and
 * printing is offered from it, never assumed (ui/printView.ts).
 */
const IN_APP = /FBAN|FBAV|Instagram|Slack|LinkedInApp|Twitter|MicroMessenger|Line\/|Snapchat|GSA\/|; wv\)/;
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser/;

const isIOS = (ua: string, maxTouchPoints: number) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

export function canPrintFromPage(ua: string, maxTouchPoints = 0): boolean {
  if (IN_APP.test(ua)) return false;
  if (!isIOS(ua, maxTouchPoints)) return true;
  // On iOS only Safari prints; a web view without the Safari token is an app's own browser.
  return !IOS_OTHER_BROWSER.test(ua) && /Safari\//.test(ua);
}

/**
 * How to get the sheet onto paper (or into a PDF) here, in plain words for the bar over the sheet.
 * - "print": the Print button works; on iOS, say where Print is if nothing happens (an app that embeds Safari).
 * - "ios-menu": another browser on iPhone/iPad: its own Share or ⋯ menu has Print.
 * - "open-browser": an app's own browser: open the page in the phone's browser, then print.
 */
export type PrintHelp = { how: "print" | "ios-menu" | "open-browser"; text: string };

export function printHelp(ua: string, maxTouchPoints = 0): PrintHelp {
  const ios = isIOS(ua, maxTouchPoints);
  if (IN_APP.test(ua) || (ios && !/Safari\//.test(ua))) {
    return {
      how: "open-browser",
      text: ios
        ? "This app's browser can't print. Open this page in Safari (tap the menu, then Open in Safari), then print it."
        : "This app's browser can't print. Open this page in Chrome or your phone's browser (tap the ⋮ menu, then Open in browser), then print it.",
    };
  }
  if (ios && IOS_OTHER_BROWSER.test(ua)) {
    return { how: "ios-menu", text: "This browser can't print from a button. Tap Share (the square with an arrow) or the ⋯ menu, then Print. You can save it as a PDF there too." };
  }
  return {
    how: "print",
    text: ios
      ? "Tap Print to print it or save it as a PDF. If nothing happens, tap Share (the square with an arrow), then Print."
      : "Print it, or choose Save as PDF in the print window.",
  };
}
