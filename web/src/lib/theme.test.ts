// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY, THEME_SCRIPT, readThemePref, setThemePref } from "./theme";

/** A matchMedia whose "(prefers-color-scheme: dark)" answer we control, with a working change listener. */
function fakeSystem(dark: boolean) {
  const listeners: (() => void)[] = [];
  const mq = {
    get matches() { return dark; },
    addEventListener: (_: string, f: () => void) => listeners.push(f),
  };
  window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
  return { flip(next: boolean) { dark = next; listeners.forEach((f) => f()); } };
}
const run = () => new Function(THEME_SCRIPT)();
const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
  html().removeAttribute("data-theme-pref");
  delete window.__atlasTheme;
});
afterEach(() => vi.restoreAllMocks());

describe("theme script (runs before the first paint)", () => {
  it("follows the phone by default, and keeps following it when the setting changes", () => {
    const sys = fakeSystem(true);
    run();
    expect(html().dataset.theme).toBe("dark");
    expect(html().dataset.themePref).toBe("system");
    sys.flip(false);
    expect(html().dataset.theme).toBe("light");
  });

  it("a saved Light or Dark choice wins over the phone, and ignores later phone changes", () => {
    const sys = fakeSystem(true);
    localStorage.setItem(THEME_KEY, "light");
    run();
    expect(html().dataset.theme).toBe("light");
    sys.flip(true);
    expect(html().dataset.theme).toBe("light");
  });

  it("falls back to System when storage throws (private mode) or holds junk", () => {
    fakeSystem(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    run();
    expect(html().dataset.theme).toBe("light");
    expect(readThemePref()).toBe("system");
    vi.restoreAllMocks();
    localStorage.setItem(THEME_KEY, "purple");
    run();
    expect(readThemePref()).toBe("system");
  });
});

describe("the toggle's setter", () => {
  it("saves Dark, applies it at once, and System clears the saved choice", () => {
    fakeSystem(false);
    run();
    setThemePref("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(html().dataset.theme).toBe("dark");
    setThemePref("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(html().dataset.theme).toBe("light");
    expect(readThemePref()).toBe("system");
  });

  it("still switches the page when storage refuses to save", () => {
    fakeSystem(false);
    run();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    setThemePref("dark");
    expect(html().dataset.theme).toBe("dark");
    expect(readThemePref()).toBe("dark");
  });
});
