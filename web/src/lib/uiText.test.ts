import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./schema";
import { englishBeside, labReason, pluralCategory, ui, uiCount, UI_PLURAL, UI_REGISTER, UI_REVIEWED, UI_SAFETY_KEYS, UI_SAFETY_REVIEWED, UI_TEXT, type Lang, type UiKey } from "./uiText";

const OTHERS = LANGUAGES.filter((l) => l !== "English");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/**
 * Entries that are the same word in English and that language, and are correct there (not an English leftover).
 * Each one was checked by hand; anything new that matches English fails until it is added here with a reason.
 */
const SAME_AS_ENGLISH: Partial<Record<Lang, string[]>> = {
  Spanish: ["common.no", "tab.3", "fb.use.no"], // "No", "Plan"
  French: ["paper.level.simple", "paper.level.standard", "readin.level.simple", "readin.level.standard", "tab.3", "dock.stop.short"], // "simple", "standard", "Simple", "Standard", "Plan", "Stop"
};

/** English words that never belong in another language's entry. Proper names are removed before the check. */
const ENGLISH_WORDS = /\b(the|your|you|and|with|paper|steps?|checked|clinic|plan|tap|read|call|open|print|send|copy|ask|what|this|not|from|here|after|before)\b/i;
const PROPER = /ATLAS|Pip|HRSA|Google Calendar|Google|Apple|Outlook|United Way of Greater Atlanta|ZIP|\.ics|atlas-team12\.vercel\.app|\[unreadable\]|\bL\b|\bAI\b|\{\w+\}/g;
// "plan" is also French and Spanish for plan; checked against the word list everywhere else.
const WORDS_FOR: Partial<Record<Lang, RegExp>> = {
  French: /\b(the|your|you|and|with|paper|steps?|checked|clinic|tap|read|call|open|print|send|copy|ask|what|this|not|from|here|after|before)\b/i,
  Spanish: /\b(the|your|you|and|with|paper|steps?|checked|clinic|tap|read|call|open|print|send|copy|ask|what|this|not|from|here|after|before)\b/i,
};

describe("the app's own words (uiText)", () => {
  const keys = Object.keys(UI_TEXT) as (keyof typeof UI_TEXT)[];

  it("has a real table: hundreds of lines on the core path", () => {
    expect(keys.length).toBeGreaterThan(300);
  });

  it("every line exists in all 7 languages, non-empty, with the same {placeholders} as English", () => {
    for (const k of keys) {
      const row = UI_TEXT[k] as Record<Lang, string>;
      for (const l of LANGUAGES) {
        expect(row[l], `${k} ${l}`).toBeTypeOf("string");
        expect(row[l].trim().length, `${k} ${l}`).toBeGreaterThan(0);
        expect(placeholders(row[l]), `${k} ${l}`).toEqual(placeholders(row.English));
      }
    }
  });

  it("no English left in a non-English line (proper names aside)", () => {
    const bad: string[] = [];
    for (const k of keys) {
      const row = UI_TEXT[k] as Record<Lang, string>;
      for (const l of OTHERS) {
        const v = row[l];
        if (v === row.English && !(SAME_AS_ENGLISH[l] ?? []).includes(k)) bad.push(`${k} ${l}: same as English`);
        if ((WORDS_FOR[l] ?? ENGLISH_WORDS).test(v.replace(PROPER, " "))) bad.push(`${k} ${l}: "${v}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no em dash or en dash anywhere (the team's writing rule)", () => {
    for (const k of keys) for (const l of LANGUAGES) expect((UI_TEXT[k] as Record<Lang, string>)[l], `${k} ${l}`).not.toMatch(/[\u2013\u2014]/);
    for (const [k, byLang] of Object.entries(UI_PLURAL)) {
      for (const [l, forms] of Object.entries(byLang)) for (const f of Object.values(forms)) expect(f, `${k} ${l}`).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("safety words keep their meaning: paper's exact words, not verified, warning signs", () => {
    // Spot checks on the wording a native reviewer should confirm first; these pin the meaning against later edits.
    expect(ui("Spanish", "pf.screen.paper")).toMatch(/palabra por palabra/);
    expect(ui("French", "pf.screen.paper")).toMatch(/mot pour mot/);
    expect(ui("Vietnamese", "pf.screen.paper")).toMatch(/nguyên văn/);
    expect(ui("Korean", "pf.screen.paper")).toMatch(/글자 그대로/);
    expect(ui("Chinese", "pf.screen.paper")).toMatch(/逐字/);
    expect(ui("Amharic", "pf.screen.paper")).toMatch(/ቃል በቃል/);
    expect(ui("Spanish", "pf.note.unchecked")).toMatch(/no verificado/);
    expect(ui("French", "pf.note.unchecked")).toMatch(/pas encore revérifié/);
    expect(ui("Vietnamese", "pf.note.unchecked")).toMatch(/chưa được kiểm tra/);
    expect(ui("Korean", "pf.note.unchecked")).toMatch(/확인되지 않음/);
    expect(ui("Chinese", "pf.note.unchecked")).toMatch(/尚未再次核对/);
    expect(ui("Amharic", "pf.note.unchecked")).toMatch(/አልተረጋገጠም/);
    // Every warning line keeps "911" and its clinic in every language.
    for (const l of LANGUAGES) {
      expect(ui(l, "steps.warnBody"), l).toContain("911");
      expect(ui(l, "sheet.foot"), l).toContain("911");
    }
  });

  it("every language says how it was reviewed and which register it uses, and none claims native review", () => {
    for (const l of LANGUAGES) {
      expect(UI_REGISTER[l].length).toBeGreaterThan(5);
      if (l === "English") continue;
      expect(String(UI_REVIEWED[l])).not.toMatch(/native/i);
    }
    expect(UI_REVIEWED.Vietnamese).toMatch(/partial/);
  });

  it("unknown languages fall back to English", () => {
    expect(ui("Klingon", "steps.title")).toBe("Your steps");
  });
});

describe("numbers and plurals", () => {
  it("each language gets the plural category its grammar uses (CLDR)", () => {
    expect(pluralCategory("English", 1)).toBe("one");
    expect(pluralCategory("French", 0)).toBe("one"); // "0 étape"
    expect(pluralCategory("Amharic", 0)).toBe("one");
    expect(pluralCategory("Korean", 1)).toBe("other");
    expect(pluralCategory("Chinese", 1)).toBe("other");
    expect(pluralCategory("Vietnamese", 1)).toBe("other");
  });

  it("singular and plural read right where the language has them, and one form where it does not", () => {
    expect(uiCount("English", "steps", 1)).toBe("1 step");
    expect(uiCount("English", "steps", 3)).toBe("3 steps");
    expect(uiCount("Spanish", "steps", 1)).toBe("1 paso");
    expect(uiCount("Spanish", "steps", 2)).toBe("2 pasos");
    expect(uiCount("French", "steps", 0)).toBe("0 étape");
    expect(uiCount("French", "steps", 2)).toBe("2 étapes");
    expect(uiCount("Amharic", "steps", 1)).toBe("1 እርምጃ");
    expect(uiCount("Amharic", "steps", 4)).toBe("4 እርምጃዎች");
    expect(uiCount("Korean", "steps", 1)).toBe("1단계");
    expect(uiCount("Vietnamese", "steps", 5)).toBe("5 bước");
    expect(uiCount("Chinese", "steps", 5)).toBe("5 个步骤");
  });

  it("every plural line has its number in every form, and a singular where the language has one", () => {
    // Lines whose words do not change with the number in that language (checked by hand): "{n} checked twice.",
    // "Held back {n}:", "({n})" counters, and helpsWith (only used with 2 or more problems).
    const NO_SINGULAR: Record<string, Lang[]> = {
      checkedTwice: ["English", "Amharic"], heldBack: ["English", "Amharic"], heldTitle: ["English", "Spanish", "Amharic", "French"],
      heldItem: ["English", "Spanish", "Amharic", "French"], removedCount: ["English", "Spanish", "Amharic"],
      helpsWith: ["English", "Spanish", "Amharic", "French"], labsInside: ["English", "Spanish", "Amharic", "French"],
      labsCouldntTell: ["English", "Spanish", "Amharic", "French"],
    };
    for (const [k, byLang] of Object.entries(UI_PLURAL)) {
      for (const l of LANGUAGES) {
        const forms = (byLang as Record<Lang, Record<string, string>>)[l];
        expect(forms.other, `${k} ${l}`).toBeTruthy();
        for (const f of Object.values(forms)) expect(f, `${k} ${l}`).toContain("{n}");
        const hasOne = [0, 1].some((n) => pluralCategory(l, n) === "one");
        if (hasOne && !(NO_SINGULAR[k] ?? []).includes(l)) expect(forms.one, `${k} ${l} needs a singular`).toBeTruthy();
        if (!hasOne) expect(Object.keys(forms), `${k} ${l} has one form`).toEqual(["other"]);
      }
    }
  });
});

describe("lab reasons (our code's words, lib/results.ts) in the person's language", () => {
  it("keeps the report's value and range exactly", () => {
    expect(labReason("Spanish", "5.9 is above the range printed on your report (4.0-5.6).")).toBe("5.9 está por encima del rango impreso en su informe (4.0-5.6).");
    expect(labReason("Korean", "38 is below the range printed on your report (>40).")).toContain("(>40)");
    expect(labReason("French", "Inside the range printed on your report (70-99).")).toBe("Dans l'intervalle imprimé sur votre rapport (70-99).");
    expect(labReason("Vietnamese", "Your report prints this as <5, so we can't tell where it falls against the range (0-10).")).toContain("<5");
  });

  it("translates every fixed reason, and leaves one it does not know in English rather than guessing", () => {
    for (const k of Object.keys(UI_TEXT).filter((x) => x.startsWith("labs.reason.") && !/\{/.test((UI_TEXT as Record<string, Record<Lang, string>>)[x].English))) {
      const en = (UI_TEXT as Record<string, Record<Lang, string>>)[k].English;
      expect(labReason("Chinese", en), k).not.toBe(en);
    }
    expect(labReason("Chinese", "A reason we have never seen.")).toBe("A reason we have never seen.");
    expect(labReason("English", "Your report marks this line as high.")).toBe("Your report marks this line as high.");
  });
});

describe("safety lines keep their English beside them until reviewed (Codex review of PR 93)", () => {
  // Lines whose English mentions these words but tells nobody what to do about health: the read-aloud Stop button,
  // a bus stop, a section heading or count, the "Ask your pharmacist" button label, lab intro and range wording.
  const NOT_DIRECTIVE = new Set<string>([
    "steps.stop", "dock.stop.short", "dock.stop.long", "prep.stopReading", "plan.busStop", "ask.pharmacist", "ask.showPharmacist",
    "labs.intro1", "labs.intro2", "labs.rangesDiffer", "labs.noneChecked", "labs.partlyChecked", "labs.allClear", "labs.inRangeTitle",
    "labs.range", "labs.chip.inside", "labs.askIntro", "prep.kind.food_drink", "prep.kind.call",
    // Fragments of the dose line: MedicineChanges and the handoff sheet put the whole English sentence beside it.
    "med.doseWas", "med.sheetDoseWas",
    // Button labels, headings and counts that name a person to ask; the lines under them say what to do.
    "ask.clinic", "askClinic.title", "labs.askClinic", "prep.summary", "prep.slot.hours_before", "prep.askWhen",
  ]);
  const DIRECTIVE = /911|emergenc|warning|\bstop\b|\bdose\b|follow (your|my|the) paper|critical|\bhigh\b|\blow\b|right away|don.t miss|(ask|call) your (clinic|doctor|pharmacist)|before your procedure|\bskip/i;

  it("every line that sounds like a directive is on the safety list, or named here as not one", () => {
    const missing = (Object.keys(UI_TEXT) as UiKey[]).filter((k) => DIRECTIVE.test(UI_TEXT[k].English) && !UI_SAFETY_KEYS.has(k) && !NOT_DIRECTIVE.has(k) && !k.startsWith("labs.reason."));
    expect(missing).toEqual([]);
  });

  it("confirming that the text read from a photo is right is a safety line (Codex review, round 4)", () => {
    // Pressing these accepts the photo's text, and every step and every lab flag is built from it.
    for (const k of ["paper.itMatches", "labs.checkedNumbers"] as const) {
      expect(UI_SAFETY_KEYS.has(k), k).toBe(true);
      expect(englishBeside("Korean", k), k).toBe(UI_TEXT[k].English);
    }
  });

  it("no safety line is marked reviewed yet, so every one shows its English in every other language", () => {
    for (const l of LANGUAGES) expect(UI_SAFETY_REVIEWED[l].size, l).toBe(0);
    for (const k of UI_SAFETY_KEYS) {
      expect(englishBeside("English", k)).toBeNull();
      for (const l of LANGUAGES.filter((x) => x !== "English")) expect(englishBeside(l, k), `${k} ${l}`).toBe(UI_TEXT[k].English.replace(/\{n\}/, "{n}"));
    }
    expect(englishBeside("Spanish", "steps.title")).toBeNull(); // not a safety line
  });
});
