-- Shared budget for "Say your answer" (speech to text), counted across every server instance.
-- One row per bucket per window: global audio-seconds per hour and per day, per-client audio-seconds per hour and
-- per day (the client is a keyed hash of the network address, never the address), and uses per quiz token (a hash
-- of the token). Numbers only: no audio, no words, no IP. Rows expire after their window; old rows are deleted.
create table if not exists atlas_stt_usage (
  bucket     text not null check (bucket ~ '^[a-z0-9:]{1,80}$'),
  win        bigint not null,
  used       integer not null default 0 check (used >= 0),
  expires_at timestamptz not null,
  primary key (bucket, win)
);
create index if not exists atlas_stt_usage_expires_idx on atlas_stt_usage (expires_at);
