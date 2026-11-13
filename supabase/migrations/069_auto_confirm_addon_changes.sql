-- Only shift and van changes need a driver's "Got it". Clear waiting acks on add-on/note-only change lines.
update change_acks a set confirmed_at = now()
from roster_change_items i
where a.item_id = i.id and a.confirmed_at is null and a.dismissed_at is null
  and i.before->>'driver' is not null and i.after->>'driver' is not null
  and not exists (select 1 from unnest(array['driver','trainee','van','start_at','end_at','bu_kind','bu_block']) k
                  where (i.before->>k) is distinct from (i.after->>k));
