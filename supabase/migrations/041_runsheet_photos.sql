-- Runsheet photo: the task's Done button takes the photo; it's stored and the task is ticked in one go.
alter table public.shifts add column if not exists runsheet_photos text[] not null default '{}';

-- Private bucket; paths are <driver id>/<day>/<shift id>-<ts>.<ext>. Driver uploads/reads their own; staff all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('runsheets', 'runsheets', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic'])
  on conflict (id) do nothing;
create policy runsheets_upload on storage.objects for insert to authenticated with check (bucket_id = 'runsheets' and ((storage.foldername(name))[1] = me() or is_boss()));
create policy runsheets_read on storage.objects for select to authenticated using (bucket_id = 'runsheets' and ((storage.foldername(name))[1] = me() or is_boss()));

create or replace function public.runsheet_done(p_shift uuid, p_path text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set runsheet_photos = array_append(runsheet_photos, p_path), done = done || jsonb_build_object('tw_twrunsheet', now()) where id = p_shift;
end $$;
grant execute on function public.runsheet_done(uuid, text) to authenticated;

update public.timing_rules set note = 'Before you send your EOD: tap Take photo and photograph the completed runsheet. That ticks it off.' where id = 'twrunsheet';
