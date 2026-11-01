-- Back up (BU) shifts: voluntary (offered on the day, paid for hours worked only) or committed
-- (agreed a week ahead; allowance $10 for a block up to 5 h, $20 for over 5 up to 10 h when not needed).
alter table shifts add column if not exists bu_kind text check (bu_kind in ('voluntary','committed'));
alter table shifts add column if not exists bu_block int check (bu_block in (5,10));
