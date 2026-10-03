import { PREPARING_MAX_MS } from "./store";
import type { VerifyOutcome } from "./flow";

const REFUSED: Record<string, [number, string]> = {
  expired: [410, "That code expired or used its 3 tries. Ask for a new call."],
  token: [403, "This plan can't be read on a call any more. Make the plan again, then try."],
  "capped-plan": [429, "This number already got 3 plan calls today. Try again tomorrow."],
  "capped-site": [429, "ATLAS has made all of today's calls. Try again tomorrow."],
  "no-db": [503, "Calls are not available right now. Try again in a minute."],
  failed: [502, "The plan call could not be placed. Try again."],
};

/** At most this long after a wipe could not be written: read-time refusal plus the 5-minute sweep cron. */
const PENDING_MINUTES = Math.round(PREPARING_MAX_MS / 60_000) + 5;

/**
 * What the verify step tells the person when it refuses. It says the number and plan were deleted only when that
 * write was confirmed; otherwise it says plainly that deletion could not be confirmed and when it will happen.
 */
export function verifyRefusal(r: Exclude<VerifyOutcome, { state: "calling" } | { state: "wrong" }>): [number, string] {
  const [status, base] = REFUSED[r.state];
  if (!("cleanup" in r)) return [status, base];
  return [status, r.cleanup === "done"
    ? `${base} Your number and plan were deleted.`
    : `${base} We couldn't confirm that your number and plan were deleted; they will be removed automatically within ${PENDING_MINUTES} minutes.`];
}
