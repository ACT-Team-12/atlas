import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { matchOption } from "./answerMatch";
import { pickMimeType, SayAnswer } from "@/ui/SayAnswer";

describe("which option did they say", () => {
  const dose = ["1 tablet 2 times a day", "2 tablets 3 times a day", "1 tablet at bedtime"];

  it("matches the option whose numbers and words they said", () => {
    expect(matchOption("I take one tablet two times a day", dose)).toBe(0);
    expect(matchOption("2 tablets, 3 times a day.", dose)).toBe(1);
    expect(matchOption("one tablet at bedtime", dose)).toBe(2);
  });

  it("never picks an option whose number they did not say", () => {
    expect(matchOption("tablets times a day", dose)).toBeNull();
    expect(matchOption("four tablets four times a day", dose)).toBeNull();
  });

  it("keeps 'not' apart, so 'don't take it with food' is not 'take it with food'", () => {
    const food = ["Take it with food", "Do not take it with food", "Take it at night"];
    expect(matchOption("I think you don't take it with food", food)).toBe(1);
    expect(matchOption("take it with food", food)).toBe(0);
  });

  it("returns null when unclear, so the person taps instead", () => {
    expect(matchOption("", dose)).toBeNull();
    expect(matchOption("I'm not sure", ["Call the clinic", "Go to the ER", "Wait a week"])).toBeNull();
  });

  it("works in Spanish and Chinese", () => {
    expect(matchOption("dos tabletas tres veces al día", ["1 tableta 2 veces al día", "2 tabletas 3 veces al día", "1 tableta en la noche"])).toBe(1);
    expect(matchOption("每天早上吃药", ["每天早上吃药", "每天晚上吃药", "不要吃药"])).toBe(0);
    expect(matchOption("不要吃药", ["每天早上吃药", "每天晚上吃药", "不要吃药"])).toBe(2);
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

describe("polarity fails closed (Codex review, 2026-10-02)", () => {
  const food = ["Take it with food", "Take it on an empty stomach", "Take it at bedtime"];
  const pair = ["Take it with food", "Do not take it with food", "Take it at bedtime"];

  it("a spoken negative never lands on the positive option", () => {
    for (const said of [
      "I cannot take it with food", "I can't take it with food", "I should avoid taking it with food", "never take it with food",
      "I shouldn't take it with food", "you mustn't take it with food", "stop taking it with food", "skip it with food",
      "I'm not allowed to take it with food", "hold it with food", "refrain from taking it with food",
    ]) {
      expect(matchOption(said, food), said).toBeNull();
      expect(matchOption(said, pair), said).not.toBe(0);
    }
  });

  it("an unclear polarity (double negative, leading 'no') returns null when options differ only by 'not'", () => {
    expect(matchOption("No, take it with food", pair)).toBeNull();
    expect(matchOption("I don't think you can't take it with food", pair)).toBeNull();
  });

  it("other languages: the negative never matches the positive", () => {
    expect(matchOption("no lo tome con comida", ["Tómelo con comida", "No lo tome con comida", "Tómelo de noche"])).not.toBe(0);
    expect(matchOption("evite tomarlo con comida", ["Tómelo con comida", "Tómelo de noche", "Tómelo en ayunas"])).toBeNull();
    expect(matchOption("ne le prenez pas avec de la nourriture", ["Prenez-le avec de la nourriture", "Prenez-le le soir", "Prenez-le à jeun"])).toBeNull();
    expect(matchOption("không uống thuốc với thức ăn", ["Uống thuốc với thức ăn", "Uống thuốc buổi tối", "Uống thuốc lúc đói"])).toBeNull();
    expect(matchOption("음식과 함께 먹지 마세요", ["음식과 함께 드세요", "저녁에 드세요", "공복에 드세요"])).toBeNull();
    expect(matchOption("避免和食物一起吃", ["和食物一起吃", "晚上吃", "空腹吃"])).toBeNull();
  });
});

describe("quantities are exact (Codex review, 2026-10-02)", () => {
  const mg = ["Take 0.5 mg", "Take 5 mg", "Take 10 mg"];

  it("decimals, spoken decimals and halves are not 5", () => {
    for (const said of ["point five mg", ".5 mg", "zero point five mg", "half a milligram", "0.5 milligrams", "0,5 mg", "one half mg", "1/2 mg"]) {
      expect(matchOption(`take ${said}`, mg), said).not.toBe(1);
      expect([0, null]).toContain(matchOption(`take ${said}`, mg));
    }
    expect(matchOption("take 0.5 mg", mg)).toBe(0);
    expect(matchOption("take half a milligram", mg)).toBe(0);
    expect(matchOption("take 5 mg", mg)).toBe(1);
    expect(matchOption("take five milligrams", mg)).toBe(1);
    expect(matchOption("take ten mg", mg)).toBe(2);
    expect(matchOption("take one and a half tablets", ["Take 1 1/2 tablets", "Take 1 tablet", "Take 2 tablets"])).toBe(0);
    expect(matchOption("take one and a half tablets", ["Take 1.5 tablets", "Take 1 tablet", "Take 2 tablets"])).toBe(0);
    expect(matchOption("take 1 tablet", ["Take 1 1/2 tablets", "Take 1 tablet", "Take 2 tablets"])).toBe(1);
  });

  it("a number the option does not have, or an unreadable one, returns null", () => {
    expect(matchOption("take 5 mg and 10 mg", mg)).toBeNull();
    expect(matchOption("take point mg", mg)).toBeNull();
    expect(matchOption("take 5.5.5 mg", mg)).toBeNull();
    expect(matchOption("take 50 mg", mg)).toBeNull();
  });

  it("Spanish and French decimals", () => {
    expect(matchOption("tome cero coma cinco mg", ["Tome 0,5 mg", "Tome 5 mg", "Tome 10 mg"])).toBe(0);
    expect(matchOption("prenez un demi milligramme", ["Prenez 0,5 mg", "Prenez 5 mg", "Prenez 10 mg"])).toBe(0);
  });
});
