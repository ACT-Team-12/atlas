import type { Pool } from "pg";
import { getPool } from "../db";

/**
 * Postgres state for "ATLAS calls you" (db/migrations/003_atlas_calls.sql; also created on first use).
 *  - atlas_calls: one row per call session. The number, the plan text, its token and the voice MP3 are stored only
 *    ENCRYPTED (lib/call/seal.ts) and are wiped when the plan call ends; the whole row expires 30 minutes after it
 *    was created. A code (hashed) is live for 10 minutes and allows 3 attempts; one live code per number.
 *  - atlas_call_counters: the per-number and per-site daily caps, keyed by an HMAC of the number, never the number.
 * Every function fails CLOSED: a database error means "no call", never "call anyway".
 */
export const SESSION_TTL_MS = 30 * 60_000;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_ATTEMPTS = 3;
const COUNTER_TTL_MS = 2 * 24 * 60 * 60_000;

export type Phase = "code" | "code_missed" | "expired" | "calling" | "done" | "failed";

export type SessionRow = {
  id: string;
  phone_hash: string;
  last4: string;
  language: string;
  phase: Phase;
  code_hash: string | null;
  attempts: number;
  code_expires_at: Date | null;
  code_status: string | null;
  plan_status: string | null;
  plan_mode: "stream" | "talk" | null;
  note: string | null;
  sealed_phone: Buffer | null;
  sealed_text: Buffer | null;
  sealed_token: Buffer | null;
  /** Whether a voice MP3 is stored. The MP3 itself (a few MB) is read only by getAudio, never by get. */
  has_audio: boolean;
  created_at: Date;
  expires_at: Date;
};

export type NewSession = Pick<SessionRow, "id" | "phone_hash" | "last4" | "language" | "code_hash" | "code_expires_at" | "sealed_phone" | "sealed_text" | "sealed_token" | "expires_at">;
export type SessionPatch = Partial<Pick<SessionRow, "phase" | "code_hash" | "code_status" | "plan_status" | "plan_mode" | "note" | "sealed_phone" | "sealed_text" | "sealed_token">> & { sealed_audio?: Buffer | null };

/** Clears everything sensitive a session holds. Used when a call ends or a session can go no further. */
export const WIPE: SessionPatch = { sealed_phone: null, sealed_text: null, sealed_token: null, sealed_audio: null, code_hash: null };

export interface CallStore {
  /** Deletes expired sessions and counters. */
  sweep(now: number): Promise<void>;
  /** Inserts a session in phase "code", unless this number already has a live code ("in-flight"). */
  startCode(s: NewSession, now: number): Promise<"ok" | "in-flight" | "error">;
  drop(id: string): Promise<void>;
  get(id: string, now: number): Promise<SessionRow | null>;
  /** The sealed voice MP3 of a live session. */
  getAudio(id: string, now: number): Promise<Buffer | null>;
  /** Spends one code attempt atomically; null when there is no live code left to try. */
  takeAttempt(id: string, now: number): Promise<SessionRow | null>;
  /** True when the row was updated (and, with onlyIf, only when its phase was one of those). */
  update(id: string, patch: SessionPatch, onlyIf?: Phase[]): Promise<boolean>;
  /** Takes one slot of a counter capped at `cap`, atomically. */
  takeSlot(key: string, cap: number, now: number): Promise<boolean>;
  releaseSlot(key: string): Promise<void>;
  counter(key: string): Promise<number | null>;
}

export const SCHEMA_SQL = `
create table if not exists atlas_calls (
  id              text primary key,
  phone_hash      text not null,
  last4           text not null check (last4 ~ '^[0-9]{4}$'),
  language        text not null,
  phase           text not null check (phase in ('code', 'code_missed', 'expired', 'calling', 'done', 'failed')),
  code_hash       text,
  attempts        smallint not null default 0,
  code_expires_at timestamptz,
  code_status     text,
  plan_status     text,
  plan_mode       text check (plan_mode in ('stream', 'talk')),
  note            text,
  sealed_phone    bytea,
  sealed_text     bytea,
  sealed_token    bytea,
  sealed_audio    bytea,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
create unique index if not exists atlas_calls_one_code_uq on atlas_calls (phone_hash) where phase = 'code';
create index if not exists atlas_calls_expires_idx on atlas_calls (expires_at);
create table if not exists atlas_call_counters (
  id         text primary key,
  n          integer not null check (n >= 0),
  expires_at timestamptz not null
);
create index if not exists atlas_call_counters_expires_idx on atlas_call_counters (expires_at);
`;

type Q = Pick<Pool, "query">;
const ready = new WeakSet<object>();

/** Creates the tables on first use (idempotent), so the feature needs no manual migration step to go live. */
export async function ensureSchema(db: Q): Promise<boolean> {
  if (ready.has(db)) return true;
  try {
    await db.query(SCHEMA_SQL);
    ready.add(db);
    return true;
  } catch (e) {
    console.error("call schema failed", e instanceof Error ? e.name : typeof e);
    return false;
  }
}

const COLS = "id, phone_hash, last4, language, phase, code_hash, attempts, code_expires_at, code_status, plan_status, plan_mode, note, sealed_phone, sealed_text, sealed_token, (sealed_audio is not null) as has_audio, created_at, expires_at";
const PATCHABLE = new Set(["phase", "code_hash", "code_status", "plan_status", "plan_mode", "note", "sealed_phone", "sealed_text", "sealed_token", "sealed_audio"]);
const logErr = (what: string, e: unknown) => console.error(what, e instanceof Error ? e.name : typeof e); // never values

export class PgCallStore implements CallStore {
  constructor(private readonly db: Q) {}

  async sweep(now: number) {
    try {
      const at = new Date(now);
      await this.db.query("delete from atlas_calls where expires_at < $1", [at]);
      await this.db.query("delete from atlas_call_counters where expires_at < $1", [at]);
    } catch (e) { logErr("call sweep failed", e); }
  }

  async startCode(s: NewSession, now: number) {
    try {
      // A code that ran out of time no longer blocks this number.
      await this.db.query("update atlas_calls set phase = 'expired', code_hash = null where phone_hash = $1 and phase = 'code' and code_expires_at < $2", [s.phone_hash, new Date(now)]);
      await this.db.query(
        `insert into atlas_calls (id, phone_hash, last4, language, phase, code_hash, code_expires_at, sealed_phone, sealed_text, sealed_token, expires_at)
         values ($1, $2, $3, $4, 'code', $5, $6, $7, $8, $9, $10)`,
        [s.id, s.phone_hash, s.last4, s.language, s.code_hash, s.code_expires_at, s.sealed_phone, s.sealed_text, s.sealed_token, s.expires_at],
      );
      return "ok" as const;
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") return "in-flight" as const;
      logErr("call start failed", e);
      return "error" as const;
    }
  }

  async drop(id: string) {
    try { await this.db.query("delete from atlas_calls where id = $1", [id]); } catch (e) { logErr("call drop failed", e); }
  }

  async get(id: string, now: number) {
    try {
      const r = await this.db.query(`select ${COLS} from atlas_calls where id = $1 and expires_at > $2`, [id, new Date(now)]);
      return (r.rows[0] as SessionRow | undefined) ?? null;
    } catch (e) {
      logErr("call get failed", e);
      return null;
    }
  }

  async getAudio(id: string, now: number) {
    try {
      const r = await this.db.query("select sealed_audio from atlas_calls where id = $1 and expires_at > $2", [id, new Date(now)]);
      return (r.rows[0]?.sealed_audio as Buffer | null | undefined) ?? null;
    } catch (e) {
      logErr("call audio failed", e);
      return null;
    }
  }

  async takeAttempt(id: string, now: number) {
    try {
      const r = await this.db.query(
        `update atlas_calls set attempts = attempts + 1
         where id = $1 and phase = 'code' and code_expires_at > $2 and expires_at > $2 and attempts < $3
         returning ${COLS}`,
        [id, new Date(now), CODE_ATTEMPTS],
      );
      return (r.rows[0] as SessionRow | undefined) ?? null;
    } catch (e) {
      logErr("call attempt failed", e);
      return null;
    }
  }

  async update(id: string, patch: SessionPatch, onlyIf?: Phase[]) {
    const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k)) as (keyof SessionPatch)[];
    if (!keys.length) return false;
    const params: unknown[] = [id, ...keys.map((k) => patch[k] ?? null)];
    let sql = `update atlas_calls set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`;
    if (onlyIf?.length) { params.push(onlyIf); sql += ` and phase = any($${params.length}::text[])`; }
    try {
      const r = await this.db.query(sql, params);
      return (r.rowCount ?? 0) === 1;
    } catch (e) {
      logErr("call update failed", e);
      return false;
    }
  }

  async takeSlot(key: string, cap: number, now: number) {
    if (cap <= 0) return false;
    try {
      // The conflict update only applies while n < cap; at the cap no row is returned.
      const r = await this.db.query(
        `insert into atlas_call_counters (id, n, expires_at) values ($1, 1, $3)
         on conflict (id) do update set n = atlas_call_counters.n + 1 where atlas_call_counters.n < $2
         returning n`,
        [key, cap, new Date(now + COUNTER_TTL_MS)],
      );
      return (r.rowCount ?? 0) === 1;
    } catch (e) {
      logErr("call cap failed", e);
      return false;
    }
  }

  async releaseSlot(key: string) {
    try { await this.db.query("update atlas_call_counters set n = n - 1 where id = $1 and n > 0", [key]); } catch (e) { logErr("call release failed", e); }
  }

  async counter(key: string) {
    try {
      const r = await this.db.query("select n from atlas_call_counters where id = $1", [key]);
      return (r.rows[0]?.n as number | undefined) ?? 0;
    } catch (e) {
      logErr("call counter failed", e);
      return null;
    }
  }
}

/** The production store, or null when Postgres is not configured or its tables cannot be created. */
export async function callStore(): Promise<CallStore | null> {
  const p = getPool();
  if (!p || !(await ensureSchema(p))) return null;
  return new PgCallStore(p);
}

/**
 * Reserves every counter in order (most specific first) or none: when one refuses, the ones already taken are given
 * back, so a number at its own cap never spends the site's shared daily budget. Returns the index that refused.
 */
export async function reserveSlots(store: CallStore, slots: { key: string; cap: number }[], now: number): Promise<{ ok: true } | { ok: false; refused: number }> {
  const taken: string[] = [];
  for (const [i, s] of slots.entries()) {
    if (!(await store.takeSlot(s.key, s.cap, now))) {
      for (const t of taken.reverse()) await store.releaseSlot(t);
      return { ok: false, refused: i };
    }
    taken.push(s.key);
  }
  return { ok: true };
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
