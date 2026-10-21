"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LANGUAGES } from "@/lib/schema";
import { LANGUAGE_NAME, uiLang, UI_LANG_CODE, type Lang } from "@/lib/uiText";
import { site, type SiteKey } from "@/lib/siteText";

/**
 * The website's language (lib/siteText.ts), chosen once in the nav. It also drives each tool's "Explain it in" picker
 * (CarePlanTool, LabResults, PrepMode follow `picked`), so a person who does not read much English switches the whole
 * page in one place. A tool's own picker still works on its own for that tool.
 *
 * Remembered in this browser (localStorage) and settable by link (?lang=Spanish). It sets <html lang> so a screen
 * reader uses the right voice. Outside a provider everything is English, so tests and other pages keep their words.
 */
export const SITE_LANG_KEY = "atlas-site-lang";

/** "person": picked in the nav just now. "load": restored from a link or an earlier visit when the page opened. */
export type PickSource = "person" | "load";
type Ctx = {
  lang: Lang;
  /** Bumps on each pick; tools follow picks, never the first render. */
  picked: number;
  source: PickSource;
  setLang: (l: Lang) => void;
};
const SiteLangContext = createContext<Ctx>({ lang: "English", picked: 0, source: "load", setLang: () => {} });

/** The language a link or a past visit asked for, or null. */
export function storedSiteLang(search: string, read: () => string | null): Lang | null {
  const fromLink = new URLSearchParams(search).get("lang");
  if (fromLink) {
    const byName = LANGUAGES.find((l) => l.toLowerCase() === fromLink.toLowerCase());
    const byCode = LANGUAGES.find((l) => UI_LANG_CODE[l].toLowerCase() === fromLink.toLowerCase());
    if (byName ?? byCode) return (byName ?? byCode) as Lang;
  }
  let saved: string | null = null;
  try { saved = read(); } catch {}
  return saved && (LANGUAGES as readonly string[]).includes(saved) ? uiLang(saved) : null;
}

export function SiteLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("English");
  const [picked, setPicked] = useState(0);
  const [source, setSource] = useState<PickSource>("load");
  const loaded = useRef(false);

  // One-time load after hydration (localStorage and the URL do not exist during the server render). A language that
  // came from a link or an earlier visit counts as a pick, so the tools open in it too. (Same hydration pattern as
  // CarePlanTool's saved-plans load.)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const found = storedSiteLang(window.location.search, () => localStorage.getItem(SITE_LANG_KEY));
    if (found && found !== "English") { setLangState(found); setPicked((n) => n + 1); }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => { document.documentElement.lang = UI_LANG_CODE[lang]; }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setSource("person");
    setPicked((n) => n + 1);
    try { localStorage.setItem(SITE_LANG_KEY, l); } catch {}
  }, []);

  const value = useMemo(() => ({ lang, picked, source, setLang }), [lang, picked, source, setLang]);
  return <SiteLangContext.Provider value={value}>{children}</SiteLangContext.Provider>;
}

/** `s(key, vars)`: one of the site's own lines in the current site language. */
export function useSite() {
  const { lang, picked, setLang } = useContext(SiteLangContext);
  const s = useCallback((key: SiteKey, vars?: Record<string, string | number>) => site(lang, key, vars), [lang]);
  return { lang, code: UI_LANG_CODE[lang], picked, setLang, s };
}

/**
 * Runs `apply(lang, source)` on each language pick (never on the first render). A tool moves its "Explain it in" picker
 * along with the site; on a "load" pick it should skip that when it already holds restored work, so a saved plan keeps
 * the language it was read in.
 */
export function useFollowSiteLang(apply: (lang: Lang, source: PickSource) => void) {
  const { lang, picked, source } = useContext(SiteLangContext);
  const seen = useRef(picked);
  const latest = useRef(apply);
  useEffect(() => { latest.current = apply; });
  useEffect(() => {
    if (picked === seen.current) return;
    seen.current = picked;
    latest.current(lang, source);
  }, [picked, lang, source]);
}

/** The nav's language picker: each language in its own name, with a short note on what it changes. */
export function SiteLangPicker({ className = "" }: { className?: string }) {
  const { lang, setLang, s } = useSite();
  return (
    // On a phone the bar has no room for a language name next to the theme switch and "Try it" (measured at 390 px:
    // "Try it" was pushed off the edge), so it shows the globe and a short code, with the real select laid over it.
    <label className={`relative flex items-center gap-1.5 rounded-full bg-paper/90 backdrop-blur border-2 border-ink px-2.5 sm:px-3 py-1.5 shadow-[0_2px_0_var(--ink)] focus-within:ring-2 focus-within:ring-teal ${className}`}
      title={s("nav.languageHint")}>
      <span aria-hidden="true" className="text-base leading-none">🌐</span>
      <span aria-hidden="true" className="sm:hidden font-bold text-sm uppercase">{UI_LANG_CODE[lang].slice(0, 2)}</span>
      <span className="sr-only">{s("nav.language")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} data-site-lang=""
        aria-describedby="site-lang-hint"
        className="absolute inset-0 opacity-0 sm:static sm:opacity-100 bg-transparent font-bold text-sm outline-none cursor-pointer sm:max-w-[7.5em]">
        {LANGUAGES.map((l) => <option key={l} value={l} lang={UI_LANG_CODE[l]}>{LANGUAGE_NAME[l]}</option>)}
      </select>
      <span id="site-lang-hint" className="sr-only">{s("nav.languageHint")}</span>
    </label>
  );
}

/** One site line as an element, for server components (Trust) that cannot call the hook. */
export function SiteText({ k, vars }: { k: SiteKey; vars?: Record<string, string | number> }) {
  const { s } = useSite();
  return <>{s(k, vars)}</>;
}
