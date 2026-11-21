-- Weekly roster brief: one message per driver for a roster week, shown as a pop-up in the driver app
-- until they tap "I've read it". message_recipients.read_at / confirmed_at are the record of who has read it.
alter table messages add column if not exists kind text;          -- null = ordinary message, 'brief' = weekly roster brief
alter table messages add column if not exists week_start date;    -- the Monday of the roster week a brief is for
alter table messages add column if not exists title text;
create index if not exists messages_brief_idx on messages (week_start) where kind = 'brief';
alter table week_notes add column if not exists brief text;       -- the "for everyone" part of that week's brief
