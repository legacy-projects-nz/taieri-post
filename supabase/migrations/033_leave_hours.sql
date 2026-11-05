-- Paid sick days count as staff cost: hours per day paid (null = the driver's average day over the last 4 weeks).
alter table public.leave_requests add column if not exists hours numeric;
