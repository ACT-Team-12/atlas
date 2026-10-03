import { SESSION_TTL_MS } from "./store";
import type { VerifyOutcome } from "./flow";

const REFUSED: Record<string, [number, string]> = {
  expired: [410, "That code expired or used its 3 tries. Ask for a new call."],
  token: [403, "This plan can't be read on a call any more. Make the plan again, then try."],
  "capped-plan": [429, "This number already got 3 plan calls today. Try again tomorrow."],
  "capped-site": [429, "ATLAS has made all of today's calls. Try again tomorrow."],
  "no-db": [503, "Calls are not available right now. Try again in a minute."],
  failed: [502, "The plan call could not be placed. Try again."],
};

/**
 * What the verify step tells the person when it refuses. It says the number and plan were deleted only when that
 * write was confirmed; otherwise it says plainly that deletion could not be confirmed. It promises no deletion time
 * (an outage can delay deletion), only the read limit the encryption itself enforces (lib/call/seal.ts).
 */
export function verifyRefusal(r: Exclude<VerifyOutcome, { state: "calling" } | { state: "wrong" }>): [number, string] {
  const [status, base] = REFUSED[r.state];
  if (!("cleanup" in r)) return [status, base];
  return [status, r.cleanup === "done"
    ? `${base} Your number and plan were deleted.`
    : `${base} We couldn't confirm that your number and plan are gone yet; we'll delete them automatically. They can't be opened after ${SESSION_TTL_MS / 60_000} minutes, even if our database is down, and are deleted once it is back.`];
}
