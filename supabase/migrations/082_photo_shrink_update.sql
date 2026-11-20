-- lets the owner/admin overwrite a photo with its shrunk copy (☰ Records › Photo storage)
create policy photos_boss_update on storage.objects for update using (bucket_id in ('runsheets','vchk','errs') and is_boss()) with check (bucket_id in ('runsheets','vchk','errs') and is_boss());
