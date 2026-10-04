import { describe, expect, it } from "vitest";
import { ASK_TEXT, askAboutQuestion, askText, isUrgentQuestion } from "./askText";
import { LANGUAGES } from "./schema";
import { paperFirstView } from "./paperFirst";

describe("Ask my paper strings", () => {
  it("has every string, non-empty, in all 7 languages", () => {
    const keys = Object.keys(ASK_TEXT.English).sort();
    for (const lang of LANGUAGES) {
      const t = ASK_TEXT[lang];
      expect(Object.keys(t).sort(), lang).toEqual(keys);
      for (const k of keys) {
        const v = t[k as keyof typeof t];
        const s = typeof v === "function" ? (v as (x: never) => string)(("can I drive?" as never)) : v;
        expect(typeof s === "string" && s.trim().length > 0, `${lang}.${k}`).toBe(true);
      }
      expect(t.held(2), lang).toContain("2");
      expect(t.readyQuestion("can I drive?"), lang).toContain("can I drive?");
    }
  });

  it("translates every line (only English reads like English)", () => {
    for (const lang of LANGUAGES.filter((l) => l !== "English")) {
      for (const k of ["title", "refusal", "urgentTitle", "urgentBody", "paperLabel", "leadNote"] as const) {
        expect(ASK_TEXT[lang][k], `${lang}.${k}`).not.toBe(ASK_TEXT.English[k]);
      }
    }
  });

  it("English refusal is exactly the fixed sentence", () => {
    expect(ASK_TEXT.English.refusal).toBe("Your paper doesn't say. Ask your clinic or pharmacist.");
  });

  it("labels match the paper-first rule's own wording in English", () => {
    const v = paperFirstView({ quote: "q", explanation: ["e"], check: "unchecked" });
    expect(ASK_TEXT.English.leadNote).toBe(v.note);
    expect(ASK_TEXT.English.paperLabel).toBe(v.screenLabel);
  });

  it("every emergency line names 911 and 211", () => {
    for (const lang of LANGUAGES) {
      expect(ASK_TEXT[lang].urgentBody, lang).toContain("911");
      expect(ASK_TEXT[lang].urgentBody, lang).toContain("211");
    }
  });

  it("falls back to English for an unknown language", () => {
    expect(askText("Klingon")).toBe(ASK_TEXT.English);
  });

  it("no em dashes or curly quotes in any string", () => {
    const all = JSON.stringify(ASK_TEXT) + LANGUAGES.map((l) => ASK_TEXT[l].readyQuestion("q") + ASK_TEXT[l].held(3)).join("");
    expect(all).not.toMatch(/[—–“”‘’]/);
  });
});

describe("ready question when the paper doesn't say", () => {
  it("is built only from the person's own question and fixed words", () => {
    const a = askAboutQuestion("  can I   drink alcohol? ", "English");
    expect(a).toEqual({ who: "clinic", label: "A question ready to ask", question: 'I couldn\'t find the answer to this in my visit paper: "can I drink alcohol?" Can you help me?' });
  });

  it("uses the person's language for the fixed words", () => {
    expect(askAboutQuestion("¿puedo manejar?", "Spanish").question).toBe('No encontré la respuesta a esto en mi papel de la visita: "¿puedo manejar?" ¿Me puede ayudar?');
  });
});

describe("urgent questions never go to the AI", () => {
  const urgent: [string, string][] = [
    ["English", "I have chest pain right now"],
    ["English", "my chest hurts"],
    ["English", "I can't breathe"],
    ["English", "I think I took too many pills"],
    ["English", "I swallowed the whole bottle"],
    // Codex review, round 5: common emergency presentations a paper's warning line would not word this way.
    ["English", "my throat is closing"],
    ["English", "my throat is swelling up"],
    ["English", "I am coughing up blood"],
    ["English", "I'm vomiting blood"],
    ["English", "my face is drooping and my speech is slurred"],
    ["English", "I took 20 pills"],
    ["English", "I want to die"],
    ["Spanish", "se me cierra la garganta"],
    ["Spanish", "estoy tosiendo sangre"],
    ["Spanish", "quiero morir"],
    ["French", "ma gorge se ferme"],
    ["French", "je crache du sang"],
    ["Vietnamese", "tôi ho ra máu"],
    ["Korean", "목이 붓고 숨이 막혀요"],
    ["Chinese", "我咳血"],
    ["Amharic", "ደም እያስታወከኝ ነው"],
    ["Spanish", "tengo dolor en el pecho"],
    ["Spanish", "no puedo respirar"],
    ["Vietnamese", "tôi bị đau ngực"],
    ["Vietnamese", "tôi khó thở"],
    ["Korean", "가슴 통증이 있어요"],
    ["Korean", "숨이 차요"],
    ["Chinese", "我胸痛"],
    ["Chinese", "我呼吸困难"],
    ["Amharic", "የደረት ህመም አለኝ"],
    ["Amharic", "የመተንፈስ ችግር አለብኝ"],
    ["French", "j'ai une douleur thoracique"],
    ["French", "je ne peux pas respirer"],
  ];
  it.each(urgent)("%s: %s", (_lang, q) => {
    expect(isUrgentQuestion(q)).toBe(true);
  });

  const ordinary = [
    "can I drive?",
    "when do I stop ibuprofen?",
    "how often do I take metformin?",
    "¿cuándo dejo el ibuprofeno?",
    "Quand dois-je revenir ?",
    "메트포르민은 얼마나 자주 먹나요?",
    "我什么时候复诊？",
    "this is not an emergency: can I drive?",
  ];
  it.each(ordinary)("not urgent: %s", (q) => {
    expect(isUrgentQuestion(q)).toBe(false);
  });
});
