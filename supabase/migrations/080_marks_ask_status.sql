-- "Ask driver" on the Fix tab saves marks.status = 'ask' (waiting on the driver's answer); the check constraint didn't allow it.
alter table marks drop constraint if exists marks_status_check;
alter table marks add constraint marks_status_check check (status = any (array['ok','late','miss','exc','ask']));
