import { randomUUID, sign } from "node:crypto";
import type { NccoAction } from "./ncco";

/**
 * Vonage Voice API, called directly (no SDK): an RS256 application JWT and POST /v1/calls with an inline NCCO.
 * Ported from a call flow already running in production for the same developer.
 */
const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function vonageJwt(applicationId: string, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ application_id: applicationId, iat, exp: iat + 300, jti: randomUUID() }));
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKeyPem);
  return `${head}.${body}.${b64u(sig)}`;
}

/**
 * `unknown: true` means Vonage may have created the call anyway (a timeout, a dropped connection, a 5xx, or a success
 * without a readable uuid): the caller must not treat it as "no call" (no retry, no wipe while the phone may ring).
 * `unknown: false` is a definite refusal (the JWT could not be signed, or a 4xx).
 */
export type PlaceResult = { ok: true; uuid: string } | { ok: false; error: string; unknown: boolean };

export type PlaceOptions = {
  applicationId: string;
  privateKey: string;
  to: string;
  from: string;
  ncco: NccoAction[];
  eventUrl: string;
  /** Hard stop for the whole call in seconds; it bounds what one call can cost. */
  lengthTimer: number;
};

/** Places one outbound call. Never throws; gives up after `timeoutMs` even if the fetch ignores its abort signal. */
export async function placeCall(o: PlaceOptions, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<PlaceResult> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PlaceResult>((ok) => {
    timer = setTimeout(() => { ctl.abort(); ok({ ok: false, error: `Vonage did not answer in ${timeoutMs} ms`, unknown: true }); }, timeoutMs);
  });
  const attempt = (async (): Promise<PlaceResult> => {
    let jwt: string;
    try {
      jwt = vonageJwt(o.applicationId, o.privateKey);
    } catch (e) {
      return { ok: false, error: `could not sign the Vonage JWT: ${(e as Error).name}`, unknown: false };
    }
    const res = await fetchImpl("https://api.nexmo.com/v1/calls", {
      method: "POST",
      signal: ctl.signal,
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        to: [{ type: "phone", number: o.to.replace(/^\+/, "") }],
        from: { type: "phone", number: o.from.replace(/^\+/, "") },
        ncco: o.ncco,
        event_url: [o.eventUrl],
        event_method: "POST",
        ringing_timer: 45,
        length_timer: Math.max(30, Math.min(900, Math.round(o.lengthTimer))),
      }),
    });
    const text = await res.text();
    // Status only: an error body could echo the request, and this string reaches the logs.
    if (!res.ok) return { ok: false, error: `Vonage HTTP ${res.status}`, unknown: res.status >= 500 };
    try {
      const j = JSON.parse(text) as { uuid?: unknown };
      return typeof j.uuid === "string" ? { ok: true, uuid: j.uuid } : { ok: false, error: "Vonage answered without a call uuid", unknown: true };
    } catch {
      return { ok: false, error: "Vonage answered with a body that was not JSON", unknown: true };
    }
  })().catch((e: unknown) => ({ ok: false as const, error: `Vonage request failed: ${(e as Error).name}`, unknown: true }));
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type CallTruth = { ok: true; status: string; to: string | null; direction: string | null } | { ok: false; error: string };

/**
 * GET /v1/calls/{uuid}: what Vonage itself says about one of our calls. The callback routes act on THIS, never on the
 * status a callback body claims, so a replayed or forged callback cannot end a live call or unlock the plan text.
 * Never throws; gives up after `timeoutMs`.
 */
export async function getCall(o: { applicationId: string; privateKey: string; uuid: string }, fetchImpl: typeof fetch = fetch, timeoutMs = 4_000): Promise<CallTruth> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(o.uuid)) return { ok: false, error: "not a call uuid" };
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CallTruth>((ok) => {
    timer = setTimeout(() => { ctl.abort(); ok({ ok: false, error: `Vonage did not answer in ${timeoutMs} ms` }); }, timeoutMs);
  });
  const attempt = (async (): Promise<CallTruth> => {
    const res = await fetchImpl(`https://api.nexmo.com/v1/calls/${encodeURIComponent(o.uuid)}`, {
      method: "GET", signal: ctl.signal, headers: { authorization: `Bearer ${vonageJwt(o.applicationId, o.privateKey)}` },
    });
    if (!res.ok) return { ok: false, error: `Vonage HTTP ${res.status}` };
    const j = (await res.json()) as { uuid?: unknown; status?: unknown; direction?: unknown; to?: { number?: unknown } };
    if (j.uuid !== o.uuid || typeof j.status !== "string") return { ok: false, error: "Vonage call detail did not match" };
    return { ok: true, status: j.status, to: typeof j.to?.number === "string" ? j.to.number : null, direction: typeof j.direction === "string" ? j.direction : null };
  })().catch((e: unknown) => ({ ok: false as const, error: `Vonage request failed: ${(e as Error).name}` }));
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
