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
