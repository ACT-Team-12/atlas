-- Whether a plan call's code was entered and the plan played ("ATLAS calls you", lib/call/flow.ts gateInput).
-- false from the moment the code is typed on the page, true once the right code is entered on the call, null on rows
-- from before this column. It holds nothing about the person, so the wipe at the end of a call keeps it: the page uses
-- it to say plainly when a call ended before the plan was read. The row itself still expires after 30 minutes.
-- The app also adds this column on first use (lib/call/store.ts SCHEMA_SQL). Safe to run again.
alter table atlas_calls add column if not exists plan_played boolean;
