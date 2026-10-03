import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/ui/Nav", () => ({ Nav: () => null }));
vi.mock("@/ui/Footer", () => ({ Footer: () => null }));

/**
 * The 30-minute limit on a call's stored number and plan is ATLAS refusing to open them (lib/call/seal.ts checks the
 * expiry under a long-lived key). It is not cryptographic erasure, so no user-facing copy may say the encryption
 * itself stops them being opened. This guards the three sources that carry that copy and the rendered privacy page.
 */
const OLD_CLAIM = /can(?:'|&apos;|’|no)t be opened|cannot be opened|encryption itself|never readable past|not readable after/i;
const SOURCES = ["src/lib/call/messages.ts", "src/ui/CallMe.tsx", "src/app/privacy/page.tsx"];

describe("call retention copy", () => {
  it.each(SOURCES)("%s makes no cryptographic-expiry claim and says what ATLAS actually does", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src.length).toBeGreaterThan(500); // the file was really read
    expect(src.match(OLD_CLAIM)?.[0] ?? null).toBeNull();
    expect(src).toMatch(/ATLAS refuses to open (them|it) after/);
  });

  it("the rendered privacy page makes no cryptographic-expiry claim, and states the refusal and the cleanup interval", async () => {
    const Page = (await import("@/app/privacy/page")).default;
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain("Phone calls");
    expect(html.match(OLD_CLAIM)?.[0] ?? null).toBeNull();
    expect(html).toContain("ATLAS refuses to open them after 30 minutes");
    expect(html).toContain("The cleanup runs every 5 minutes");
  });

  it("the guard pattern catches each old wording (so a pass is not vacuous)", () => {
    for (const old of ["They can&apos;t be opened after 30 minutes in any case.", "They can't be opened after 30 minutes",
      "the encryption itself stops your number and plan being opened", "never readable past 30 minutes"]) {
      expect(old).toMatch(OLD_CLAIM);
    }
  });

  it("the cleanup interval the copy states is the one scheduled in vercel.json", () => {
    const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.find((c) => c.path === "/api/call/sweep")?.schedule).toBe("*/5 * * * *");
  });
});
