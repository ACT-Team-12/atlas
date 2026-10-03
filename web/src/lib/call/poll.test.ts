import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_POLL_FAILURES, nextPoll, pollDelayMs, pollNotice, POLL_WINDOW_MS, startPoll, STATUS_LOST, type PollState } from "./poll";
import { CODE_TTL_MS, PLAN_CALL_MAX_MS, SESSION_TTL_MS } from "./store";

const T0 = Date.UTC(2026, 9, 3, 15, 0, 0);
const run = (outcomes: ("ok" | "fail")[], from: PollState = startPoll(T0), now = T0) => outcomes.reduce((s, o) => nextPoll(s, o, now), from);

/** Follows the loop the way the panel does: wait the delay on the (fake) clock, poll, repeat, until it stops or `untilMs`. */
function follow(untilMs: number, outcome: (s: PollState) => "ok" | "fail" = () => "ok") {
  let s = startPoll(Date.now());
  while (!s.stopped && Date.now() - s.startedAt < untilMs) {
    vi.advanceTimersByTime(pollDelayMs(s));
    s = nextPoll(s, outcome(s), Date.now());
  }
  return s;
}

describe("following a call's status", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps going after a failed poll, shows that status is unavailable, and recovers on the next success", () => {
    const failed = run(["ok", "fail"]);
    expect(failed).toMatchObject({ trouble: true, stopped: false, failures: 1 });
    expect(pollDelayMs(failed)).toBeGreaterThan(pollDelayMs(startPoll(T0))); // backs off
    expect(run(["fail", "ok"])).toMatchObject({ trouble: false, failures: 0, stopped: false });
    expect(pollNotice(failed)).toBe("Call status is unavailable right now. Still trying...");
    expect(pollNotice(run(["ok"]))).toBeNull();
  });

  it("stops after many failures in a row, and says so", () => {
    const gaveUp = run(Array(MAX_POLL_FAILURES).fill("fail"));
    expect(gaveUp).toMatchObject({ stopped: true, trouble: true, timedOut: false });
    expect(run(Array(MAX_POLL_FAILURES - 1).fill("fail"))).toMatchObject({ stopped: false });
    expect(pollNotice(gaveUp)).toMatch(/can't get this call's status right now/);
    expect(pollDelayMs(run(Array(10).fill("fail")))).toBeLessThanOrEqual(15_000);
  });

  it("keeps following a long call past 6 minutes (the old 120-poll cap), polled at the normal pace", () => {
    const s = follow(20 * 60_000);
    expect(Date.now() - T0).toBeGreaterThanOrEqual(20 * 60_000);
    expect(s.polls).toBeGreaterThan(120);
    expect(s).toMatchObject({ stopped: false, timedOut: false, trouble: false });
    expect(pollNotice(s)).toBeNull();
  });

  it("is bounded by time: reaching the bound stops the loop and sets the visible unknown state", () => {
    const s = follow(Infinity);
    expect(s).toMatchObject({ stopped: true, timedOut: true });
    expect(Date.now() - T0).toBeGreaterThanOrEqual(POLL_WINDOW_MS);
    expect(Date.now() - T0).toBeLessThan(POLL_WINDOW_MS + 15_000); // within one poll of the bound
    expect(pollNotice(s)).toBe(STATUS_LOST);
    expect(STATUS_LOST).toBe("We can't see this call's status any more. If it is still going, you can keep listening; your number and plan are deleted when it ends.");
    // Even a loop that was in trouble when time ran out says the unknown state, not the failure line.
    const late = nextPoll(run(["fail"]), "fail", T0 + POLL_WINDOW_MS);
    expect(pollNotice(late)).toBe(STATUS_LOST);
  });

  it("a backgrounded tab whose timers ran late still lands on the unknown state at its next tick", () => {
    const s = nextPoll(run(["ok", "ok"]), "ok", T0 + POLL_WINDOW_MS + 5 * 60_000);
    expect(s).toMatchObject({ stopped: true, timedOut: true });
  });

  it("the time bound covers the longest code call plus plan call, and ends before the session row does", () => {
    expect(POLL_WINDOW_MS).toBeGreaterThanOrEqual(CODE_TTL_MS + PLAN_CALL_MAX_MS);
    expect(POLL_WINDOW_MS).toBeLessThan(SESSION_TTL_MS);
  });
});
