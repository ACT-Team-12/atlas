import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/ui/Nav", () => ({ Nav: () => null }));
vi.mock("@/ui/Footer", () => ({ Footer: () => null }));
import PrivacyPage from "./page";

/** The deletion answer must match what the code keeps: keyed speech-usage counters exist (review finding, 2026-10-03). */
describe("privacy page: questions or deletion", () => {
  const text = renderToStaticMarkup(<PrivacyPage />).replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
  const section = text.slice(text.indexOf("Questions or deletion"));

  it("no longer claims there is nothing on our side to delete", () => {
    expect(text).not.toMatch(/nothing on our side to delete/i);
  });

  it("names the one per-visitor thing kept, how it is keyed, and when it is deleted", () => {
    expect(section).toMatch(/do not keep your paper or your plan/);
    expect(section).toMatch(/only thing we keep about each visitor for Say your answer is the usage counter/);
    expect(section).toMatch(/keyed hash, never the network address/);
    expect(section).toMatch(/deleted automatically once it is two days old/);
    expect(section).toMatch(/hourly cleanup deletes it, and every use of Say your answer also deletes counts that have expired/);
    expect(section).toMatch(/ask the ATL Innovation Cup organizers to reach Team 12/);
  });

  it("agrees with the retention paragraph on the same page", () => {
    expect(text).toMatch(/An hourly cleanup deletes any count older than two days, and every use of Say your answer also deletes counts that have expired/);
  });
});
