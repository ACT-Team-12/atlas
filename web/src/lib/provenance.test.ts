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

  it("no shipped line pairs ATLAS with a not-the-paper contrast, on the web or in either app", () => {
    // Source files, not tests: tests quote the removed wording on purpose.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? (n === "node_modules" || n === "build" ? [] : walk(p)) : /\.(tsx?|swift|kt)$/.test(n) && !/test|Tests?\./i.test(n) ? [p] : [];
    });
    const files = ["web/src", "mobile/ios/ATLAS", "mobile/android/app/src/main"].flatMap((d) => walk(join(repo, d)));
    expect(files.length).toBeGreaterThan(150); // a walk that finds nothing would pass silently
    const bad = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i, line })))
      .filter(({ line }) => /ATLAS[^.\n]*\bnot\s+(?:(?:from|on|in|by)\s+)?(?:the|your|my)\s+(?:paper|doctor)\b/i.test(line))
      .map(({ f, i, line }) => `${f.slice(repo.length + 1)}:${i + 1}: ${line.trim().slice(0, 120)}`);
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
