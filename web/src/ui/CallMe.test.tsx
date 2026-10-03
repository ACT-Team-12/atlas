import { describe, expect, it } from "vitest";
import { line } from "./CallMe";

/** What the call panel says once a plan call is over (lib/call/flow.ts publicStatus feeds it). */
describe("CallMe status line after a plan call", () => {
  it("says plainly that the plan was not read when the call ended before the code was entered, and how to start again", () => {
    const s = line({ phase: "done", plan_status: "completed", plan_played: false }, "2368", "4821");
    expect(s).toContain("The call ended before the code was entered, so your plan was not read.");
    expect(s).toContain("Your number and plan text were deleted.");
    expect(s).toContain("You can start a new call");
    expect(s).not.toContain("Call finished");
  });

  it("keeps the finished wording when the plan played, or when the server does not say", () => {
    expect(line({ phase: "done", plan_status: "completed", plan_played: true }, "2368", "")).toBe("Call finished. Your number and plan text were deleted.");
    expect(line({ phase: "done", plan_status: "completed" }, "2368", "")).toBe("Call finished. Your number and plan text were deleted.");
    expect(line({ phase: "done", plan_status: "completed", plan_played: null }, "2368", "")).toBe("Call finished. Your number and plan text were deleted.");
  });

  it("a missed call still says no one answered, whatever plan_played says", () => {
    expect(line({ phase: "done", plan_status: "unanswered", plan_played: false }, "2368", "")).toBe("No one answered at ...2368. Your number and plan text were deleted.");
  });
});
