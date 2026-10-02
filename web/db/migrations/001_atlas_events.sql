-- Anonymous usage events. No paper text, no names, no addresses, no IP, no free text.
create table if not exists atlas_events (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  env           text not null check (env in ('production', 'preview', 'development', 'local')),
  is_test       boolean not null default false,
  surface       text not null check (surface in ('web', 'ios', 'android')),
  kind          text not null check (kind in ('read', 'plan', 'quiz', 'feedback')),
  language      text,
  reading_level text,
  source_kind   text check (source_kind in ('text', 'image')),
  steps         smallint check (steps between 0 and 100),
  held_back     smallint check (held_back between 0 and 100),
  dropped_refs  smallint check (dropped_refs between 0 and 100),
  quiz_total    smallint check (quiz_total between 0 and 40),
  quiz_first_try smallint check (quiz_first_try between 0 and 40),
  barriers      text[],
  ms            integer check (ms between 0 and 600000),
  role          text check (role in ('patient', 'caregiver', 'helper', 'tester')),
  rating        smallint check (rating between 1 and 5),
  would_use     text check (would_use in ('yes', 'maybe', 'no'))
);
create index if not exists atlas_events_real_idx on atlas_events (kind, at) where env = 'production' and not is_test;
