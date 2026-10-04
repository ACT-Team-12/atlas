import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as P from "./provenance";
import { SESSION_HEADINGS } from "./sessionSummary";

const repo = join(process.cwd(), "..");
const native = {
  iosShare: "mobile/ios/ATLAS/Support/ShareText.swift",
  iosPlan: "mobile/ios/ATLAS/Views/PlanView.swift",
  androidShare: "mobile/android/app/src/main/java/com/stephensookra/atlas/data/ShareText.kt",
  androidPlan: "mobile/android/app/src/main/java/com/stephensookra/atlas/ui/PlanScreen.kt",
};
const read = (f: string) => readFileSync(join(repo, f), "utf8");

// A caregiver could not tell whether the plan's places came from the doctor or from ATLAS (Oct 4). The labels say who
// suggested them, and never claim a place is not on the paper: the doctor may have named the same one (Codex review).
describe("who suggested the places to call", () => {
  const labels = [P.BY_ATLAS, P.BY_ATLAS_CHECK_PAPER, P.PLACES_NOTE, P.HELP_HEADING_SHEET, P.HELP_HEADING_SHARE, SESSION_HEADINGS[2]];

  // Any "not ... paper" or "not ... doctor" contrast: the claim ATLAS cannot back, whatever the exact words.
  const CONTRAST = /\bnot\b[^.]*\b(?:paper|doctor)\b|\b(?:paper|doctor)\b[^.]*\bdid not\b/i;

  it("the guard catches every wording an earlier review removed", () => {
    for (const removed of [
      "Your doctor did not send you to them.",
      "They are suggestions, not instructions from your paper.",
      "Suggested by ATLAS, not from your paper",
      "Who can help (picked by ATLAS, not by my doctor; checked numbers)",
      "Suggestions from ATLAS, not your paper",
    ]) expect(removed).toMatch(CONTRAST);
  });

  it("every label names ATLAS and none contrasts the place with the paper or the doctor", () => {
    for (const l of labels) {
      expect(l).toMatch(/ATLAS/);
      expect(l).not.toMatch(CONTRAST);
    }
  });

  // The claim itself, in any order and across sentences or source lines: "not (from/on/in/by) the/your/my paper or
  // doctor" within 200 characters of "ATLAS" in the file's text with whitespace and string joins collapsed.
  const CLAIM = /\bnot\s+(?:(?:from|on|in|by)\s+)?(?:the|your|my)\s+(?:paper|doctor)\b/gi;
  // True statements that use the same words: a check result about a number.
  const ALLOWED = [/Number not in your paper/i];
  const claimsNearAtlas = (text: string): string[] => {
    const flat = text.replace(/["'`]\s*\+\s*["'`]/g, "").replace(/\s+/g, " ");
    return [...flat.matchAll(CLAIM)].map((m) => flat.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200))
      .filter((w) => /ATLAS/.test(w) && !ALLOWED.some((a) => a.test(w)));
  };

  it("the claim guard catches reversed, split and sentence-separated wordings", () => {
    for (const bad of [
      "Not from your paper: suggested by ATLAS",
      "ATLAS suggested this. It is not from your paper.",
      'const s = "Suggested by ATLAS, " +\n  "not the paper";',
      "Suggestion from ATLAS, not the paper: Mercy Care",
    ]) expect(claimsNearAtlas(bad)).not.toEqual([]);
    expect(claimsNearAtlas("ATLAS explains your paper. It is not medical advice.")).toEqual([]);
  });

  it("no shipped file makes that claim near ATLAS, on the web or in either app", () => {
    // Source files, not tests: tests quote the removed wording on purpose.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? (n === "node_modules" || n === "build" ? [] : walk(p)) : /\.(tsx?|swift|kt)$/.test(n) && !/test|Tests?\./i.test(n) ? [p] : [];
    });
    const files = ["web/src", "mobile/ios/ATLAS", "mobile/android/app/src/main"].flatMap((d) => walk(join(repo, d)));
    expect(files.length).toBeGreaterThan(150); // a walk that finds nothing would pass silently
    const bad = files.flatMap((f) => claimsNearAtlas(readFileSync(f, "utf8")).map((w) => `${f.slice(repo.length + 1)}: ...${w.slice(150, 300)}...`));
    expect(bad).toEqual([]);
  });

  it("the iPhone and Android apps use the same words as the website", () => {
    expect(read(native.iosShare)).toContain(`"${P.HELP_HEADING_SHARE}"`);
    expect(read(native.androidShare)).toContain(`"${P.HELP_HEADING_SHARE}"`);
    expect(read(native.iosPlan)).toContain(`"${P.BY_ATLAS_CHECK_PAPER}"`);
    expect(read(native.androidPlan)).toContain(`"${P.BY_ATLAS_CHECK_PAPER}"`);
    // The lines around the native labels, not whole files (other app text can say "not" and "paper" in one sentence).
    for (const f of Object.values(native)) {
      const near = read(f).split("\n").filter((line) => /Suggested by ATLAS|WHO CAN HELP/.test(line));
      expect(near.length).toBeGreaterThan(0);
      for (const line of near) expect(line).not.toMatch(CONTRAST);
      expect(read(f)).not.toMatch(/checked numbers\)/);
    }
  });
});
