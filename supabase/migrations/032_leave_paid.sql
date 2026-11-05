-- Sick days: owner records whether leave is paid. Sick leave defaults to paid once employed 6 months (people.started).
alter table public.leave_requests add column if not exists paid boolean;
comment on column public.leave_requests.paid is 'Owner choice: true = paid, false = unpaid, null = not set. Sick leave defaults to paid once employed 6 months (people.started).';
