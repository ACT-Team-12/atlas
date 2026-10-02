-- One feedback answer per plan: the server issues a signed one-time token with each plan, and its nonce
-- is stored here. The unique index makes a replayed token fail instead of counting twice.
alter table atlas_events add column if not exists feedback_nonce text;
create unique index if not exists atlas_events_feedback_nonce_uq on atlas_events (feedback_nonce) where feedback_nonce is not null;
