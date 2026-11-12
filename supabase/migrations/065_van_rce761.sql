insert into vans (plate, name, active, colour) values ('RCE761', 'RCE761', true, 'white') on conflict (plate) do update set active = true;
