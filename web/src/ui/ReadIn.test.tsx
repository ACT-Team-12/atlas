// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { NATIVE_NAME, ReadIn } from "./ReadIn";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const radios = (name: string) => [...host.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${name}"]`)];

describe("ReadIn", () => {
  it("shows every language in its own words, with the English name for screen readers, and every level", () => {
    act(() => root.render(<ReadIn language="English" level="simple" onLanguage={() => {}} onLevel={() => {}} />));
    expect(radios("read-in-language").map((r) => r.value)).toEqual([...LANGUAGES]);
    expect(radios("read-in-level").map((r) => r.value)).toEqual([...READING_LEVELS]);
    for (const l of LANGUAGES) expect(host.querySelector(`[data-language="${l}"]`)!.textContent).toContain(NATIVE_NAME[l]);
    expect(host.querySelector('[data-language="Spanish"]')!.textContent).toContain("(Spanish)");
    expect(host.querySelector('[data-language="Amharic"] [lang]')!.getAttribute("lang")).toBeTruthy();
    expect(host.textContent).toContain("Simple: short, everyday words.");
  });

  it("marks the current choices and reports a new one", () => {
    const onLanguage = vi.fn(), onLevel = vi.fn();
    act(() => root.render(<ReadIn language="Vietnamese" level="standard" onLanguage={onLanguage} onLevel={onLevel} />));
    expect(radios("read-in-language").find((r) => r.checked)!.value).toBe("Vietnamese");
    expect(radios("read-in-level").find((r) => r.checked)!.value).toBe("standard");
    act(() => radios("read-in-language").find((r) => r.value === "Amharic")!.click());
    act(() => radios("read-in-level").find((r) => r.value === "detailed")!.click());
    expect(onLanguage).toHaveBeenCalledWith("Amharic");
    expect(onLevel).toHaveBeenCalledWith("detailed");
  });
});
