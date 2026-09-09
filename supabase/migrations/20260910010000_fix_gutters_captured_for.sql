-- Fix: the 20260909200000 gutters reseed replaced the whole gutters subscreen WITHOUT the
-- captured_for field the admin editor displayed unguarded, crashing Admin > Exceptional Metals
-- in production. Restore a truthful captured_for (the editor is also guarded now). Applied live
-- 2026-09-09; idempotent.
update public.pricing_catalog
set data = jsonb_set(data, '{subscreens,gutters,captured_for}',
  '{"style": "DX/LX/EX/MX (installer seed)", "size": "4\", 5\" and 6\" grids"}'::jsonb)
where id = 'duro_last:exceptional_metals'
  and data->'subscreens'->'gutters'->'captured_for' is null;
