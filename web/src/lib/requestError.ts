import type { UiKey } from "./uiText";

/**
 * A request to one of our own routes that failed. `status` is the HTTP status, or 0 when the server was never reached
 * (no connection). `message` is the server's own words, which are English and fixed per route: kept for the console
 * and logs only, never shown (Codex review of PR 93, round 4). The person sees `failureKey` in their language.
 */
export class RequestFailed extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "RequestFailed";
  }
}

/**
 * The fixed line (lib/uiText.ts) to show for a failed read of the paper or a failed plan. Anything that is not a
 * RequestFailed (a reply we could not parse, a stream that ended badly) is our side's fault.
 */
export function failureKey(e: unknown, what: "read" | "plan"): UiKey {
  if (!(e instanceof RequestFailed)) return "error.server";
  const s = e.status;
  if (s === 0) return "error.network";
  if (s === 429) return "error.busy";
  if (s === 503) return "error.unavailable";
  if (s === 422) return what === "read" ? "error.cantRead" : "error.cantPlan";
  if (s === 400 && what === "plan") return "error.planNeeds";
  if (s >= 400 && s < 500) return "error.badRequest";
  return "error.server";
}
