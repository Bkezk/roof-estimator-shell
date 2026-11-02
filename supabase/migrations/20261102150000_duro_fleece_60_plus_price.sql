-- Duro-Fleece 60mil Plus White read 226 per sq ft (the decimal lost on a hand edit). Owner,
-- Nov 2: "lets assume 2.26 for now". Only while the cell still reads 226.
update public.pricing_catalog c
set data = jsonb_set(c.data, '{rows}', (
  select jsonb_agg(
    case when e->>'Description' = 'Duro-Fleece - 60mil Plus' and (e->>'White')::numeric = 226
      then jsonb_set(e, '{White}', '2.26'::jsonb) else e end
    order by t.ord)
  from jsonb_array_elements(c.data->'rows') with ordinality as t(e, ord)))
where c.id = 'duro_last:duro_last_membrane';
