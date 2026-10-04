import { readFileSync } from "node:fs";
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

  it("every label names ATLAS and none claims the place is not from the paper or the doctor", () => {
    for (const l of labels) {
      expect(l).toMatch(/ATLAS/);
      expect(l).not.toMatch(/not (?:from|on|in) (?:your|my|the) paper|doctor did not|not (?:from|by) (?:your|my|the) doctor/i);
    }
  });

  it("the iPhone and Android apps use the same words as the website", () => {
    expect(read(native.iosShare)).toContain(`"${P.HELP_HEADING_SHARE}"`);
    expect(read(native.androidShare)).toContain(`"${P.HELP_HEADING_SHARE}"`);
    expect(read(native.iosPlan)).toContain(`"${P.BY_ATLAS_CHECK_PAPER}"`);
    expect(read(native.androidPlan)).toContain(`"${P.BY_ATLAS_CHECK_PAPER}"`);
    for (const f of Object.values(native)) expect(read(f)).not.toMatch(/not from (?:your|my|the) paper|checked numbers\)/i);
  });
});
