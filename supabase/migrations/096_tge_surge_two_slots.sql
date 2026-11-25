-- TGE Surge (25 Nov 2026): two rows on the Run Board, so a second surge run can be added each day.
update public.runs set slots = 2 where code = 'SG';
