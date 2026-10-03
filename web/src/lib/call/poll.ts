/**
 * How the call panel follows a call's status (/api/call/status). A failed poll (network error, 503 while the database
 * is down) never stops the loop: it marks the status as unavailable, backs off, and the next success clears it. The
 * loop is bounded both ways: MAX_POLL_FAILURES failures in a row, or MAX_POLLS polls in all, stop it.
 */
export type PollState = { polls: number; failures: number; trouble: boolean; stopped: boolean };
export const START_POLL: PollState = { polls: 0, failures: 0, trouble: false, stopped: false };
/** About 6 minutes of polling at the normal pace. */
export const MAX_POLLS = 120;
export const MAX_POLL_FAILURES = 20;
const BASE_MS = 3000;
const MAX_DELAY_MS = 15_000;

export function nextPoll(s: PollState, outcome: "ok" | "fail"): PollState {
  const polls = s.polls + 1;
  const failures = outcome === "ok" ? 0 : s.failures + 1;
  return { polls, failures, trouble: failures > 0, stopped: s.stopped || polls >= MAX_POLLS || failures >= MAX_POLL_FAILURES };
}

/** 3 seconds normally; after failures, doubling up to 15 seconds. */
export const pollDelayMs = (s: PollState) => Math.min(MAX_DELAY_MS, BASE_MS * 2 ** Math.min(s.failures, 3));
