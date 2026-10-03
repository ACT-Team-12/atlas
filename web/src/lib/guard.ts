/**
 * Abuse guard for the AI endpoints (they call a paid model).
 *
 * - Rate limit (the real protection): a per-IP sliding window kept in this server instance's memory. Best effort,
 *   since each serverless instance keeps its own counts, but it stops a casual script from draining the budget.
 *   The IP comes from x-real-ip, which Vercel sets itself; a client-supplied x-forwarded-for is not trusted.
 * - Origin check (defense in depth only): browsers on other sites are refused. A script can fake this header, so it
 *   is not a security boundary; that is why the rate limit applies to every request either way.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.ATLAS_RATE_LIMIT ?? 30);
const MAX_KEYS = 5000;
const hits = new Map<string, number[]>();

// Our production host and our own Vercel preview URLs (atlas-team12-<hash>-<team>.vercel.app).
const OWN_HOST = /^atlas-team12(-[a-z0-9-]+)?\.vercel\.app$/;

export function clientIp(req: Request) {
  return (req.headers.get("x-real-ip") ?? "unknown").trim();
}

export function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.get("host") || OWN_HOST.test(host) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  } catch {
    return false;
  }
}

export function rateLimit(key: string, now = Date.now(), max = MAX_PER_WINDOW): { ok: boolean; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent); // re-insert so Map order is least-recently-used first
  while (hits.size > MAX_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest === undefined) break;
    hits.delete(oldest); // evict the stalest key only; never reset everyone's limits
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Returns a Response to send back if the request should be refused, else null.
 * `max` raises the window for routes polled by the page or called back by a phone carrier (the call status and
 * Vonage webhooks); every other route keeps the default.
 */
export function guard(req: Request, bucket: string, max?: number): Response | null {
  if (!allowedOrigin(req)) return Response.json({ error: "Requests are only accepted from the ATLAS site." }, { status: 403 });
  const r = rateLimit(`${bucket}:${clientIp(req)}`, Date.now(), max);
  if (!r.ok) {
    return Response.json(
      { error: `You've made a lot of requests. Try again in about ${Math.ceil(r.retryAfterSec / 60)} minutes.` },
      { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
    );
  }
  return null;
}
