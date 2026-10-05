import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_SAFETY_KEYS } from "@/lib/uiText";

/**
 * The per-language page test only knows the English lines in lib/uiText.ts, so English written straight into a
 * component's JSX is invisible to it (Codex review of PR 93, round 3). This reads the components shown inside a language
 * section and fails on any JSX text or visible attribute (aria-label, title, placeholder, alt) with two or more English
 * words. Text that is English on purpose lives in files marked lang="en" as a whole (listed below), or in lib/uiText.ts.
 */
const IN_A_LANGUAGE_SECTION = [
  "CarePlanTool", "CareSteps", "PlanStart", "MissedLines", "MedicineChanges", "HandoffSheet", "AskPaper", "BookIt",
  "ShowOnPaper", "PaperFirst", "Understand", "LabResults", "PrepMode", "ReadIn", "ReadyCue", "ShareFamily",
];
// English by design, marked lang="en" with a translated line saying so: the phone call panel (consent not yet reviewed)
// and the helper's case-note summary.
const ENGLISH_ON_PURPOSE = ["CallMe", "SessionSummary"];

function rawEnglish(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const hits: string[] = [];
  // JSX text, also when it starts on its own line after the tag or before an expression.
  for (const m of code.matchAll(/(?<![=-])>([^<>{}=;()]*[A-Za-z]{2,}[ \t]+[A-Za-z]{2,}[^<>{}=;()]*)[<{]/g)) hits.push(m[1].trim().replace(/\s+/g, " "));
  for (const m of code.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]*[A-Za-z]{2,}\s+[A-Za-z]{2,}[^"]*)"/g)) hits.push(m[1]);
  return hits.filter((h) => !/^[\s\p{P}\p{S}\d]*$/u.test(h));
}

describe("no English typed straight into a component shown in another language", () => {
  for (const name of IN_A_LANGUAGE_SECTION) {
    it(name, () => {
      const src = readFileSync(join(__dirname, `${name}.tsx`), "utf8");
      expect(rawEnglish(src)).toEqual([]);
    });
  }

  it("the check really sees raw English", () => {
    expect(rawEnglish(`<p className="x">Call your clinic today</p>`)).toEqual(["Call your clinic today"]);
    expect(rawEnglish(`<div aria-label="Your paper here">{t("k")}</div>`)).toEqual(["Your paper here"]);
    expect(rawEnglish(`<p>{t("k")}</p>`)).toEqual([]);
    expect(rawEnglish(`<img src={u} alt="Your photo, boxed" />`)).toEqual(["Your photo, boxed"]);
    expect(rawEnglish("const chip = (on: boolean) => `rounded-full border-2 ${on ? \"a\" : \"b\"}`;")).toEqual([]); // an arrow, not a tag
    expect(rawEnglish(`<p className="x">\n          Source: health center data{c.a ? " (b)" : ""}\n</p>`)).toEqual(["Source: health center data"]);
  });

  it("no safety line is shown through plain t(), which drops its English (Codex review, round 4)", () => {
    const bare: string[] = [];
    for (const name of IN_A_LANGUAGE_SECTION) {
      const src = readFileSync(join(__dirname, `${name}.tsx`), "utf8");
      for (const m of src.matchAll(/(?<![\w.])t\("([\w.]+)"/g)) if (UI_SAFETY_KEYS.has(m[1] as never)) bare.push(`${name}: ${m[1]}`);
      // A key picked at run time (keyFor) whose prefix holds a safety line, e.g. when.today, seal.recheck, kind.warning_sign.
      for (const m of src.matchAll(/(?<![\w.])t\((keyFor\([^\n;]*)/g)) {
        for (const p of m[1].matchAll(/keyFor\("([\w.]+)"/g)) if ([...UI_SAFETY_KEYS].some((k) => k.startsWith(`${p[1]}.`))) bare.push(`${name}: keyFor("${p[1]}")`);
      }
    }
    expect(bare).toEqual([]);
  });

  it("the files kept in English say so", () => {
    for (const name of ENGLISH_ON_PURPOSE) expect(readFileSync(join(__dirname, `${name}.tsx`), "utf8"), name).toMatch(/lang="en"/);
  });
});
