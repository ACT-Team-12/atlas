// @vitest-environment jsdom
/**
 * The nav's language picker switches the website's own words and the page language, is remembered, and moves each
 * tool's "Explain it in" picker along with it. On page load it must not move a tool that already holds restored work,
 * so a saved plan keeps the language it was read in.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang } from "@/lib/uiText";
import { Hero } from "./Hero";
import { SITE_LANG_KEY, SiteLangPicker, SiteLangProvider, storedSiteLang, useFollowSiteLang } from "./SiteLang";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  // jsdom has no matchMedia; report reduced motion so the hero's animations stay off in the test.
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduce"), media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.lang = "en";
});

/** A stand-in tool: its own language, and whether it holds restored work. */
function Tool({ restored }: { restored: boolean }) {
  const [lang, setLang] = useState<Lang>("English");
  useFollowSiteLang((l, source) => { if (!(source === "load" && restored)) setLang(l); });
  return <p data-tool-lang="">{lang}</p>;
}

const pick = (value: string) => {
  const sel = host.querySelector("[data-site-lang]") as HTMLSelectElement;
  act(() => {
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("site language", () => {
  it("switches the hero and <html lang>, and remembers the choice", () => {
    act(() => root.render(<SiteLangProvider><SiteLangPicker /><Hero /></SiteLangProvider>));
    expect(host.querySelector("h1")?.textContent).toContain("Your visit, turned into a plan");
    pick("Spanish");
    expect(host.querySelector("h1")?.textContent).toContain("Su cita, convertida en un plan");
    expect(document.documentElement.lang).toBe("es");
    expect(localStorage.getItem(SITE_LANG_KEY)).toBe("Spanish");
    // The sample paper's quote is never translated.
    expect(host.textContent).toContain("Take 1 tablet by mouth 2 times a day with meals.");
  });

  it("moves a tool's language when a person picks one", () => {
    act(() => root.render(<SiteLangProvider><SiteLangPicker /><Tool restored /></SiteLangProvider>));
    expect(host.querySelector("[data-tool-lang]")?.textContent).toBe("English");
    pick("Vietnamese");
    expect(host.querySelector("[data-tool-lang]")?.textContent).toBe("Vietnamese");
  });

  it("on page load, opens a fresh tool in the remembered language but leaves restored work alone", () => {
    localStorage.setItem(SITE_LANG_KEY, "Korean");
    act(() => root.render(<SiteLangProvider><Tool restored={false} /><Tool restored /></SiteLangProvider>));
    const [fresh, restored] = [...host.querySelectorAll("[data-tool-lang]")].map((e) => e.textContent);
    expect(fresh).toBe("Korean");
    expect(restored).toBe("English");
    expect(document.documentElement.lang).toBe("ko");
  });

  it("reads ?lang= by name or code, and ignores anything else", () => {
    expect(storedSiteLang("?lang=spanish", () => null)).toBe("Spanish");
    expect(storedSiteLang("?lang=vi", () => null)).toBe("Vietnamese");
    expect(storedSiteLang("?lang=klingon", () => "French")).toBe("French");
    expect(storedSiteLang("", () => "Nope")).toBeNull();
    expect(storedSiteLang("", () => { throw new Error("blocked"); })).toBeNull();
  });
});
