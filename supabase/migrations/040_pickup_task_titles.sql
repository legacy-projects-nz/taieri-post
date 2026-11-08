-- Pick-up tasks are titled by their area
update public.addons set name = 'South', short = 'South' where id = 'tw_pusouth';
update public.addons set name = 'Owaka', short = 'Owaka' where id = 'tw_puowaka';
update public.addons set name = 'Lawrence', short = 'Lawrence' where id = 'tw_pulaw';
update public.addons set name = 'Rural', short = 'Rural' where id = 'tw_purural';
update public.timing_rules set name = 'South' where id = 'pusouth';
update public.timing_rules set name = 'Owaka' where id = 'puowaka';
update public.timing_rules set name = 'Lawrence' where id = 'pulaw';
update public.timing_rules set name = 'Rural' where id = 'purural';
