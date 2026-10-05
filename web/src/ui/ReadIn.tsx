"use client";

import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { SPEECH_LANG } from "@/lib/speechLang";

type Language = (typeof LANGUAGES)[number];
type Level = (typeof READING_LEVELS)[number];

/** Each language in its own words, so someone who reads it spots it at a glance. */
export const NATIVE_NAME: Record<Language, string> = {
  English: "English", Spanish: "Español", Vietnamese: "Tiếng Việt", Korean: "한국어", Chinese: "中文", Amharic: "አማርኛ", French: "Français",
};

/** What each level means, in the words the app can stand behind (lib/extract.ts passes the level to the model as is). */
const LEVEL_TEXT: Record<Level, { name: string; hint: string }> = {
  simple: { name: "Simple", hint: "short, everyday words" },
  standard: { name: "Standard", hint: "plain words, a bit more detail" },
  detailed: { name: "Detailed", hint: "more of the medical detail" },
};

const chip = "inline-flex min-h-[44px] cursor-pointer items-center rounded-full border-2 border-ink/70 bg-paper px-3.5 py-1.5 text-sm font-bold hover:bg-mint-soft has-[:checked]:border-ink has-[:checked]:bg-teal has-[:checked]:text-paper has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-deep";

/** The chosen chip shows a tick, not only a color, so the choice is visible in high-contrast mode too (Codex). */
function Tick() {
  return <span aria-hidden="true" data-tick="" className="mr-1.5 font-extrabold">✓</span>;
}

/**
 * "Explain it in" and "Reading level" as choices you can see, not two dropdowns. A NICU nurse who tried ATLAS (Oct 4)
 * asked for the information in other languages and for a choice of reading level: both existed, in dropdowns she may
 * not have noticed. Native radio buttons, so the keyboard and screen readers work as usual.
 */
export function ReadIn({ language, level, onLanguage, onLevel }: {
  language: Language; level: Level; onLanguage: (l: Language) => void; onLevel: (l: Level) => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-read-in="">
      <fieldset>
        <legend className="text-sm font-bold">Explain it in</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <label key={l} className={chip} data-language={l}>
              <input type="radio" name="read-in-language" value={l} checked={language === l} onChange={() => onLanguage(l)} className="sr-only" />
              {language === l && <Tick />}
              <span lang={SPEECH_LANG[l]}>{NATIVE_NAME[l]}</span>
              {NATIVE_NAME[l] !== l && <span className="sr-only"> ({l})</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-bold">Reading level</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {READING_LEVELS.map((l) => (
            <label key={l} className={chip} data-level={l}>
              <input type="radio" name="read-in-level" value={l} checked={level === l} onChange={() => onLevel(l)} className="sr-only" />
              {level === l && <Tick />}
              {LEVEL_TEXT[l].name}
            </label>
          ))}
        </div>
        {LEVEL_TEXT[level] && <p className="mt-1.5 text-xs font-semibold text-ink/70">{LEVEL_TEXT[level].name}: {LEVEL_TEXT[level].hint}.</p>}
      </fieldset>
    </div>
  );
}
