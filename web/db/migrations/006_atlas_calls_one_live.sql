-- One live session per number for "ATLAS calls you": a code, or a plan call (live or unconfirmed).
-- A partial unique index enforces it; before it existed, a code typed while a new code started for the same number
-- could leave both live, which would make the index fail to build. So, in order and idempotently:
--   1. sessions past their 30 minutes are closed and wiped (they can go no further anyway);
--   2. where a number still has more than one live session, the plan call is kept (phase 'calling', latest placed,
--      then latest created) and every other one is marked failed and wiped;
--   3. the index is built.
-- The table is locked against writes for the whole transaction (a few milliseconds on a table this small).
-- Needs 003_atlas_calls.sql first (it adds placed_at and makes last4 nullable). Safe to run again.
begin;

-- No writer may create a new live session until the index exists: the lock is held through the commit.
-- SHARE ROW EXCLUSIVE blocks inserts, updates and deletes but still allows reads (status polls keep working).
lock table atlas_calls in share row exclusive mode;

update atlas_calls
set phase = 'expired', code_hash = null, last4 = null, sealed_phone = null, sealed_text = null, sealed_token = null, sealed_audio = null
where phase in ('code', 'calling') and expires_at <= now();

with ranked as (
  select id, row_number() over (
    partition by phone_hash
    order by (phase = 'calling') desc, placed_at desc nulls last, created_at desc, id
  ) as rn
  from atlas_calls
  where phase in ('code', 'calling')
)
update atlas_calls a
set phase = 'failed', note = 'duplicate live session resolved by migration 006', code_hash = null, last4 = null,
    sealed_phone = null, sealed_text = null, sealed_token = null, sealed_audio = null
from ranked r
where a.id = r.id and r.rn > 1;

create unique index if not exists atlas_calls_one_live_uq on atlas_calls (phone_hash) where phase in ('code', 'calling');

commit;
