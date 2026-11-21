-- 090: Passwords & logins weren't showing in the driver portal. access_read used _pid(), which authenticated
-- can't execute (revoked in 006), so every read failed with 403. Use me() like the other policies. Applied 22 Nov 2026.
drop policy if exists access_read on public.access_info;
create policy access_read on public.access_info for select to authenticated using (me() is not null);
