-- Photos on recorded errors (7 Nov 2026)
alter table entries add column if not exists photos text[] not null default '{}';

-- Private bucket; paths are <driver id>/<day>/<file>. Staff upload/read/delete; a driver can read their own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('errs', 'errs', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic'])
  on conflict (id) do nothing;
create policy errs_upload on storage.objects for insert to authenticated with check (bucket_id = 'errs' and is_boss());
create policy errs_read on storage.objects for select to authenticated using (bucket_id = 'errs' and (is_boss() or (storage.foldername(name))[1] = me()));
create policy errs_delete on storage.objects for delete to authenticated using (bucket_id = 'errs' and is_boss());
