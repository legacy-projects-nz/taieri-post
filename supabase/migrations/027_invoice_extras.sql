-- Extra invoice lines (anything beyond pick-up counts) added in the Pick-ups tab and included in the Xero export
create table if not exists public.invoice_extras (
  id uuid primary key default gen_random_uuid(),
  month text not null,             -- YYYY-MM the invoice is for
  customer text not null,          -- NZC / PH / TGE
  item_code text,
  description text not null,
  qty numeric not null default 1,
  price numeric not null default 0,
  account text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists invoice_extras_month_idx on public.invoice_extras (month);
alter table public.invoice_extras enable row level security;
create policy invoice_extras_staff_all on public.invoice_extras for all to authenticated using (has_perm('roster'::text)) with check (has_perm('roster'::text));
