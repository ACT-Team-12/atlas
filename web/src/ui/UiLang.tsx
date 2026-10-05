"use client";

import { createContext, useContext, type ReactNode } from "react";
import { englishBeside, ui, uiCount, uiLang, UI_LANG_CODE, type Lang, type UiKey, type UiPluralKey } from "@/lib/uiText";
import { paperLanguages } from "@/lib/missedLines";

/**
 * The language the app's own words are shown in (lib/uiText.ts). Each tool that has an "Explain it in" picker provides
 * it for its own section; anything outside a provider is English, so every existing screen and test keeps its words.
 * `paperLang` is the HTML lang of the paper itself (its quotes are never translated), "" when it can't be told.
 */
const UiLangContext = createContext<{ lang: Lang; paperLang: string }>({ lang: "English", paperLang: "" });

export function UiLangProvider({ language, paperLang = "", children }: { language: string; paperLang?: string; children: ReactNode }) {
  return <UiLangContext.Provider value={{ lang: uiLang(language), paperLang }}>{children}</UiLangContext.Provider>;
}

/** The HTML lang of a paper's own words: "en" or "es" when the paper is plainly one of them, "" (unknown) otherwise. */
export function paperLangCode(source: string): string {
  const langs = paperLanguages(source);
  return langs && langs.length === 1 ? langs[0] : "";
}

/**
 * The paper's own words, marked with the paper's language, not the app's: a quote is never translated, so a screen
 * reader must not read an English paper line with a Spanish voice (Codex review of PR 93).
 */
export function PaperWords({ children }: { children: ReactNode }) {
  const { paperLang } = useContext(UiLangContext);
  return <span lang={paperLang}>{children}</span>;
}

/**
 * The English of a safety line, shown beside its machine-drafted translation and marked as English (englishBeside in
 * lib/uiText.ts). Short labels get it in brackets on the same line; sentences get their own line. Full text color,
 * never faded: at 80% opacity it fell under 4.5:1 on the warning, pharmacist and teal backgrounds it sits on.
 */
export function EnglishBeside({ en }: { en: string }) {
  return en.length > 28
    ? <span lang="en" data-english-beside="" className="mt-0.5 block text-[0.85em] font-semibold">{en}</span>
    : <span lang="en" data-english-beside="" className="text-[0.85em] font-semibold"> ({en})</span>;
}

/**
 * A safety line from a table outside lib/uiText.ts (Ask my paper, the walk-through), with its English beside it when
 * `en` is given. `en` comes from that table's own typed helper (askEnglishBeside, walkEnglishBeside).
 */
export function withEnglish(text: ReactNode, en: string | null): ReactNode {
  return en === null ? text : <>{text}<EnglishBeside en={en} /></>;
}

/** A safety line in this language, with its English beside it until reviewed (for components that hold the language). */
export function safeLine(language: string, key: UiKey, vars?: Record<string, string | number>): ReactNode {
  const en = englishBeside(language, key, vars);
  return en === null ? ui(language, key, vars) : <>{ui(language, key, vars)}<EnglishBeside en={en} /></>;
}

/**
 * `t(key, vars)` and `tn(key, n, vars)` in the current language, plus its HTML lang code. `ts(key, vars)` is for safety
 * lines on screen: the translation, with the English beside it until that line is reviewed (Codex review of PR 93).
 */
export function useUi() {
  const { lang, paperLang } = useContext(UiLangContext);
  const t = (key: UiKey, vars?: Record<string, string | number>) => ui(lang, key, vars);
  return {
    lang,
    code: UI_LANG_CODE[lang],
    paperLang,
    t,
    tn: (key: UiPluralKey, n: number, vars?: Record<string, string | number>) => uiCount(lang, key, n, vars),
    ts: (key: UiKey, vars?: Record<string, string | number>): ReactNode => safeLine(lang, key, vars),
  };
}
