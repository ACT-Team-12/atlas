import { describe, expect, it } from "vitest";
import { guessOcrLang, matchOnPhoto, needed, normWord, spanContext, tokenize, wordScore, type OcrWord } from "./paperMatch";
import { findSpan } from "./verify";
import { SAMPLE_AVS } from "./sample";

/** Fake OCR output: one word per whitespace run, one line per "\n", 10px per character, 20px per line. */
function ocr(page: string): OcrWord[] {
  const out: OcrWord[] = [];
  page.split("\n").forEach((lineText, line) => {
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText))) out.push({ text: m[0], line, bbox: { x0: m.index * 10, y0: line * 20, x1: (m.index + m[0].length) * 10, y1: line * 20 + 16 } });
  });
  return out;
}

const words = (ws: OcrWord[], first: number, last: number) => ws.slice(first, last + 1).map((w) => w.text).join(" ");

function spanOf(source: string, quote: string) {
  const s = findSpan(source, quote);
  if (!s) throw new Error(`fixture quote not in source: ${quote}`);
  return s;
}

describe("spanContext", () => {
  const text = "line one\nline two\nTake 1 tablet daily.\nline four\nline five\nline six";
  it("cuts exactly at the verified offsets and keeps whole lines around them", () => {
    const span = spanOf(text, "1 tablet");
    const c = spanContext(text, span, 1)!;
    expect(c.quote).toBe("1 tablet");
    expect(c.before).toBe("line two\nTake ");
    expect(c.after).toBe(" daily.\nline four");
    expect(c.clippedBefore).toBe(true);
    expect(c.clippedAfter).toBe(true);
    expect(c.before + c.quote + c.after).toBe(text.slice(text.indexOf("line two"), text.indexOf("\nline five")));
  });
  it("stops at the start and end of the paper", () => {
    const c = spanContext(text, { start: 0, end: 4 }, 3)!;
    expect(c.before).toBe("");
    expect(c.clippedBefore).toBe(false);
    const d = spanContext(text, { start: text.length - 3, end: text.length }, 3)!;
    expect(d.after).toBe("");
    expect(d.clippedAfter).toBe(false);
  });
  it("refuses a missing or out-of-range span instead of guessing", () => {
    expect(spanContext(text, null)).toBeNull();
    expect(spanContext(text, { start: 5, end: 5 })).toBeNull();
    expect(spanContext(text, { start: -1, end: 4 })).toBeNull();
    expect(spanContext(text, { start: 2, end: text.length + 1 })).toBeNull();
  });
});

describe("tokens and words", () => {
  it("normalizes case, punctuation and accents", () => {
    expect(normWord("Follow-up,")).toBe("followup");
    expect(normWord("Médico")).toBe("medico");
    expect(normWord("...")).toBe("");
  });
  it("joins a word broken by a hyphen at the end of a line, but not a hyphen mid-line", () => {
    expect(tokenize("call the of-\nfice today").map((t) => t.norm)).toEqual(["call", "the", "office", "today"]);
    expect(tokenize("A1c - due").map((t) => t.norm)).toEqual(["a1c", "due"]);
  });
  it("accepts close OCR misreads of longer words only, and never a different number", () => {
    expect(wordScore("tablet", "tablet")).toBe(2);
    expect(wordScore("tablet", "tab1et")).toBe(0); // a digit appeared: not trusted
    expect(wordScore("glucophage", "glucophaqe")).toBe(1);
    expect(wordScore("mouth", "month")).toBe(1);
    expect(wordScore("500", "600")).toBe(0);
    expect(wordScore("day", "dav")).toBe(0); // too short to call it a misread
    expect(wordScore("medicine", "follow")).toBe(0);
  });
  it("requires every word of a short quote and most words of a long one", () => {
    expect(needed(3)).toBe(3);
    expect(needed(10)).toBe(8);
  });
});

describe("matchOnPhoto", () => {
  it("finds an exact quote and draws one box per line", () => {
    const ws = ocr(SAMPLE_AVS);
    const span = spanOf(SAMPLE_AVS, "Take 1 tablet by mouth 2 times a day with meals.");
    const m = matchOnPhoto(SAMPLE_AVS, span, ws);
    expect(m.status).toBe("found");
    if (m.status !== "found") return;
    expect(words(ws, m.first, m.last)).toBe("Take 1 tablet by mouth 2 times a day with meals.");
    expect(m.boxes).toHaveLength(1);
    expect(m.matched).toBe(m.total);
  });

  it("tolerates OCR noise: case, punctuation and a misread letter", () => {
    const source = "Metformin 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.";
    const photo = "METFORMIN 500 mg tablet Take 1 tablet by rnouth 2 times a day, with meals";
    const m = matchOnPhoto(source, spanOf(source, "Take 1 tablet by mouth 2 times a day with meals."), ocr(photo));
    expect(m.status).toBe("found");
    if (m.status === "found") expect(words(ocr(photo), m.first, m.last)).toBe("Take 1 tablet by rnouth 2 times a day, with meals");
  });

  it("follows a word split by a hyphen across two photo lines, and boxes both lines", () => {
    const source = "Schedule a follow-up appointment with endocrinology in 4 weeks.";
    const photo = "Schedule a follow-up appoint-\nment with endocrinology in 4 weeks.";
    const ws = ocr(photo);
    const m = matchOnPhoto(source, spanOf(source, source), ws);
    expect(m.status).toBe("found");
    if (m.status !== "found") return;
    expect(m.first).toBe(0);
    expect(m.last).toBe(ws.length - 1);
    expect(m.boxes).toHaveLength(2);
  });

  it("matches when the paper text itself has the hyphenated line break", () => {
    const source = "Check your blood sugar every morn-\ning before breakfast.";
    const photo = "Check your blood sugar every morning before breakfast.";
    const m = matchOnPhoto(source, spanOf(source, "Check your blood sugar every morn-\ning before breakfast."), ocr(photo));
    expect(m.status).toBe("found");
  });

  it("picks the copy of a repeated phrase that the verified span points at", () => {
    const source = "Morning:\nTake 1 tablet daily.\nNotes here.\nEvening:\nTake 1 tablet daily.\nMore notes.";
    const ws = ocr(source);
    const firstSpan = { start: source.indexOf("Take"), end: source.indexOf("Take") + "Take 1 tablet daily.".length };
    const second = source.lastIndexOf("Take");
    const secondSpan = { start: second, end: second + "Take 1 tablet daily.".length };
    const a = matchOnPhoto(source, firstSpan, ws);
    const b = matchOnPhoto(source, secondSpan, ws);
    expect(a.status).toBe("found");
    expect(b.status).toBe("found");
    if (a.status !== "found" || b.status !== "found") return;
    expect(ws[a.first].line).toBe(1);
    expect(ws[b.first].line).toBe(4);
  });

  it("uses the place on the page when OCR found a different number of copies, and refuses when that is unclear", () => {
    // The AI's reading has the phrase twice; the photo OCR only caught one copy near the end.
    const source = "Take 1 tablet daily.\n" + "filler words go here ".repeat(10) + "\nTake 1 tablet daily.";
    const photo = "Tak€ l tab|et dai1y.\n" + "filler words go here ".repeat(10) + "\nTake 1 tablet daily.";
    const last = source.lastIndexOf("Take");
    const m = matchOnPhoto(source, { start: last, end: last + 20 }, ocr(photo));
    expect(m.status).toBe("found");
    // The AI's reading skipped a repeated footer; the photo has it twice, far apart. The verified line is at the top.
    const src1 = "Take 1 tablet daily.\n" + "filler words go here ".repeat(10);
    const photo1 = "Take 1 tablet daily.\n" + "filler words go here ".repeat(10) + "\nTake 1 tablet daily.";
    const top = matchOnPhoto(src1, { start: 0, end: 20 }, ocr(photo1));
    expect(top.status === "found" && top.first).toBe(0);
    // Two copies on the photo, three in the text: the spot cannot be told apart by count or by place.
    const src3 = "Take 1 tablet daily. Take 1 tablet daily. Take 1 tablet daily.";
    const photo2 = "Take 1 tablet daily. Take 1 tablet daily.";
    const mid = src3.indexOf("Take", 5);
    expect(matchOnPhoto(src3, { start: mid, end: mid + 20 }, ocr(photo2))).toEqual({ status: "not_found", reason: "ambiguous" });
  });

  it("refuses when too few words match", () => {
    const source = "Call the clinic if your blood sugar is above 300 two times in a row.";
    const photo = "Call the office about your new glasses and bring your insurance card.";
    expect(matchOnPhoto(source, spanOf(source, source), ocr(photo)).status).toBe("not_found");
  });

  it("refuses when a number on the photo differs, even if every other word matches", () => {
    const source = "Take 1 tablet by mouth 2 times a day with meals.";
    const photo = "Take 1 tablet by mouth 3 times a day with meals.";
    expect(matchOnPhoto(source, spanOf(source, source), ocr(photo)).status).toBe("not_found");
  });

  it("refuses a short quote unless every word is there", () => {
    const source = "Hemoglobin A1c due in 3 months";
    const photo = "Hemoglobin due in 3 months";
    expect(matchOnPhoto(source, spanOf(source, "A1c due in 3"), ocr(photo)).status).toBe("not_found");
  });

  it("refuses words scattered across the page", () => {
    const source = "Take 1 tablet by mouth daily.";
    const photo = "Take your list. 1 more visit. tablet holder. by the way. mouth guard. daily walks.";
    expect(matchOnPhoto(source, spanOf(source, source), ocr(photo)).status).toBe("not_found");
  });

  it("never treats a decimal or fraction dose as a different number", () => {
    expect(normWord("1.5")).toBe("1.5");
    expect(normWord("1/2")).toBe("1/2");
    expect(normWord("5.")).toBe("5");
    for (const [paper, misread] of [["Take 1.5 tablets daily", "Take 15 tablets daily"], ["Take 1/2 tablet daily", "Take 12 tablet daily"], ["Take 1.0 mg daily", "Take 10 mg daily"], ["Take 0.5 mg daily", "Take 05 mg daily"]]) {
      expect(matchOnPhoto(paper, spanOf(paper, paper), ocr(misread)).status, `${paper} vs ${misread}`).toBe("not_found");
    }
    const same = "Take 1.5 tablets daily";
    expect(matchOnPhoto(same, spanOf(same, same), ocr(same)).status).toBe("found");
  });

  it("refuses when one copy of a repeated number is missing from the photo", () => {
    const source = "Take 5 mg in morning and 5 mg at night";
    const photo = "Take 5 mg in morning and mg at night";
    expect(matchOnPhoto(source, spanOf(source, source), ocr(photo)).status).toBe("not_found");
  });

  it("refuses when an extra number sits inside the matched words on the photo", () => {
    const source = "Take 5 mg daily with food";
    const photo = "Take 50 5 mg daily with food";
    expect(matchOnPhoto(source, spanOf(source, source), ocr(photo)).status).toBe("not_found");
  });

  it("boxes only the words that matched, never an extra word between them", () => {
    const source = "Take 1 tablet by mouth daily with meals";
    const photo = "Take 1 tablet by mouth XYZZY daily with meals";
    const ws = ocr(photo);
    const m = matchOnPhoto(source, spanOf(source, source), ws);
    expect(m.status).toBe("found");
    if (m.status !== "found") return;
    const extra = ws.find((w) => w.text === "XYZZY")!.bbox;
    for (const b of m.boxes) expect(b.x1 <= extra.x0 || b.x0 >= extra.x1, `box ${JSON.stringify(b)} covers the extra word`).toBe(true);
  });

  it("says when the photo had no readable words, and refuses without a span", () => {
    expect(matchOnPhoto("Take 1 tablet.", { start: 0, end: 14 }, [])).toEqual({ status: "not_found", reason: "no_words" });
    expect(matchOnPhoto("Take 1 tablet.", null, ocr("Take 1 tablet.")).status).toBe("not_found");
  });
});

describe("guessOcrLang", () => {
  it("reads English papers with English data", () => {
    expect(guessOcrLang(SAMPLE_AVS)).toBe("eng");
  });
  it("uses Spanish data only for a clearly Spanish paper", () => {
    expect(guessOcrLang("Tome 1 tableta por la boca dos veces al día con las comidas. Llame a su médico si tiene fiebre. Regrese en dos semanas para una cita de control de la presión.")).toBe("spa");
    expect(guessOcrLang("Take your metformin. Call Dr. de la Cruz if you have a fever.")).toBe("eng");
  });
});
