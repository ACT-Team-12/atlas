/**
 * Light and dark themes. The choice is System (follow the phone), Light or Dark, saved in localStorage. <html> always
 * carries the resolved theme in data-theme ("light" | "dark") and the choice in data-theme-pref, so CSS only ever
 * asks one question. Colors live in app/globals.css.
 */
export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "atlas-theme";
export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];

/**
 * Runs inline in <head>, before the first paint, so the page never flashes the wrong theme. It also follows the phone
 * when its setting changes while the page is open (System only). Plain ES5: it runs before any bundle. Storage can
 * throw (private mode, blocked site data); then the choice is simply System.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,k=${JSON.stringify(THEME_KEY)};function pref(){try{var s=localStorage.getItem(k);if(s==="light"||s==="dark")return s}catch(e){}return "system"}var m=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;function apply(){var p=pref();d.setAttribute("data-theme-pref",p);d.setAttribute("data-theme",p==="system"?(m&&m.matches?"dark":"light"):p)}apply();window.__atlasTheme=apply;if(m){var f=function(){if(d.getAttribute("data-theme-pref")==="system")apply()};m.addEventListener?m.addEventListener("change",f):m.addListener&&m.addListener(f)}})()`;

declare global {
  interface Window { __atlasTheme?: () => void }
}

/** The saved choice, as the inline script left it on <html>. */
export function readThemePref(): ThemePref {
  const p = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-theme-pref");
  return p === "light" || p === "dark" ? p : "system";
}

/** Save a choice and apply it now. Storage failures are fine: the theme still changes for this page. */
export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode or blocked storage: apply for this page only */
  }
  const d = document.documentElement;
  if (window.__atlasTheme && storedMatches(pref)) {
    window.__atlasTheme();
    return;
  }
  const dark = pref === "dark" || (pref === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  d.setAttribute("data-theme-pref", pref);
  d.setAttribute("data-theme", dark ? "dark" : "light");
}

/** True when localStorage now holds this choice, so the inline script's apply() would read it back correctly. */
function storedMatches(pref: ThemePref): boolean {
  try {
    const s = localStorage.getItem(THEME_KEY);
    return pref === "system" ? s === null : s === pref;
  } catch {
    return false;
  }
}
