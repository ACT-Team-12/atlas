import { PhiShield, PhiShieldRefused, dropUnknownFor, unshieldDeep, type DropUnknown } from "./phiShield";
import { SHIELD_HEADER, shieldFields, shieldText, unshieldCarePlan, unshieldExtractEvent, unshieldUnderstand, type ShieldContext } from "./phiResponses";
import type { CarePlanResponse } from "./schema";
import type { ExtractEvent } from "./extractEvents";
import type { UnderstandResponse } from "./understand";
import { OLD_KEY, STORE_KEY } from "./savedPlans";

/**
 * The web page's half of the PHI shield. It wraps the page's fetch (installed once by src/instrumentation-client.ts)
 * so every request that carries paper text to our AI routes is shielded IN THE BROWSER, and every answer gets the
 * real words and offsets back before any component sees it. The page's components call fetch exactly as before.
 *
 * The placeholder map lives in this module's memory for the life of the page: never written to storage, never sent.
 * Names learned from the paper being read, and from the papers already saved on this device (read, never written),
 * are hidden in later requests that carry only care steps (the plan, the meaning check), which have no header to
 * learn a name from.
 *
 * Requests it does not recognize, or cannot parse, go out unchanged; the server's own pass (phiGuard.ts) still
 * shields them before any AI call (and never trusts this page's SHIELD_HEADER to skip it).
 *
 * Fails closed: a request it recognizes but cannot shield in full is not sent at all; the page gets an error answer
 * instead. An answer it cannot map back still gets every known placeholder replaced, and unknown ones removed, so no
 * placeholder reaches a component.
 */

type Restore = (res: Response) => Promise<Response>;
type Shielded = { body: Record<string, unknown>; restore: Restore };

const JSON_ROUTES = new Set(["/api/extract", "/api/plan", "/api/prep", "/api/meaning", "/api/results", "/api/understand"]);
const STREAM_ROUTE = "/api/extract/stream";

/** Same status and headers, new JSON body (length and encoding headers dropped: the body changed). */
function jsonResponse(res: Response, value: unknown): Response {
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(JSON.stringify(value), { status: res.status, statusText: res.statusText, headers });
}

/** Real words back into every string of an answer; placeholders nobody can put back are removed. */
type Clean = (v: unknown) => unknown;

const mapJson = (fn: (v: unknown) => unknown, clean: Clean): Restore => async (res) => {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return res;
  let value: unknown;
  try {
    value = await res.clone().json();
  } catch {
    return res;
  }
  if (!res.ok) return jsonResponse(res, clean(value));
  try {
    return jsonResponse(res, fn(value));
  } catch {
    // An answer of an unexpected shape: its offsets cannot be mapped, but every string still gets the real words back.
    return jsonResponse(res, clean(value));
  }
};

/** The NDJSON read, line by line: each event gets the real words back as it arrives. */
function mapStream(ctx: ShieldContext | null, tokens: ReadonlyMap<string, string>, drop: DropUnknown, onPlan: (plan: CarePlanResponse) => void): Restore {
  const clean: Clean = (v) => unshieldDeep(v, tokens, drop);
  return async (res) => {
    if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) return mapJson(clean, clean)(res);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    const line = (l: string) => {
      if (!l.trim()) return l;
      let parsed: unknown;
      try {
        parsed = JSON.parse(l);
      } catch {
        return l; // a garbled line stays garbled: the page's reader reports it as a broken stream, as before
      }
      try {
        const e = unshieldExtractEvent(parsed as ExtractEvent, ctx, tokens, drop);
        if (e.type === "done") onPlan(e.plan);
        return JSON.stringify(e);
      } catch {
        return JSON.stringify(clean(parsed)); // an event of an unexpected shape: still no placeholder reaches the page
      }
    };
    const body = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          let nl: number;
          while ((nl = pending.indexOf("\n")) >= 0) {
            controller.enqueue(encoder.encode(line(pending.slice(0, nl)) + "\n"));
            pending = pending.slice(nl + 1);
          }
        },
        flush(controller) {
          pending += decoder.decode();
          if (pending) controller.enqueue(encoder.encode(line(pending)));
        },
      }),
    );
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  };
}

/** Shields one request body for its route, or returns null to send it unchanged. */
export function shieldRequest(path: string, body: Record<string, unknown>, session: PhiShield): Shielded | null {
  const tokens = session.tokens;
  const drop = dropUnknownFor(session);
  const clean: Clean = (v) => unshieldDeep(v, tokens, drop);
  if (path === "/api/extract" || path === STREAM_ROUTE) {
    const ctx = typeof body.text === "string" && body.text ? shieldText(session, body.text) : null;
    const next = ctx ? { ...body, text: ctx.result.text } : body;
    // A photo read sends pixels (nothing to shield here), but the AI's transcription comes back: learn the names in it,
    // so the plan and the meaning check built from that read are shielded too.
    const learn = (plan: CarePlanResponse) => { if (!ctx && typeof plan.source_text === "string") session.learn(plan.source_text); };
    if (path === STREAM_ROUTE) return { body: next, restore: mapStream(ctx, tokens, drop, learn) };
    return { body: next, restore: mapJson((v) => { const plan = unshieldCarePlan(v as CarePlanResponse, ctx, tokens, drop); learn(plan); return plan; }, clean) };
  }
  if (path === "/api/prep" || path === "/api/results") {
    if (typeof body.text !== "string") return null;
    const ctx = shieldText(session, body.text);
    return { body: { ...body, text: ctx.result.text }, restore: mapJson(clean, clean) };
  }
  if (path === "/api/understand") {
    if (typeof body.source_text !== "string" || !Array.isArray(body.items)) return null;
    const ctx = shieldText(session, body.source_text);
    const items = (body.items as Record<string, unknown>[]).map((it) => shieldFields(session, it, ["title", "source_quote"]));
    return { body: { ...body, source_text: ctx.result.text, items }, restore: mapJson((v) => unshieldUnderstand(v as UnderstandResponse, ctx, tokens, drop), clean) };
  }
  if (path === "/api/meaning") {
    if (!Array.isArray(body.items)) return null;
    const items = (body.items as Record<string, unknown>[]).map((it) => shieldFields(session, it, ["source_quote", "plain_language", "when"]));
    return { body: { ...body, items }, restore: mapJson(clean, clean) };
  }
  if (path === "/api/plan") {
    const care = Array.isArray(body.care) ? (body.care as Record<string, unknown>[]).map((c) => shieldFields(session, c, ["title", "plain_language", "when", "source_quote"])) : body.care;
    const note = typeof body.note === "string" ? session.shield(body.note).text : body.note;
    // The plan's text is NOT unshielded: what the voice and the call say must only ever be what the AI wrote from
    // shielded text (phiGuard.ts guardPlan), and its read-aloud signature covers exactly that text.
    return { body: { ...body, care, note }, restore: async (res) => res };
  }
  return null;
}

/** The papers already saved on this device, read (never written) so their names are hidden in later requests too. */
export function savedPapers(storage: Pick<Storage, "getItem"> | null): string[] {
  const out: string[] = [];
  if (!storage) return out;
  for (const key of [STORE_KEY, OLD_KEY]) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    if (!raw) continue;
    try {
      const v = JSON.parse(raw) as { plans?: { text?: unknown; care?: { source_text?: unknown } | null }[]; text?: unknown; care?: { source_text?: unknown } | null };
      for (const p of [...(v.plans ?? []), v]) {
        if (typeof p?.text === "string" && p.text) out.push(p.text);
        if (typeof p?.care?.source_text === "string" && p.care.source_text) out.push(p.care.source_text);
      }
    } catch {
      // a damaged store teaches nothing; the server's pass still runs
    }
  }
  return out;
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
};

/** Where a fetch goes, as a same-origin path, or null when it is not one of ours. */
function pathOf(input: RequestInfo | URL, origin: string): string | null {
  try {
    const url = typeof input === "string" ? new URL(input, origin) : input instanceof URL ? input : null;
    return url && url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * A fetch that shields AI requests and unshields their answers. `seed` returns papers to learn names from before each
 * request (the device's saved papers). Exported for tests; the page uses installShieldedFetch.
 */
export function createShieldedFetch(base: typeof fetch, origin: string, seed: () => string[] = () => []): typeof fetch {
  const session = new PhiShield();
  const learned = new Set<string>();
  return async (input, init) => {
    const path = pathOf(input, origin);
    const method = (init?.method ?? "GET").toUpperCase();
    if (!path || (path !== STREAM_ROUTE && !JSON_ROUTES.has(path)) || method !== "POST" || typeof init?.body !== "string") return base(input, init);
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return base(input, init);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return base(input, init);
    let shielded: Shielded | null;
    try {
      for (const paper of seed()) {
        const h = hash(paper);
        if (!learned.has(h)) { learned.add(h); session.learn(paper); }
      }
      shielded = shieldRequest(path, body as Record<string, unknown>, session);
    } catch (e) {
      // Fails closed: a request that cannot be shielded in full is never sent.
      const error = e instanceof PhiShieldRefused ? e.message : "This page could not hide the patient's details in this request, so it was not sent.";
      return new Response(JSON.stringify({ error }), { status: 413, headers: { "content-type": "application/json" } });
    }
    if (!shielded) return base(input, init);
    const headers = new Headers(init.headers);
    headers.set(SHIELD_HEADER, "1");
    const res = await base(input, { ...init, headers, body: JSON.stringify(shielded.body) });
    return shielded.restore(res);
  };
}

const INSTALLED = Symbol.for("atlas.phiShield");

/** Wraps window.fetch once. Safe to call twice. */
export function installShieldedFetch(win: Window & typeof globalThis): void {
  const w = win as unknown as Record<symbol, boolean>;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;
  const base = win.fetch.bind(win);
  const storage = (() => {
    try {
      return win.localStorage;
    } catch {
      return null;
    }
  })();
  win.fetch = createShieldedFetch(base, win.location.origin, () => savedPapers(storage));
}
