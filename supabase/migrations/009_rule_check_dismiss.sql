-- Rule check: remember which items the owner/admin has dismissed, per week
alter table week_notes add column if not exists dismissed jsonb not null default '[]'::jsonb;
