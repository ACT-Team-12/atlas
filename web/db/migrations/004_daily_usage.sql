-- A shared daily ceiling for the paid AI routes, counted across every server instance (the per-IP guard in
-- lib/guard.ts lives in one instance's memory). One row per UTC day per route. Counts only: no paper, no IP.
create table if not exists atlas_daily_usage (
  day     date not null,
  bucket  text not null check (bucket ~ '^[a-z-]{1,40}$'),
  n       integer not null default 0 check (n >= 0),
  primary key (day, bucket)
);
