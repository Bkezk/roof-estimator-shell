-- Owner, Nov 2: "delete the plain duro-caulk rows and point materials at plus ... go ahead and
-- delete the duro tech row."
--
-- Duro-Caulk (1116 / 1116B / 1114 / 1115) is the old product; Duro-Last's list and the owner's
-- inventory carry Duro-Caulk PLUS (1136 / 1137 / 1134 / 1135), same $10.20. The bid estimator
-- already prices caulk from the Plus rows (engine/accessories.ts sealantCalcByPart by Part #) and
-- marks the plain parts discontinued in the Sealants picker. The four plain rows go; the five
-- service materials that stocked from them stock from the Plus rows (a material keeps its own
-- cost; the row gives the unit, the pack and the item number, so each now shows 1134-1137).
-- No inventory entry ever named a plain row; bid accessory lines keep the price they were added at.
--
-- The Duro-Tech "Pitch Pan Filler (30/case or single)" row was the same tube as "Pitch Pocket
-- Filler (10.2 oz)" (same $10.70, same number 11222 — owner: one product). The Duro-Tech row and
-- its link go; 11222 stays on the 10.2 oz row.

update public.service_materials
set stock_row_label = replace(stock_row_label, 'Duro-Caulk - ', 'Duro-Caulk Plus - ')
where stock_screen_id = 'duro_last:sealants'
  and stock_row_label in ('Duro-Caulk - White', 'Duro-Caulk - Tan', 'Duro-Caulk - Gray', 'Duro-Caulk - Bronze');

delete from public.catalog_item_numbers
where screen_id = 'duro_last:sealants'
  and row_label in (
    'Duro-Caulk - White', 'Duro-Caulk - Tan', 'Duro-Caulk - Gray', 'Duro-Caulk - Bronze',
    'Duro-Tech TPO Pitch Pan Filler (30/case or single)');

update public.pricing_catalog c
set data = jsonb_set(c.data, '{rows}', coalesce((
  select jsonb_agg(e order by t.ord)
  from jsonb_array_elements(c.data->'rows') with ordinality as t(e, ord)
  where e->>'Description' not in (
    'Duro-Caulk - White', 'Duro-Caulk - Tan', 'Duro-Caulk - Gray', 'Duro-Caulk - Bronze',
    'Duro-Tech TPO Pitch Pan Filler (30/case or single)')), '[]'::jsonb))
where c.id = 'duro_last:sealants';
