import { CODE_ATTEMPTS, type CallStore, type NewSession, type Phase, type SessionPatch, type SessionRow } from "./store";

/**
 * An in-memory CallStore with the same rules as PgCallStore (one live code per number, atomic attempts, capped
 * counters). Used by the unit tests of the call flow; the SQL itself is exercised by store.pg.test.ts.
 */
export class MemoryCallStore implements CallStore {
  rows = new Map<string, SessionRow & { sealed_audio: Buffer | null }>();
  counters = new Map<string, number>();
  failNext = false;

  private boom() { if (this.failNext) { this.failNext = false; throw new Error("db down"); } }

  async sweep(now: number) { for (const [k, r] of this.rows) if (r.expires_at.getTime() < now) this.rows.delete(k); }

  async startCode(s: NewSession, now: number) {
    try { this.boom(); } catch { return "error" as const; }
    for (const r of this.rows.values()) {
      if (r.phone_hash !== s.phone_hash || r.phase !== "code") continue;
      if ((r.code_expires_at?.getTime() ?? 0) < now) { r.phase = "expired"; r.code_hash = null; } else return "in-flight" as const;
    }
    this.rows.set(s.id, {
      ...s, phase: "code", attempts: 0, code_status: null, plan_status: null, plan_mode: null, note: null, sealed_audio: null, has_audio: false, created_at: new Date(now),
    });
    return "ok" as const;
  }

  async drop(id: string) { this.rows.delete(id); }

  async get(id: string, now: number) {
    const r = this.rows.get(id);
    if (!r || r.expires_at.getTime() <= now) return null;
    const { sealed_audio, ...row } = r;
    return { ...row, has_audio: sealed_audio !== null };
  }

  async getAudio(id: string, now: number) {
    const r = this.rows.get(id);
    return r && r.expires_at.getTime() > now ? r.sealed_audio : null;
  }

  async takeAttempt(id: string, now: number) {
    const r = this.rows.get(id);
    if (!r || r.phase !== "code" || (r.code_expires_at?.getTime() ?? 0) <= now || r.expires_at.getTime() <= now || r.attempts >= CODE_ATTEMPTS) return null;
    r.attempts += 1;
    const { sealed_audio, ...row } = r;
    return { ...row, has_audio: sealed_audio !== null };
  }

  async update(id: string, patch: SessionPatch, onlyIf?: Phase[]) {
    const r = this.rows.get(id);
    if (!r || (onlyIf?.length && !onlyIf.includes(r.phase))) return false;
    Object.assign(r, patch);
    return true;
  }

  async takeSlot(key: string, cap: number) {
    if (cap <= 0) return false;
    const n = this.counters.get(key) ?? 0;
    if (n >= cap) return false;
    this.counters.set(key, n + 1);
    return true;
  }

  async releaseSlot(key: string) { const n = this.counters.get(key) ?? 0; if (n > 0) this.counters.set(key, n - 1); }

  async counter(key: string) { return this.counters.get(key) ?? 0; }
}
