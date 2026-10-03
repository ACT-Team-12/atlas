import { describe, expect, it } from "vitest";
import { MAX_POLL_FAILURES, MAX_POLLS, nextPoll, pollDelayMs, START_POLL, type PollState } from "./poll";

const run = (outcomes: ("ok" | "fail")[], from: PollState = START_POLL) => outcomes.reduce(nextPoll, from);

describe("following a call's status", () => {
  it("keeps going after a failed poll, shows that status is unavailable, and recovers on the next success", () => {
    const failed = run(["ok", "fail"]);
    expect(failed).toMatchObject({ trouble: true, stopped: false, failures: 1 });
    expect(pollDelayMs(failed)).toBeGreaterThan(pollDelayMs(START_POLL)); // backs off
    expect(run(["fail", "ok"], START_POLL)).toMatchObject({ trouble: false, failures: 0, stopped: false });
  });
  it("is bounded: it stops after many failures in a row, or after enough polls overall", () => {
    expect(run(Array(MAX_POLL_FAILURES).fill("fail"))).toMatchObject({ stopped: true, trouble: true });
    expect(run(Array(MAX_POLL_FAILURES - 1).fill("fail"))).toMatchObject({ stopped: false });
    expect(run(Array(MAX_POLLS).fill("ok"))).toMatchObject({ stopped: true, trouble: false });
    expect(pollDelayMs(run(Array(10).fill("fail")))).toBeLessThanOrEqual(15_000);
  });
});
