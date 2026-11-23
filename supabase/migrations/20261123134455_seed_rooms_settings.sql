-- 0005: seed the single settings row and the 44 rooms.
-- Room numbers, floors and rents come from the prototype backup (data/old_tenants.json).
-- Rates start at 0: the admin sets them on the Settings page (or the import fills them in).
-- Safe to re-run: existing rows are left untouched.

insert into public.settings (id, dorm_name, water_rate, electric_rate, due_day)
values (1, 'My Dorm', 0, 0, 5)
on conflict (id) do nothing;

insert into public.rooms (number, floor, default_rent) values
  ('101', 1, 6000.00),
  ('102', 1, 6000.00),
  ('103', 1, 6000.00),
  ('204', 2, 5500.00),
  ('205', 2, 4000.00),
  ('206', 2, 4500.00),
  ('207', 2, 6000.00),
  ('208', 2, 5500.00),
  ('209', 2, 5000.00),
  ('210', 2, 4500.00),
  ('211', 2, 5000.00),
  ('212', 2, 5000.00),
  ('213', 2, 4500.00),
  ('214', 2, 4500.00),
  ('315', 3, 5000.00),
  ('316', 3, 4500.00),
  ('317', 3, 6000.00),
  ('318', 3, 5000.00),
  ('319', 3, 5500.00),
  ('320', 3, 5500.00),
  ('321', 3, 4500.00),
  ('322', 3, 4500.00),
  ('323', 3, 5000.00),
  ('324', 3, 4500.00),
  ('325', 3, 4500.00),
  ('426', 4, 5000.00),
  ('427', 4, 5000.00),
  ('428', 4, 4500.00),
  ('429', 4, 4500.00),
  ('430', 4, 6000.00),
  ('431', 4, 5000.00),
  ('432', 4, 4500.00),
  ('433', 4, 5000.00),
  ('434', 4, 4500.00),
  ('435', 4, 4500.00),
  ('436', 4, 4500.00),
  ('537', 5, 6000.00),
  ('538', 5, 4500.00),
  ('539', 5, 5000.00),
  ('540', 5, 5000.00),
  ('541', 5, 5500.00),
  ('542', 5, 4500.00),
  ('543', 5, 5000.00),
  ('544', 5, 6000.00)
on conflict (number) do nothing;
