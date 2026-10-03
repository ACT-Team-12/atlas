/**
 * How the call panel follows a call's status (/api/call/status). A failed poll (network error, 503 while the database
 * is down) never stops the loop: it marks the status as unavailable, backs off, and the next success clears it. The
 * loop is bounded both ways: MAX_POLL_FAILURES failures in a row, or POLL_WINDOW_MS of wall-clock time since the
 * call started, stop it. Time, not a poll count, so a long plan call is followed to its end however the polls were
 * paced; and when the time bound is reached first, `timedOut` makes the panel say so instead of going quiet.
 */
export type PollState = { startedAt: number; polls: number; failures: number; trouble: boolean; stopped: boolean; timedOut: boolean };

/**
 * Longer than the longest call the panel can be following: a code stays typeable for 10 minutes (CODE_TTL_MS) and a
 * plan call is wiped at the latest 17 minutes after it was placed (PLAN_CALL_MAX_MS), plus a minute of margin.
 * Still under the 30-minute life of the session row. poll.test.ts checks these against lib/call/store.ts.
 */
export const POLL_WINDOW_MS = (10 + 17 + 1) * 60_000;
export const MAX_POLL_FAILURES = 20;
const BASE_MS = 3000;
const MAX_DELAY_MS = 15_000;

/** A fresh loop, timed from now (when the code call or the plan call was asked for). */
export const startPoll = (now: number): PollState => ({ startedAt: now, polls: 0, failures: 0, trouble: false, stopped: false, timedOut: false });

export function nextPoll(s: PollState, outcome: "ok" | "fail", now: number): PollState {
  const polls = s.polls + 1;
  const failures = outcome === "ok" ? 0 : s.failures + 1;
  const timedOut = s.timedOut || now - s.startedAt >= POLL_WINDOW_MS;
  return { startedAt: s.startedAt, polls, failures, trouble: failures > 0, timedOut, stopped: s.stopped || timedOut || failures >= MAX_POLL_FAILURES };
}

/** 3 seconds normally; after failures, doubling up to 15 seconds. */
export const pollDelayMs = (s: PollState) => Math.min(MAX_DELAY_MS, BASE_MS * 2 ** Math.min(s.failures, 3));

export const STATUS_LOST = "We can't see this call's status any more. If it is still going, you can keep listening; your number and plan are deleted when it ends.";

/**
 * The line the panel shows under a live call's status, or null for none: the time bound reached (STATUS_LOST), polling
 * given up after failures in a row, or a poll that just failed.
 */
export function pollNotice(s: PollState): string | null {
  if (s.timedOut) return STATUS_LOST;
  if (!s.trouble) return null;
  return s.stopped ? "We can't get this call's status right now. If your phone rings, pick up." : "Call status is unavailable right now. Still trying...";
}
