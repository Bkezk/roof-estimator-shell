-- The families' term bar caulk priced per tube (owner, Oct 27): the bid counts caulk tubes from
-- the term bar footage (one per 12 ft) and routes them to these two rows, so the row price must
-- be a tube, not the pail / carton the sheet lists. Applied live 2026-10-27; idempotent.
update public.pricing_catalog set data = jsonb_set(data, '{rows}', (
  select jsonb_agg(case
    when r->>'Part #' = 'W563587031' then r || '{"Description":"Lap Sealant-HS Tubes (per tube; 28 cartridges/pail at $241, 560 lin ft/pail; the term bar caulk)","Price":8.61}'::jsonb
    else r end) from jsonb_array_elements(data->'rows') r))
where id = 'epdm:sealants';
update public.pricing_catalog set data = jsonb_set(data, '{rows}', (
  select jsonb_agg(case
    when r->>'Part #' = 'W56TPO3002' then r || '{"Description":"UltraPly TPO General Purpose Sealant - White (per tube; 25 tubes/ctn at $206, 50 ft/tube; the term bar caulk)","Price":8.24}'::jsonb
    else r end) from jsonb_array_elements(data->'rows') r))
where id = 'non_dl_tpo:sealants';
update public.catalog_item_numbers n set row_label = x.label, dl_description = x.label
from (values ('W563587031','epdm:sealants','Lap Sealant-HS Tubes (per tube; 28 cartridges/pail at $241, 560 lin ft/pail; the term bar caulk)'),
             ('W56TPO3002','non_dl_tpo:sealants','UltraPly TPO General Purpose Sealant - White (per tube; 25 tubes/ctn at $206, 50 ft/tube; the term bar caulk)')) x(item_no, screen_id, label)
where n.item_no = x.item_no and n.screen_id = x.screen_id;
