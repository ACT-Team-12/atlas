import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { quantities, suggestOption } from "./answerMatch";
import { pickMimeType, SayAnswer } from "@/ui/SayAnswer";

/**
 * Speech never grades (design decision, 2026-10-02). suggestOption only proposes "Did you mean ...?" when the words
 * said are a near-exact restatement of exactly one option; the person's tap is still the only answer recorded.
 */
describe("suggests only on a near-exact restatement", () => {
  const dose = ["Take 1 tablet 2 times a day", "Take 2 tablets 1 time a day", "Take 1 tablet at bedtime"];
  const food = ["Take it with food", "Take it without food", "Take it at bedtime"];

  it("exact restatements still suggest, with filler words allowed", () => {
    expect(suggestOption("take one tablet two times a day", dose)).toBe(0);
    expect(suggestOption("I think you take 2 tablets one time a day", dose)).toBe(1);
    expect(suggestOption("Take it with food.", food)).toBe(0);
    expect(suggestOption("um, take it without food", food)).toBe(1);
  });

  it("reviewer cases return null (Codex round 2)", () => {
    expect(suggestOption("decrease the dose", ["Increase the dose", "Keep the same dose", "Stop the medicine"])).toBeNull();
    expect(suggestOption("take it after eating", ["Take it before eating", "Take it at night", "Take it with water"])).toBeNull();
    expect(suggestOption("take 5 g", ["Take 5 mg", "Take 10 mg", "Take 50 mg"])).toBeNull();
    expect(suggestOption("2 tablets 1 time", ["1 tablet 2 times", "3 tablets 1 time", "1 tablet 1 time"])).toBeNull();
    expect(suggestOption("take 2 tablets 1 time a day", ["Take 1 tablet 2 times a day", "Take 1 tablet at bedtime", "Take 3 tablets"])).toBeNull();
  });

  it("word order and repeats count: a reversed relation never suggests (Codex round 3)", () => {
    const order = ["Take aspirin before ibuprofen", "Take ibuprofen with food", "Stop aspirin"];
    expect(suggestOption("take ibuprofen before aspirin", order)).toBeNull();
    expect(suggestOption("take aspirin before ibuprofen", order)).toBe(0);
    expect(suggestOption("take aspirin before aspirin", order)).toBeNull();
    expect(suggestOption("先吃B再吃A", ["先吃A再吃B", "只吃B", "不吃A"])).toBeNull();
  });

  it("anything extra or missing returns null", () => {
    expect(suggestOption("take it with food in the morning", food)).toBeNull();
    expect(suggestOption("with food", food)).toBeNull();
    expect(suggestOption("I'm not sure", food)).toBeNull();
    expect(suggestOption("", food)).toBeNull();
  });

  it("negatives never suggest the positive", () => {
    const pair = ["Take it with food", "Do not take it with food", "Take it at bedtime"];
    for (const said of ["I cannot take it with food", "I should avoid taking it with food", "never take it with food", "No, take it with food", "stop taking it with food"]) {
      expect(suggestOption(said, pair), said).not.toBe(0);
    }
    expect(suggestOption("do not take it with food", pair)).toBe(1);
    expect(suggestOption("don't take it with food", pair)).toBe(1);
  });

  it("decimals, halves and units are exact", () => {
    const mg = ["Take 0.5 mg", "Take 5 mg", "Take 10 mg"];
    for (const said of ["take point five mg", "take .5 mg", "take zero point five mg", "take half a milligram", "take 0,5 mg", "take 1/2 mg"]) {
      expect(suggestOption(said, mg), said).not.toBe(1);
    }
    expect(suggestOption("take 0.5 mg", mg)).toBe(0);
    expect(suggestOption("take five milligrams", mg)).toBe(1);
    expect(suggestOption("take 5.5.5 mg", mg)).toBeNull();
    expect(suggestOption("take 5 ml", mg)).toBeNull();
  });

  it("quantities carry value, unit and role, in order", () => {
    expect(quantities("Take 1 tablet 2 times a day for 5 days")).toEqual([
      { value: "1", unit: "tablet", role: "dose" }, { value: "2", unit: "time", role: "frequency" }, { value: "5", unit: "day", role: "duration" },
    ]);
    expect(quantities("twice a day")).toEqual([{ value: "2", unit: "time", role: "frequency" }]);
  });

  it("other languages: antonyms and units differ, restatements suggest", () => {
    expect(suggestOption("tome dos tabletas tres veces al día", ["Tome 2 tabletas 3 veces al día", "Tome 3 tabletas 2 veces al día", "Tome 1 tableta"])).toBe(0);
    expect(suggestOption("tome 3 tabletas 2 veces al día", ["Tome 2 tabletas 3 veces al día", "Tome 1 tableta", "Tome 4 tabletas"])).toBeNull();
    expect(suggestOption("tómelo después de comer", ["Tómelo antes de comer", "Tómelo de noche", "Tómelo con agua"])).toBeNull();
    expect(suggestOption("aumente la dosis", ["Disminuya la dosis", "Mantenga la dosis", "Suspenda el medicamento"])).toBeNull();
    expect(suggestOption("prenez-le après le repas", ["Prenez-le avant le repas", "Prenez-le le soir", "Prenez-le avec de l'eau"])).toBeNull();
    expect(suggestOption("prenez-le avant le repas", ["Prenez-le avant le repas", "Prenez-le le soir", "Prenez-le avec de l'eau"])).toBe(0);
    expect(suggestOption("uống sau khi ăn", ["Uống trước khi ăn", "Uống buổi tối", "Uống với nước"])).toBeNull();
    expect(suggestOption("식후에 드세요", ["식전에 드세요", "저녁에 드세요", "물과 함께 드세요"])).toBeNull();
    expect(suggestOption("饭后吃", ["饭前吃", "晚上吃", "和水一起吃"])).toBeNull();
    expect(suggestOption("饭前吃", ["饭前吃", "晚上吃", "和水一起吃"])).toBe(0);
    expect(suggestOption("吃5克", ["吃5毫克", "吃10毫克", "吃50毫克"])).toBeNull();
  });
});

describe("Say your answer button", () => {
  const props = { language: "English", token: "t", onTranscript: () => {} };

  it("renders nothing when speech to text is off (no key)", () => {
    expect(renderToStaticMarkup(createElement(SayAnswer, { ...props, enabled: false }))).toBe("");
  });

  it("shows a labelled mic button and a live status line when on", () => {
    const html = renderToStaticMarkup(createElement(SayAnswer, { ...props, enabled: true }));
    expect(html).toContain("Say your answer");
    expect(html).toContain('aria-label="Say your answer out loud"');
    expect(html).toContain('aria-live="polite"');
  });

  it("records WebM/Opus where it can and falls back to MP4 for Safari", () => {
    expect(pickMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeNull();
  });
});

