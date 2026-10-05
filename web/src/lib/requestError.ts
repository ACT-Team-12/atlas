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
 * The fixed line (lib/uiText.ts) to show for a failed request: reading a paper or photo ("read"), building a plan
 * ("plan"), or any other tool (lab results, prep, quiz, feedback: "other"). Anything that is not a
 * RequestFailed (a reply we could not parse, a stream that ended badly) is our side's fault.
 */
export function failureKey(e: unknown, what: "read" | "plan" | "other"): UiKey {
  if (!(e instanceof RequestFailed)) return "error.server";
  const s = e.status;
  if (s === 0) return "error.network";
  if (s === 429) return "error.busy";
  if (s === 503) return "error.unavailable";
  if (s === 422) return what === "read" ? "error.cantRead" : what === "plan" ? "error.cantPlan" : "error.declined";
  if (s === 400 && what === "plan") return "error.planNeeds";
  if (s >= 400 && s < 500) return "error.badRequest";
  return "error.server";
}

/**
 * POST JSON to one of our routes and return its JSON body. Throws RequestFailed for no connection (0), an error status
 * (with the server's English kept as the message, for logging), or a reply that is not JSON. An abort is rethrown as is.
 */
export async function postJson<T>(url: string, body: unknown, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...init.headers }, body: JSON.stringify(body), signal: init.signal });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new RequestFailed(0, "Network error");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new RequestFailed(res.status, (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  if (json === null) throw new RequestFailed(502, "Reply was not JSON");
  return json as T;
}

/** Logs a failed request with the server's own words, for the team; the screen shows failureKey's line instead. */
export function logFailure(what: string, e: unknown): void {
  console.error(`${what} failed`, e instanceof RequestFailed ? e.status : "", e instanceof Error ? e.message : e);
}
