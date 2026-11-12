-- RAM, TUA and Flyer EODs carry an NZ Post total and a 3rd Party total (extra.nzp_total / extra.third_total; parcels = the sum).
-- When NZ Post's daily data (nzpost_feed, imported ~8:15pm) has that run's day, the NZ Post total is checked against it and
-- corrected to match; the driver's own figure is kept in extra.nzp_driver. The 3rd Party total is never changed.
create or replace function public.eod_nzp_apply() returns trigger language plpgsql security definer set search_path = public as $$
declare v_run text; v_day date; v_code text; v_items int; v_drv int; v_third int;
begin
  if new.extra is null or not (new.extra ? 'nzp_total') then return new; end if;
  select s.run, s.day into v_run, v_day from shifts s where s.id = new.shift_id;
  if v_run is null or v_run not in ('RAM','TUA','FLY') then return new; end if;
  select value->>v_run into v_code from settings where key = 'runCodes';
  if v_code is null then return new; end if;
  select items into v_items from nzpost_feed where day = v_day and feed_code = v_code;
  if v_items is null then return new; end if;
  v_drv := coalesce((new.extra->>'nzp_driver')::int, (new.extra->>'nzp_total')::int);
  v_third := coalesce((new.extra->>'third_total')::int, 0);
  new.extra := new.extra || jsonb_build_object('nzp_feed', v_items, 'nzp_total', v_items, 'nzp_checked_at', now())
               || case when v_drv is distinct from v_items then jsonb_build_object('nzp_driver', v_drv) else '{}'::jsonb end;
  if v_drv is not distinct from v_items then new.extra := new.extra - 'nzp_driver'; end if;
  new.parcels := v_items + v_third;
  return new;
end $$;
drop trigger if exists eod_nzp_apply on public.eod;
create trigger eod_nzp_apply before insert or update on public.eod for each row execute function public.eod_nzp_apply();

-- when the nightly feed lands, re-run the check on that day's split EODs
create or replace function public.feed_nzp_reconcile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('tp.nzp_sync', '1', true);   -- so the EOD isn't stamped as edited by the driver
  update eod e set extra = e.extra
    from shifts s, settings st
    where s.id = e.shift_id and st.key = 'runCodes' and s.day = new.day and s.run in ('RAM','TUA','FLY')
      and st.value->>s.run = new.feed_code and e.extra ? 'nzp_total';
  perform set_config('tp.nzp_sync', '', true);
  return null;
end $$;
drop trigger if exists feed_nzp_reconcile on public.nzpost_feed;
create trigger feed_nzp_reconcile after insert or update on public.nzpost_feed for each row execute function public.feed_nzp_reconcile();

-- the 8pm check isn't a driver edit: leave edited_at / edited_by alone for it
create or replace function public.eod_stamp_edit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('tp.nzp_sync', true), '') = '1' then return new; end if;
  if not is_boss() then new.edited_at := now(); new.edited_by := me(); new.shift_id := old.shift_id; new.driver := old.driver; new.sent_at := old.sent_at; end if;
  return new;
end $$;
