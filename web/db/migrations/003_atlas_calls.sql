-- "ATLAS calls you" (web/src/lib/call/store.ts creates the same tables on first use; this file keeps the schema reviewable).
-- The number, the plan text, its token and the voice MP3 are stored only encrypted (AES-256-GCM, key derived from
-- ATLAS_CALL_SECRET), wiped when the plan call ends, and the row expires 30 minutes after it was created.
-- Counters are keyed by an HMAC of the number, never the number.
create table if not exists atlas_calls (
  id              text primary key,
  phone_hash      text not null,
  last4           text check (last4 ~ '^[0-9]{4}$'), -- cleared when the session ends
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
alter table atlas_calls alter column last4 drop not null;
alter table atlas_calls add column if not exists code_uuid text;
alter table atlas_calls add column if not exists plan_uuid text;
alter table atlas_calls add column if not exists placed_at timestamptz;
create unique index if not exists atlas_calls_one_code_uq on atlas_calls (phone_hash) where phase = 'code';
-- One live session per number: a code, or a plan call (live or unconfirmed). This index, not a check in the insert,
-- is what holds when a code is typed while a new code starts for the same number. Expired rows go first so an old
-- leftover can never make the index fail to build.
delete from atlas_calls where expires_at < now();
create unique index if not exists atlas_calls_one_live_uq on atlas_calls (phone_hash) where phase in ('code', 'calling');
create index if not exists atlas_calls_expires_idx on atlas_calls (expires_at);
create table if not exists atlas_call_counters (
  id         text primary key,
  n          integer not null check (n >= 0),
  expires_at timestamptz not null
);
create index if not exists atlas_call_counters_expires_idx on atlas_call_counters (expires_at);
