import { describe, expect, it } from "vitest";
import { line } from "./CallMe";

/** What the call panel says once a plan call is over (lib/call/flow.ts publicStatus feeds it). */
describe("CallMe status line after a plan call", () => {
  it("says plainly when ATLAS cannot confirm the plan was read, why, and that a new call can be asked for", () => {
    const s = line({ phase: "done", plan_status: "completed", gate_passed: false }, "2368", "4821");
    expect(s).toContain("ATLAS could not confirm your plan was read");
    expect(s).toContain("it plays only after the 4-digit code is entered on the phone keypad");
    expect(s).toContain("Your number and plan text were deleted.");
    expect(s).toContain("You can ask for a new call below.");
    expect(s).not.toContain("Call finished");
    // false also covers wrong codes and a record that failed to save: never claim the code was not entered, and never
    // promise a new call works after a wait (the daily caps may say no).
    expect(s).not.toMatch(/before the code was entered|was not read|10 minutes/);
  });

  it("keeps the finished wording when the plan played, or when the server does not say", () => {
    expect(line({ phase: "done", plan_status: "completed", gate_passed: true }, "2368", "")).toBe("Call finished. Your number and plan text were deleted.");
    expect(line({ phase: "done", plan_status: "completed" }, "2368", "")).toBe("Call finished. Your number and plan text were deleted.");
    expect(line({ phase: "done", plan_status: "completed", gate_passed: null }, "2368", "")).toBe("Call finished. Your number and plan text were deleted.");
  });

  it("a missed call still says no one answered, whatever gate_passed says", () => {
    expect(line({ phase: "done", plan_status: "unanswered", gate_passed: false }, "2368", "")).toBe("No one answered at ...2368. Your number and plan text were deleted.");
  });
});
