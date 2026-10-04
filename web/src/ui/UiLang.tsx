"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ui, uiCount, uiLang, UI_LANG_CODE, type Lang, type UiKey, type UiPluralKey } from "@/lib/uiText";

/**
 * The language the app's own words are shown in (lib/uiText.ts). Each tool that has an "Explain it in" picker provides
 * it for its own section; anything outside a provider is English, so every existing screen and test keeps its words.
 */
const UiLangContext = createContext<Lang>("English");

export function UiLangProvider({ language, children }: { language: string; children: ReactNode }) {
  return <UiLangContext.Provider value={uiLang(language)}>{children}</UiLangContext.Provider>;
}

/** `t(key, vars)` and `tn(key, n, vars)` in the current language, plus its HTML lang code. */
export function useUi() {
  const lang = useContext(UiLangContext);
  return {
    lang,
    code: UI_LANG_CODE[lang],
    t: (key: UiKey, vars?: Record<string, string | number>) => ui(lang, key, vars),
    tn: (key: UiPluralKey, n: number, vars?: Record<string, string | number>) => uiCount(lang, key, n, vars),
  };
}
