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

  it("says a call end Vonage cannot confirm yet is re-checked by the 5-minute cleanup, not left to the 30-minute limit (#54)", () => {
    expect(text).toMatch(/The cleanup runs every 5 minutes\./);
    expect(text).toMatch(/cleanup asks Vonage again each time it runs and deletes them as soon as Vonage confirms the call has ended/);
  });

  it("agrees with the retention paragraph on the same page", () => {
    expect(text).toMatch(/An hourly cleanup deletes any count older than two days, and every use of Say your answer also deletes counts that have expired/);
  });
});

/** Ask my paper sends a new thing (the question) to the AI; the page must say so, and match what /api/ask keeps. */
describe("privacy page: asking your paper a question", () => {
  const text = renderToStaticMarkup(<PrivacyPage />).replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
  const section = text.slice(text.indexOf("Asking your paper a question"), text.indexOf("Saying your answer out loud"));

  it("names what is sent, to whom, and that neither is saved", () => {
    expect(section).toMatch(/your question and the text of your paper go to our server and to Anthropic/);
    expect(section).toMatch(/We do not save your question or your paper/);
  });

  it("describes the daily count as the day and the count only, and that emergency questions are never sent", () => {
    expect(section).toMatch(/only the day and the count, nothing about you/);
    expect(section).toMatch(/A question our own check recognizes as an emergency \(for example chest pain or trouble breathing\) is never sent/);
  });
});
