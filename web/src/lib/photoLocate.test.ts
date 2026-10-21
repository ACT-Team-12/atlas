import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_AVS } from "./sample";
import type { LocateProgress, Stage } from "./photoLocate";

// The OCR module stands in for tesseract.js. Its factory runs only when the module is actually imported,
// so `imports` counts real loads of the OCR code (and, in the browser, its ~7 MB download).
const ocr = { imports: 0, langs: [] as string[], events: [] as [Stage, number][] };
function mockOcr() {
  vi.doMock("./paperOcr", () => {
    ocr.imports++;
    return {
      readPhoto: async (_f: File, lang: string, onProgress?: (s: Stage, f: number) => void) => {
        ocr.langs.push(lang);
        for (const [s, f] of ocr.events) onProgress?.(s, f);
        return { width: 100, height: 100, words: [] };
      },
    };
  });
}

const photo = () => new File([new Uint8Array([1])], "paper.png", { type: "image/png" });
const span = (text: string) => ({ start: 0, end: Math.min(20, text.length) });

async function locate(text: string, onProgress: (p: LocateProgress) => void = () => {}) {
  const { locateOnPhoto } = await import("./photoLocate");
  return locateOnPhoto(text, span(text), photo(), onProgress);
}

beforeEach(() => {
  vi.resetModules();
  mockOcr();
  ocr.imports = 0;
  ocr.langs = [];
  ocr.events = [];
});

const UNSUPPORTED: Record<string, string> = {
  Vietnamese: "Uống 1 viên thuốc mỗi ngày vào buổi sáng sau khi ăn. Gọi cho bác sĩ nếu bạn bị sốt. Tái khám sau hai tuần để kiểm tra huyết áp.",
  Korean: "하루에 한 번 아침 식사 후 약을 한 알 드세요. 열이 나면 의사에게 전화하세요. 2주 후에 혈압 검사를 위해 다시 오세요.",
  Chinese: "每天早餐后服用一片药。如果发烧，请给医生打电话。两周后回来复诊检查血压。",
  Amharic: "በየቀኑ ጠዋት ከምግብ በኋላ አንድ ክኒን ይውሰዱ። ትኩሳት ካለብዎ ለሐኪምዎ ይደውሉ። ከሁለት ሳምንት በኋላ ተመልሰው ይምጡ።",
  French: "Prenez un comprimé par jour avec le petit déjeuner. Appelez votre médecin si vous avez de la fièvre. Revenez dans deux semaines pour un contrôle de la tension.",
};

describe("locateOnPhoto: languages the photo reader has no data for", () => {
  for (const [name, text] of Object.entries(UNSUPPORTED)) {
    it(`skips OCR entirely for a ${name} paper (no import, no download)`, async () => {
      const r = await locate(text);
      expect(r.kind).toBe("unsupported");
      expect(ocr.imports).toBe(0);
      expect(ocr.langs).toEqual([]);
    });
  }

  it("still reads English and Spanish papers (control: the mock does count a real import)", async () => {
    await locate(SAMPLE_AVS);
    expect(ocr.imports).toBe(1);
    vi.resetModules();
    mockOcr();
    await locate("Tome 1 tableta por la boca dos veces al día con las comidas. Llame a su médico si tiene fiebre. Regrese en dos semanas para una cita de control de la presión.");
    expect(ocr.langs).toEqual(["eng", "spa"]);
  });
});

describe("locateOnPhoto: progress announcements", () => {
  it("changes the status line only a few times (start, 0%, 50%), while the bar still gets every step", async () => {
    for (let i = 0; i <= 10; i++) ocr.events.push(["loading", i / 10]);
    for (let i = 0; i <= 100; i++) ocr.events.push(["reading", i / 100]);
    const seen: LocateProgress[] = [];
    await locate(SAMPLE_AVS, (p) => seen.push(p));
    const said = seen.map((p) => `${p.stage} ${p.said}%`).filter((m, i, a) => i === 0 || m !== a[i - 1]);
    expect(said).toEqual(["loading 0%", "reading 0%", "reading 50%"]);
    expect(seen.at(-1)!.pct).toBe(100);
  });
});
