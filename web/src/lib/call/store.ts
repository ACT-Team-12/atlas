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
/** A plan call whose placing could not be confirmed (Vonage timed out) and that no event has confirmed since is wiped after this. */
export const UNCONFIRMED_PLAN_MS = 5 * 60_000;
/**
 * A session whose code was typed but whose plan call was never recorded as placed (the request died, or its own wipe
 * could not be written) is wiped after this. placed_at holds the moment the code was typed until the call is placed.
 */
export const PREPARING_MAX_MS = 5 * 60_000;
/** A placed plan call can ring 45 s and last 15 min (length_timer); past this its data is wiped even if no event came. */
export const PLAN_CALL_MAX_MS = 17 * 60_000;
export const COUNTER_TTL_MS = 2 * 24 * 60 * 60_000;
/**
 * Written to a plan call's `note` when a callback for its own, already verified call UUID says the call ended but
 * Vonage's GET still reports it live (a lagging read). It never wipes or ends anything by itself: the sweep and the
 * status route ask Vonage again (settlePendingEnds in flow.ts) and wipe only once Vonage itself reports an end.
 * The wipe clears it with everything else.
 */
export const END_PENDING = "end_pending";

/**
 * Thrown by get, getAudio, takeAttempt and takeSlot when the database cannot answer, so a caller can never mistake an outage for
 * "no such session". The call routes turn it into 503 (Vonage retries; the page says calls are unavailable).
 */
export class CallStoreDown extends Error {
  constructor() { super("call store unavailable"); this.name = "CallStoreDown"; }
}

export type UpdateResult = "updated" | "phase_changed" | "error";
export type Phase = "code" | "code_missed" | "expired" | "calling" | "done" | "failed";

export type SessionRow = {
  id: string;
  /** HMAC of the number while the session is live; cleared when it ends (the caps live in atlas_call_counters). */
  phone_hash: string | null;
  /** The number's last 4 digits, for the person's own status line; cleared with everything else when the session ends. */
  last4: string | null;
  language: string | null;
  phase: Phase;
  code_hash: string | null;
  attempts: number;
  code_expires_at: Date | null;
  code_status: string | null;
  plan_status: string | null;
  plan_mode: "stream" | "talk" | null;
  note: string | null;
  /** The Vonage call UUIDs returned by POST /v1/calls (or bound by the call's first event); callbacks must match. */
  code_uuid: string | null;
  plan_uuid: string | null;
  /** When the plan call was placed (or its placing could not be confirmed); before that, when the code was typed. */
  placed_at: Date | null;
  sealed_phone: Buffer | null;
  sealed_text: Buffer | null;
  sealed_token: Buffer | null;
  /** Whether a voice MP3 is stored. The MP3 itself (a few MB) is read only by getAudio, never by get. */
  has_audio: boolean;
  /**
   * Whether the plan call's code was entered and the plan played: false from the moment the code is typed on the page,
   * true once the right code is entered on the call, null before (or on rows from before this column). Nothing about the
   * person, so the wipe keeps it: the page needs it after the call ends to say whether the plan was read.
   */
  plan_played: boolean | null;
  created_at: Date;
  expires_at: Date;
};

export type NewSession = Pick<SessionRow, "id" | "phone_hash" | "last4" | "language" | "code_hash" | "code_expires_at" | "sealed_phone" | "sealed_text" | "sealed_token" | "expires_at">;
export type SessionPatch = Partial<Pick<SessionRow, "phone_hash" | "language" | "last4" | "phase" | "code_hash" | "code_status" | "plan_status" | "plan_mode" | "note" | "code_uuid" | "plan_uuid" | "placed_at" | "sealed_phone" | "sealed_text" | "sealed_token" | "plan_played">> & { sealed_audio?: Buffer | null };

/**
 * Clears everything a session holds about the person and the call except its phase, statuses and plan_played (so the
 * page can say whether it finished, was missed, or ended before the plan was read). Rate limits do not need the row: they live in atlas_call_counters, keyed by HMAC.
 */
export const WIPE_SQL = "phone_hash = null, language = null, plan_mode = null, note = null, code_uuid = null, plan_uuid = null, placed_at = null, code_hash = null, last4 = null, sealed_phone = null, sealed_text = null, sealed_token = null, sealed_audio = null";
/** Clears everything sensitive a session holds. Used when a call ends or a session can go no further. */
export const WIPE: SessionPatch = {
  phone_hash: null, language: null, plan_mode: null, note: null, code_uuid: null, plan_uuid: null, placed_at: null,
  last4: null, sealed_phone: null, sealed_text: null, sealed_token: null, sealed_audio: null, code_hash: null };

export interface CallStore {
  /** Deletes expired sessions and counters and wipes sessions that can go no further. False on a database error. */
  sweep(now: number): Promise<boolean>;
  /**
   * Live plan calls carrying the END_PENDING marker and a stored plan UUID (at most `limit`, oldest placed first), so
   * the end can be checked with Vonage again. null on a database error.
   */
  pendingEnds(now: number, limit: number): Promise<{ id: string; plan_uuid: string }[] | null>;
  /** Inserts a session in phase "code", unless this number already has a live code ("in-flight"). */
  startCode(s: NewSession, now: number): Promise<"ok" | "in-flight" | "error">;
  /** Deletes a session that never got a call. True only when the delete was confirmed; false on a database error. */
  drop(id: string): Promise<boolean>;
  /**
   * Records that one of a session's calls was placed: `status` ("placed", or "unknown" when Vonage did not confirm) is
   * written only if no event has set one already, `uuid` (when known) always wins. Only while the session is in `phase`.
   */
  markPlaced(id: string, leg: "code" | "plan", status: "placed" | "unknown", uuid: string | null, now: number): Promise<boolean>;
  /** The live session, or null when there is none. Throws CallStoreDown when the database cannot answer. */
  get(id: string, now: number): Promise<SessionRow | null>;
  /** The sealed voice MP3 of a live session. Throws CallStoreDown. */
  getAudio(id: string, now: number): Promise<Buffer | null>;
  /** Spends one code attempt atomically; null when there is no live code left to try. Throws CallStoreDown. */
  takeAttempt(id: string, now: number): Promise<SessionRow | null>;
  /**
   * "updated" when the row was written; "phase_changed" when no live row matched (gone, or, with onlyIf, its phase is
   * no longer one of those); "error" when the database could not be reached. Only "updated" confirms the write.
   */
  update(id: string, patch: SessionPatch, onlyIf?: Phase[]): Promise<UpdateResult>;
  /**
   * Binds a Vonage call UUID to one of a session's calls when none is stored yet: "bound" when this call bound it,
   * "match" when it already was this UUID, "mismatch" when another UUID is stored, "gone" when there is no live
   * session, "error" on a database error.
   */
  claimUuid(id: string, leg: "code" | "plan", uuid: string, now: number): Promise<"match" | "bound" | "mismatch" | "gone" | "error">;
  /**
   * Takes one slot of a counter capped at `cap`, atomically. The counter lives `ttlMs` from its first slot; once that
   * has passed it starts again from zero (so a short window such as "1 per 10 minutes" works without a sweep).
   * false means the counter is full; a database error throws CallStoreDown, so an outage is never read as a cap.
   */
  takeSlot(key: string, cap: number, now: number, ttlMs?: number): Promise<boolean>;
  releaseSlot(key: string): Promise<void>;
  /** A counter's value inside its window (0 when absent or past it); null on a database error. */
  counter(key: string, now?: number): Promise<number | null>;
}

export const SCHEMA_SQL = `
create table if not exists atlas_calls (
  id              text primary key,
  phone_hash      text,
  last4           text check (last4 ~ '^[0-9]{4}$'),
  language        text,
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
alter table atlas_calls alter column last4 drop not null;
alter table atlas_calls alter column phone_hash drop not null;
alter table atlas_calls alter column language drop not null;
alter table atlas_calls add column if not exists code_uuid text;
alter table atlas_calls add column if not exists plan_uuid text;
alter table atlas_calls add column if not exists placed_at timestamptz;
alter table atlas_calls add column if not exists plan_played boolean;
create unique index if not exists atlas_calls_one_code_uq on atlas_calls (phone_hash) where phase = 'code';
-- One live session per number (a code, or a plan call live or unconfirmed): see LIVE_INDEX and
-- db/migrations/006_atlas_calls_one_live.sql. Built here only when it cannot fail (no duplicate live rows), so a
-- request never fails on it; otherwise ensureSchema reports it missing and the migration resolves the duplicates.
do $$
begin
  if not exists (select 1 from pg_indexes where tablename = 'atlas_calls' and indexname = 'atlas_calls_one_live_uq')
     and not exists (select 1 from atlas_calls where phase in ('code', 'calling') and expires_at > now()
                     group by phone_hash having count(*) > 1) then
    update atlas_calls set phase = 'expired', code_hash = null, last4 = null, sealed_phone = null, sealed_text = null,
      sealed_token = null, sealed_audio = null
    where phase in ('code', 'calling') and expires_at <= now();
    create unique index if not exists atlas_calls_one_live_uq on atlas_calls (phone_hash) where phase in ('code', 'calling');
  end if;
end $$;
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

/**
 * Creates the tables on first use (idempotent), so the feature needs no manual migration step to go live on a fresh
 * database. Then checks that the one-live-session index exists: without it two live sessions could exist for one
 * number, so calls stay OFF (fail closed) and the log says why, until db/migrations/006_atlas_calls_one_live.sql runs
 * (or the duplicate rows expire and the next request builds it).
 */
export async function ensureSchema(db: Q): Promise<boolean> {
  if (ready.has(db)) return true;
  try {
    await db.query(SCHEMA_SQL);
    const idx = await db.query("select 1 from pg_indexes where tablename = 'atlas_calls' and indexname = 'atlas_calls_one_live_uq'");
    if ((idx.rowCount ?? 0) !== 1) {
      console.error("call schema: one-live-session index missing (duplicate live rows); run db/migrations/006_atlas_calls_one_live.sql");
      return false;
    }
    ready.add(db);
    return true;
  } catch (e) {
    console.error("call schema failed", e instanceof Error ? e.name : typeof e);
    return false;
  }
}

/**
 * Read-time retention: whatever the sweep has or has not done yet, a session past its limits never hands out its
 * encrypted data. A code nobody typed within 10 minutes, a typed code whose plan call was not placed within 5, a plan
 * call Vonage never confirmed within 5, or any plan call
 * past its longest possible length reads as wiped (and the row itself is invisible past 30 minutes).
 */
export function refuseStale(row: SessionRow, now: number): SessionRow {
  const placed = row.placed_at?.getTime();
  const codeOver = row.phase === "code" && (row.code_expires_at?.getTime() ?? 0) <= now;
  const planOver = row.phase === "calling" && placed !== undefined
    && ((row.plan_status === "unknown" && placed < now - UNCONFIRMED_PLAN_MS) || placed < now - PLAN_CALL_MAX_MS
      || (row.plan_status === null && placed < now - PREPARING_MAX_MS));
  return codeOver || planOver ? { ...row, code_hash: null, last4: null, sealed_phone: null, sealed_text: null, sealed_token: null, has_audio: false } : row;
}

const COLS = "id, phone_hash, last4, language, phase, code_hash, attempts, code_expires_at, code_status, plan_status, plan_mode, note, code_uuid, plan_uuid, placed_at, sealed_phone, sealed_text, sealed_token, (sealed_audio is not null) as has_audio, plan_played, created_at, expires_at";
const PATCHABLE = new Set(["phone_hash", "language", "last4", "phase", "code_hash", "code_status", "plan_status", "plan_mode", "note", "code_uuid", "plan_uuid", "placed_at", "sealed_phone", "sealed_text", "sealed_token", "sealed_audio", "plan_played"]);
const logErr = (what: string, e: unknown) => console.error(what, e instanceof Error ? e.name : typeof e); // never values

export class PgCallStore implements CallStore {
  constructor(private readonly db: Q) {}

  async sweep(now: number) {
    try {
      const at = new Date(now);
      await this.db.query("delete from atlas_calls where expires_at < $1", [at]);
      // A code nobody typed in time: the session can go no further, so its encrypted data goes now, not at 30 minutes.
      await this.db.query(
        `update atlas_calls set phase = case when phase = 'code' then 'expired' else phase end, ${WIPE_SQL}
         where (phase = 'code' and code_expires_at < $1) or (phase in ('code_missed', 'expired', 'failed', 'done') and phone_hash is not null)`,
        [at],
      );
      // A plan call Vonage never confirmed (placing timed out, no event since), or one past its longest possible length.
      await this.db.query(
        `update atlas_calls set phase = 'failed', ${WIPE_SQL}
         where phase = 'calling' and ((plan_status = 'unknown' and placed_at < $1) or placed_at < $2 or (plan_status is null and placed_at < $3))`,
        [new Date(now - UNCONFIRMED_PLAN_MS), new Date(now - PLAN_CALL_MAX_MS), new Date(now - PREPARING_MAX_MS)],
      );
      await this.db.query("delete from atlas_call_counters where expires_at < $1", [at]);
      return true;
    } catch (e) {
      logErr("call sweep failed", e);
      return false;
    }
  }

  async pendingEnds(now: number, limit: number) {
    try {
      const r = await this.db.query(
        `select id, plan_uuid from atlas_calls
         where phase = 'calling' and note = $1 and plan_uuid is not null and expires_at > $2
         order by placed_at nulls first limit $3`,
        [END_PENDING, new Date(now), limit],
      );
      return r.rows as { id: string; plan_uuid: string }[];
    } catch (e) {
      logErr("call pending ends failed", e);
      return null;
    }
  }

  async startCode(s: NewSession, now: number) {
    try {
      // A code that ran out of time no longer blocks this number.
      await this.db.query("update atlas_calls set phase = 'expired', code_hash = null where phone_hash = $1 and phase = 'code' and code_expires_at < $2", [s.phone_hash, new Date(now)]);
      // No new code call while a plan call to this number is live or still unconfirmed (it may be ringing right now).
      const r = await this.db.query(
        `insert into atlas_calls (id, phone_hash, last4, language, phase, code_hash, code_expires_at, sealed_phone, sealed_text, sealed_token, expires_at)
         select $1, $2, $3, $4, 'code', $5, $6, $7, $8, $9, $10
         where not exists (select 1 from atlas_calls where phone_hash = $2 and phase = 'calling' and expires_at > $11)`,
        [s.id, s.phone_hash, s.last4, s.language, s.code_hash, s.code_expires_at, s.sealed_phone, s.sealed_text, s.sealed_token, s.expires_at, new Date(now)],
      );
      return (r.rowCount ?? 0) === 1 ? "ok" as const : "in-flight" as const;
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") return "in-flight" as const;
      logErr("call start failed", e);
      return "error" as const;
    }
  }

  async drop(id: string) {
    try {
      await this.db.query("delete from atlas_calls where id = $1", [id]);
      return true;
    } catch (e) {
      logErr("call drop failed", e);
      return false;
    }
  }

  async markPlaced(id: string, leg: "code" | "plan", status: "placed" | "unknown", uuid: string | null, now: number) {
    const sql = leg === "code"
      ? "update atlas_calls set code_status = coalesce(code_status, $2), code_uuid = coalesce($3, code_uuid) where id = $1 and phase = 'code'"
      : "update atlas_calls set plan_status = coalesce(plan_status, $2), plan_uuid = coalesce($3, plan_uuid), placed_at = $4 where id = $1 and phase = 'calling'";
    try {
      const r = await this.db.query(sql, leg === "code" ? [id, status, uuid] : [id, status, uuid, new Date(now)]);
      return (r.rowCount ?? 0) === 1;
    } catch (e) {
      logErr("call mark failed", e);
      return false;
    }
  }

  async get(id: string, now: number) {
    try {
      const r = await this.db.query(`select ${COLS} from atlas_calls where id = $1 and expires_at > $2`, [id, new Date(now)]);
      const row = (r.rows[0] as SessionRow | undefined) ?? null;
      return row && refuseStale(row, now);
    } catch (e) {
      logErr("call get failed", e);
      throw new CallStoreDown();
    }
  }

  async getAudio(id: string, now: number) {
    try {
      const r = await this.db.query("select sealed_audio from atlas_calls where id = $1 and expires_at > $2", [id, new Date(now)]);
      return (r.rows[0]?.sealed_audio as Buffer | null | undefined) ?? null;
    } catch (e) {
      logErr("call audio failed", e);
      throw new CallStoreDown();
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
      throw new CallStoreDown();
    }
  }

  async update(id: string, patch: SessionPatch, onlyIf?: Phase[]) {
    const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k)) as (keyof SessionPatch)[];
    if (!keys.length) return "phase_changed" as const;
    const params: unknown[] = [id, ...keys.map((k) => patch[k] ?? null)];
    let sql = `update atlas_calls set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`;
    if (onlyIf?.length) { params.push(onlyIf); sql += ` and phase = any($${params.length}::text[])`; }
    try {
      const r = await this.db.query(sql, params);
      return (r.rowCount ?? 0) === 1 ? "updated" as const : "phase_changed" as const;
    } catch (e) {
      logErr("call update failed", e);
      return "error" as const;
    }
  }

  async claimUuid(id: string, leg: "code" | "plan", uuid: string, now: number) {
    const col = leg === "code" ? "code_uuid" : "plan_uuid";
    try {
      // The outer select sees the row as it was before the update, so "bound" must win the coalesce.
      const r = await this.db.query(
        `with c as (update atlas_calls set ${col} = $2 where id = $1 and expires_at > $3 and ${col} is null returning 1)
         select coalesce(
           (select 'bound' from c),
           (select case when ${col} = $2 then 'match' else 'mismatch' end from atlas_calls where id = $1 and expires_at > $3),
           'gone') as r`,
        [id, uuid, new Date(now)],
      );
      return r.rows[0]?.r as "match" | "bound" | "mismatch" | "gone";
    } catch (e) {
      logErr("call uuid failed", e);
      return "error" as const;
    }
  }

  async takeSlot(key: string, cap: number, now: number, ttlMs = COUNTER_TTL_MS) {
    if (cap <= 0) return false;
    try {
      // The conflict update only applies while n < cap or the window has passed; at the cap no row is returned.
      // A counter whose window has passed (not swept yet) starts again at 1 with a fresh window.
      const r = await this.db.query(
        `insert into atlas_call_counters (id, n, expires_at) values ($1, 1, $3)
         on conflict (id) do update set
           n = case when atlas_call_counters.expires_at <= $4 then 1 else atlas_call_counters.n + 1 end,
           expires_at = case when atlas_call_counters.expires_at <= $4 then excluded.expires_at else atlas_call_counters.expires_at end
         where atlas_call_counters.n < $2 or atlas_call_counters.expires_at <= $4
         returning n`,
        [key, cap, new Date(now + ttlMs), new Date(now)],
      );
      return (r.rowCount ?? 0) === 1;
    } catch (e) {
      logErr("call cap failed", e);
      throw new CallStoreDown();
    }
  }

  async releaseSlot(key: string) {
    try { await this.db.query("update atlas_call_counters set n = n - 1 where id = $1 and n > 0", [key]); } catch (e) { logErr("call release failed", e); }
  }

  async counter(key: string, now = Date.now()) {
    try {
      const r = await this.db.query("select n from atlas_call_counters where id = $1 and expires_at > $2", [key, new Date(now)]);
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
 * A database error gives back what was taken and rethrows CallStoreDown.
 */
export async function reserveSlots(store: CallStore, slots: { key: string; cap: number; ttlMs?: number }[], now: number): Promise<{ ok: true } | { ok: false; refused: number }> {
  const taken: string[] = [];
  for (const [i, s] of slots.entries()) {
    let got: boolean;
    try { got = await store.takeSlot(s.key, s.cap, now, s.ttlMs); } catch (e) {
      for (const t of taken.reverse()) await store.releaseSlot(t);
      throw e;
    }
    if (!got) {
      for (const t of taken.reverse()) await store.releaseSlot(t);
      return { ok: false, refused: i };
    }
    taken.push(s.key);
  }
  return { ok: true };
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export const hourKey = (now: number) => new Date(now).toISOString().slice(0, 13);
