-- How a plan's tab arrived. The only value is 'helper-link' (a link a helper made at /helper); null is the normal site.
-- Nothing from the link is stored: no ZIP, no language choice, no reading level, no link text.
alter table atlas_events add column if not exists entry text check (entry in ('helper-link'));
