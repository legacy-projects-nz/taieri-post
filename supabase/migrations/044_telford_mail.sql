-- Telford mail: tickable add-on on D>B (like Waihola Store), no extra minutes
insert into public.addons (id, name, short, runs, no_saturday, minutes, task) values
  ('telford', 'Telford mail', 'Telford', array['DB'], false, 0, true)
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, task = true;
