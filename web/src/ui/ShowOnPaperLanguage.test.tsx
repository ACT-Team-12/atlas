// @vitest-environment jsdom
/**
 * "Show on my paper" in another language (Codex review of PR 93, round 4): the unsupported-photo line, the reader's
 * progress line and the photo's alt text came from English constants in lib/photoLocate.ts and the JSX. Each is now a
 * line in lib/uiText.ts, put in the person's language when it is drawn.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import type { LocateProgress, LocateResult } from "@/lib/photoLocate";
import { LANGUAGES } from "@/lib/schema";
import { ui, type Lang } from "@/lib/uiText";

// The photo reader is replaced: each test decides what it reports and when it finishes.
const reader: { progress: LocateProgress[]; result: Promise<LocateResult> } = { progress: [], result: new Promise(() => {}) };
vi.mock("@/lib/photoLocate", async (orig) => ({
  ...(await orig<typeof import("@/lib/photoLocate")>()),
  locateOnPhoto: async (_t: string, _s: unknown, _p: File, onProgress: (p: LocateProgress) => void) => { for (const p of reader.progress) onProgress(p); return reader.result; },
}));
import { ShowOnPaper } from "./ShowOnPaper";
import { UiLangProvider } from "./UiLang";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EN_TEXT = "Take 1 tablet by mouth 2 times a day with meals. Call your doctor if you have a fever. Return in two weeks for a blood pressure check.";
const KO_TEXT = "하루 두 번 식사와 함께 1정을 드세요. 열이 나면 의사에게 전화하세요. 2주 후에 혈압 검사를 받으러 오세요.";
const photo = new File(["x"], "paper.jpg", { type: "image/jpeg" });

const item = (text: string): VerifiedItem => ({
  id: "s1", kind: "self_care", title: "T", plain_language: "", why: "", when: "", source_quote: text.slice(0, 20), needs_clarification: false,
  question_for_clinic: "", grounded: true, span: { start: 0, end: 20 },
});

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  reader.progress = [];
  reader.result = new Promise(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  URL.createObjectURL = () => "blob:photo";
  URL.revokeObjectURL = () => {};
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function openFor(lang: Lang, text: string) {
  const care = { source_text: text, source_kind: "image" } as unknown as CarePlanResponse;
  await act(async () => { root.render(<UiLangProvider language={lang}><ShowOnPaper care={care} item={item(text)} photo={photo} check="unchecked" /></UiLangProvider>); });
  await act(async () => { host.querySelector("button")!.click(); await new Promise((r) => setTimeout(r, 0)); });
}
const status = () => host.querySelector("dialog [role=status]")?.textContent ?? "";

describe("Show on my paper speaks the person's language", () => {
  for (const lang of LANGUAGES.filter((l) => l !== "English")) {
    it(`${lang}: a paper the photo reader can't read says so in ${lang}`, async () => {
      await openFor(lang, KO_TEXT);
      expect(status()).toBe(ui(lang, "show.unsupported"));
    });

    it(`${lang}: the reader's progress line`, async () => {
      await openFor(lang, EN_TEXT);
      expect(status()).toBe(ui(lang, "show.loadingReader"));
      act(() => root.unmount());
      root = createRoot(host);
      reader.progress = [{ stage: "reading", pct: 63, said: 50 }];
      await openFor(lang, EN_TEXT);
      expect(status()).toBe(ui(lang, "show.readingPhoto", { pct: 50 }));
    });

    it(`${lang}: the photo's alt text`, async () => {
      reader.result = Promise.resolve({ kind: "found", page: { width: 100, height: 100, words: [] }, boxes: [{ x0: 1, y0: 1, x1: 9, y1: 9 }], matched: 1, total: 1 } as unknown as LocateResult);
      await openFor(lang, EN_TEXT);
      const img = host.querySelector("dialog img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("alt")).toBe(ui(lang, "show.photoAlt"));
    });
  }

  it("English keeps its words", async () => {
    await openFor("English", KO_TEXT);
    expect(status()).toBe("Highlighting on photos works for English and Spanish papers for now. Here is the quote on the text we read:");
  });
});
