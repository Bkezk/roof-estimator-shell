-- Two decimal slips in the seeded price list, found while generating the PlanSwift costing
-- templates (Sep 25): Duro-Tuff 50 Gray / Dark Gray were 129 where every neighbour (White 1.14,
-- Tan 1.29, and the Duro-Tuff 60 row at 1.29) is $/sq ft; the 13" pipe stack Dark Gray was 2435
-- where the 12" and 14" rows and its own other colours are 24.35. Applied live the same day.
update public.pricing_catalog c set data = jsonb_set(c.data, '{rows}', (
  select jsonb_agg(case when r->>'Description' = 'Duro-Tuff - 50' then r || '{"Gray": 1.29, "Dark Gray": 1.29}'::jsonb else r end)
  from jsonb_array_elements(c.data->'rows') r))
where c.id = 'duro_last:duro_last_membrane'
  and exists (select 1 from jsonb_array_elements(c.data->'rows') r where r->>'Description' = 'Duro-Tuff - 50' and (r->>'Gray')::numeric = 129);
update public.pricing_catalog c set data = jsonb_set(c.data, '{rows}', (
  select jsonb_agg(case when r->>'Size' = '13' then r || '{"Dark Gray": 24.35}'::jsonb else r end)
  from jsonb_array_elements(c.data->'rows') r))
where c.id = 'duro_last:pipe_stacks'
  and exists (select 1 from jsonb_array_elements(c.data->'rows') r where r->>'Size' = '13' and (r->>'Dark Gray')::numeric = 2435);
