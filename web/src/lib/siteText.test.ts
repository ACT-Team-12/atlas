/**
 * Guards for the website's own words in every language (lib/siteText.ts). A translation may change the words around a
 * fact, never the fact: every number and every name stays exactly as the English has it.
 */
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./schema";
import { site, SITE_REVIEWED, SITE_TEXT, type SiteKey } from "./siteText";
import type { Lang } from "./uiText";

const KEYS = Object.keys(SITE_TEXT) as SiteKey[];
const LANGS = LANGUAGES as readonly Lang[];
const NAMES = ["ATLAS", "MARTA", "HRSA", "Medicaid", "AI"];
const digits = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((d) => d.replace(/[.,]$/, "")).sort();
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("siteText", () => {
  it("has every line in every app language, none empty", () => {
    for (const k of KEYS) for (const l of LANGS) expect(SITE_TEXT[k][l]?.trim(), `${k} ${l}`).toBeTruthy();
  });

  it("keeps every number exactly as the English has it", () => {
    for (const k of KEYS) {
      const en = digits(SITE_TEXT[k].English);
      for (const l of LANGS) expect(digits(SITE_TEXT[k][l]), `${k} ${l}`).toEqual(en);
    }
  });

  it("keeps names (ATLAS, MARTA, HRSA, Medicaid) and fills the same {placeholders}", () => {
    for (const k of KEYS) {
      const en = SITE_TEXT[k].English;
      for (const l of LANGS) {
        const t = SITE_TEXT[k][l];
        for (const n of NAMES) if (new RegExp(`\\b${n}\\b`).test(en) && n !== "AI") expect(t, `${k} ${l} ${n}`).toContain(n);
        expect(placeholders(t), `${k} ${l}`).toEqual(placeholders(en));
      }
    }
  });

  it("uses no em or en dashes in any language", () => {
    for (const k of KEYS) for (const l of LANGS) expect(SITE_TEXT[k][l], `${k} ${l}`).not.toMatch(/[–—]/);
  });

  it("fills {name} and falls back to English", () => {
    expect(site("Spanish", "how.step", { n: 3 })).toBe("Paso 3");
    expect(site("English", "trust.sources", { date: "2026-10-01" })).toBe("Data sources (retrieved 2026-10-01)");
  });

  it("claims no native review for any machine-drafted language", () => {
    for (const l of LANGS) if (l !== "English") expect(SITE_REVIEWED[l]).toBe(false);
  });
});
