-- Rural pick-ups are done by the 5am morning sorter (SUP, "NZC/PH Pick Up" task, pu_area Rural), not on the Outram run.
-- The standing "Rural" pick-up task from 039 was on RAM, so Outram drivers were asked to enter pick-ups. Remove it and its timing rule.
delete from public.timing_rules where addon = 'tw_purural';
delete from public.addons where id = 'tw_purural';
