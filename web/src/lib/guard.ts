/**
 * Abuse guard for the AI endpoints. Two cheap layers:
 * 1. Same-site check: browsers send Origin on fetch POSTs; requests from other sites are refused.
 * 2. Per-IP sliding window, kept in this server instance's memory. It is best effort (each serverless
 *    instance keeps its own count), which is enough to stop a casual script from draining the AI budget.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.ATLAS_RATE_LIMIT ?? 30);
const hits = new Map<string, number[]>();

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

export function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin navigations and server-to-server tools omit it; the rate limit still applies
  try {
    const host = new URL(origin).host;
    const self = req.headers.get("host");
    return host === self || host.endsWith(".vercel.app") || host.startsWith("localhost") || host.startsWith("127.0.0.1");
  } catch {
    return false;
  }
}

export function rateLimit(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return { ok: true, retryAfterSec: 0 };
}

/** Returns a Response to send back if the request should be refused, else null. */
export function guard(req: Request, bucket: string): Response | null {
  if (!allowedOrigin(req)) return Response.json({ error: "Requests are only accepted from the ATLAS site." }, { status: 403 });
  const r = rateLimit(`${bucket}:${clientIp(req)}`);
  if (!r.ok) {
    return Response.json(
      { error: `You've made a lot of requests. Try again in about ${Math.ceil(r.retryAfterSec / 60)} minutes.` },
      { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
    );
  }
  return null;
}
