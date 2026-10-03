import { SESSION_TTL_MS } from "./store";
import type { StartOutcome, VerifyOutcome } from "./flow";

/**
 * Before a code proves the person holds the phone, every refusal that depends on the NUMBER's history (a live code,
 * a recent code call, its daily code or plan calls) gets one and the same answer, so typing someone else's number
 * cannot tell whether that number used ATLAS recently. Refusals about the plan, the caller or the site stay specific.
 */
const NUMBER_BUSY: [number, string] = [429, "ATLAS can't call this number right now. If it is your number and you already got a code, type it below; otherwise try again later, or use Read it out loud or Print."];
const START_REFUSED: Record<Exclude<StartOutcome["state"], "calling">, [number, string]> = {
  "no-consent": [400, "Tick the box to say ATLAS may call this number."],
  language: [422, "Phone calls aren't available in this language yet. Use Read it out loud or Print instead."],
  token: [403, "This plan can't be read on a call. Make the plan again, then try."],
  "token-used": [403, "This plan already called a different number. To call another number, make the plan again."],
  phone: [400, "Enter a US phone number (10 digits). Toll-free, premium and non-US numbers can't be called."],
  "in-flight": NUMBER_BUSY,
  "too-soon": NUMBER_BUSY,
  "capped-code": NUMBER_BUSY,
  "capped-plan": NUMBER_BUSY,
  "capped-caller": [429, "Too many calls were started from here today. Try again tomorrow."],
  "capped-site": [429, "ATLAS has made as many calls as it can for now. Try again later."],
  "no-db": [503, "Calls are not available right now. Nothing was saved and no call was placed."],
  failed: [502, "The code call could not be placed. Check the number and try again."],
};
export const startRefusal = (state: Exclude<StartOutcome["state"], "calling">): [number, string] => START_REFUSED[state];

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
