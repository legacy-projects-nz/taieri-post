-- Driver licence photos (front and back), taken in the driver's profile. Private bucket "licences";
-- paths are <driver id>/<front|back>-<ts>.jpg. Drivers upload/read their own; only the owner and staff with People can read them.
alter table public.people add column if not exists licence_front text, add column if not exists licence_back text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('licences', 'licences', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic'])
  on conflict (id) do nothing;
create policy licences_upload on storage.objects for insert to authenticated with check (bucket_id = 'licences' and (storage.foldername(name))[1] = me());
create policy licences_read on storage.objects for select to authenticated using (bucket_id = 'licences' and ((storage.foldername(name))[1] = me() or has_perm('people'::text)));
create or replace function public.set_my_licence_photo(p_side text, p_path text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_side not in ('front', 'back') then raise exception 'side must be front or back'; end if;
  if split_part(p_path, '/', 1) <> me() then raise exception 'not your photo'; end if;
  if p_side = 'front' then update people set licence_front = p_path where id = me(); else update people set licence_back = p_path where id = me(); end if;
end $$;
revoke execute on function public.set_my_licence_photo(text, text) from public, anon; grant execute on function public.set_my_licence_photo(text, text) to authenticated;
