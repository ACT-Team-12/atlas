/**
 * Can this browser print from a button on the page (window.print)? On iPhone and iPad every browser is Apple's web
 * view, and only Safari prints from a page: Chrome, Firefox and Edge there ignore window.print (Akhil, Oct 4: Print
 * and Handoff did nothing in Chrome on his iPhone). In-app browsers (opening a link from Slack, Instagram, Facebook,
 * LinkedIn, X, WeChat, Line, Snapchat) and Android web views ignore it too. Those get the on-screen sheet instead.
 * An iPad asking for the desktop site says "Macintosh", so a touch screen with that name counts as iPad.
 */
const IN_APP = /FBAN|FBAV|Instagram|Slack|LinkedInApp|Twitter|MicroMessenger|Line\/|Snapchat|; wv\)/;
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|YaBrowser/;

export function canPrintFromPage(ua: string, maxTouchPoints = 0): boolean {
  if (IN_APP.test(ua)) return false;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (!ios) return true;
  // On iOS only Safari prints; an embedded web view without the Safari token is an app's own browser.
  return !IOS_OTHER_BROWSER.test(ua) && /Safari\//.test(ua);
}
