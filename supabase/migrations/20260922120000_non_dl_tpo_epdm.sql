-- Non-DL TPO (generic manufacturer) as roof system 7 and EPDM Rubber as roof system 8 — the
-- owner's "Roof Membrane Bid Calculator Reference" sections B and C. NO legacy source. Membrane
-- prices are NOT on the Duro-Last price list: the matrix rows are created blank for the admin to
-- fill (the engine warns "No … membrane price" until then). docs/legacy-money-parity.md §22.35.

insert into public.legacy_roof_system
  (roof_system_id, short_name, long_name, is_insulation, lap_over, needs_vents, mech_wall_fasteners, sort_order)
values
  (7, 'ndltpo', 'Non-DL TPO', 0, 6, 1, null, 7),
  (8, 'epdm', 'EPDM Rubber', 0, 3, 0, null, 8)
on conflict (roof_system_id) do nothing;

-- Labor combos (guide §7): Non-DL TPO 25–30 h mech → 27.5, 32–38 adhered → 35 (14 h / 1,000);
-- EPDM 28–34 mech → 31, 30–38 adhered → 34 (13.6 h / 1,000). Deck multipliers = guide midpoints;
-- complexity 1.0 / 1.1 / 1.25 / 1.4 / 1.6 / 2.0; TPO 80 mil +7.5%; EPDM 75 mil +5%, 90 mil +10%
-- (guide: "large sheets … heavier"). Width bands: TPO copies Duro-Tuff (30/60/120); EPDM sheets
-- 10' / 20' (120" / 240") with 240" at 0.85 (guide: wider sheets, fewer seams — a start).
insert into public.rdl_combos (roof_system, attachment, formula, data, sort)
select * from (values
  ('Non-DL TPO','mechanical',
   'Mechanical Labor = 27.5 Hrs x Deck Type Multi x Roll Width Multi x Fastener Spacing Multi x Complexity x Thickness',
   '{"base": {"tab_or_width_label": "Width", "tab_value": 30, "tab_multiplier": 2.8}, "base_hours_per_2500": 27.5,
     "deck_multipliers": {"Wood": 1, "Steel": 1.05, "Retrofit": 1.225, "Concrete": 1.325, "Gypsum": 1.225, "LWC/Steel": 1.225, "LWC/Concrete": 1.325, "LWC/Other": 1.225, "Tectum": 1.225, "Purlin": 1.05},
     "fastener_spacing_multipliers": [{"spacing_in": 24, "multiplier": 0.91}, {"spacing_in": 21, "multiplier": 0.96}, {"spacing_in": 18, "multiplier": 1}, {"spacing_in": 15, "multiplier": 1.04}, {"spacing_in": 12, "multiplier": 1.1}, {"spacing_in": 9, "multiplier": 1.21}, {"spacing_in": 6, "multiplier": 1.41}],
     "complexity_factors": [{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}],
     "sheet_size_multipliers": null,
     "thickness_multipliers": [{"mil": 45, "multiplier": 1}, {"mil": 60, "multiplier": 1}, {"mil": 80, "multiplier": 1.075}],
     "adhesive": null,
     "notes": "Non-DL TPO, generic manufacturer (no legacy source). Base 27.5 h / 2500 sq ft = guide 25-30 h midpoint (mechanically fastened, wood, 10 ft roll, Open). Deck multipliers = guide midpoints; roll-width and fastener-spacing multipliers copied from Duro-Tuff; complexity guide 1.00 / 1.20-1.30 / 1.40-1.60+; 80 mil +7.5%. Manufacturer-specific fastening patterns and accessories: adjust per assembly."}'::jsonb, 12),
  ('Non-DL TPO','adhesive',
   'Adhesive Labor = Base Labor x Complexity x Thickness',
   '{"base": null, "deck_multipliers": null, "fastener_spacing_multipliers": null,
     "complexity_factors": [{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}],
     "sheet_size_multipliers": null,
     "thickness_multipliers": [{"mil": 45, "multiplier": 1}, {"mil": 60, "multiplier": 1}, {"mil": 80, "multiplier": 1.075}],
     "adhesive": {"base_hours_per_1000_sqft_by_substrate": [{"substrate": "Non-DL TPO Bonding Adhesive", "labor_per_1000_sqft": 14}, {"substrate": "Non-DL TPO Spray Adhesive", "labor_per_1000_sqft": 14}]},
     "notes": "Non-DL TPO adhered: 14 h / 1000 sq ft = guide 32-38 h / 2500 midpoint (35 h). Calibrate."}'::jsonb, 13),
  ('EPDM Rubber','mechanical',
   'Mechanical Labor = 31 Hrs x Deck Type Multi x Sheet Width Multi x Fastener Spacing Multi x Complexity x Thickness',
   '{"base": {"tab_or_width_label": "Width", "tab_value": 120, "tab_multiplier": 1}, "base_hours_per_2500": 31,
     "deck_multipliers": {"Wood": 1, "Steel": 1.05, "Retrofit": 1.225, "Concrete": 1.325, "Gypsum": 1.225, "LWC/Steel": 1.225, "LWC/Concrete": 1.325, "LWC/Other": 1.225, "Tectum": 1.225, "Purlin": 1.05},
     "fastener_spacing_multipliers": [{"spacing_in": 24, "multiplier": 0.91}, {"spacing_in": 21, "multiplier": 0.96}, {"spacing_in": 18, "multiplier": 1}, {"spacing_in": 15, "multiplier": 1.04}, {"spacing_in": 12, "multiplier": 1.1}, {"spacing_in": 9, "multiplier": 1.21}, {"spacing_in": 6, "multiplier": 1.41}],
     "complexity_factors": [{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}],
     "sheet_size_multipliers": null,
     "thickness_multipliers": [{"mil": 45, "multiplier": 1}, {"mil": 60, "multiplier": 1}, {"mil": 75, "multiplier": 1.05}, {"mil": 90, "multiplier": 1.1}],
     "adhesive": null,
     "notes": "EPDM Rubber (no legacy source). Base 31 h / 2500 sq ft = guide 28-34 h midpoint (mechanically fastened EPDM, wood). 10 ft sheet = 1.0, 20 ft sheet = 0.85 (start). Deck multipliers = guide midpoints; fastener-spacing multipliers copied from the Duro-Last set; complexity guide 1.00 / 1.25 / 1.50+; 75 mil +5%, 90 mil +10%. Manufacturer securement systems (screws/plates, RUSS) vary: adjust."}'::jsonb, 14),
  ('EPDM Rubber','adhesive',
   'Adhesive Labor = Base Labor x Complexity x Thickness',
   '{"base": null, "deck_multipliers": null, "fastener_spacing_multipliers": null,
     "complexity_factors": [{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}],
     "sheet_size_multipliers": null,
     "thickness_multipliers": [{"mil": 45, "multiplier": 1}, {"mil": 60, "multiplier": 1}, {"mil": 75, "multiplier": 1.05}, {"mil": 90, "multiplier": 1.1}],
     "adhesive": {"base_hours_per_1000_sqft_by_substrate": [{"substrate": "EPDM Bonding Adhesive", "labor_per_1000_sqft": 13.6}, {"substrate": "EPDM Spray Adhesive", "labor_per_1000_sqft": 13.6}]},
     "notes": "EPDM adhered: 13.6 h / 1000 sq ft = guide 30-38 h / 2500 midpoint (34 h). Calibrate."}'::jsonb, 15)
) v(roof_system, attachment, formula, data, sort)
where not exists (select 1 from public.rdl_combos c where c.roof_system in ('Non-DL TPO', 'EPDM Rubber'));

-- Adhesives (guide §5): bonding adhesive ≈ 300 sq ft per 5-gal pail; spray ≈ 1,000 sq ft per
-- cylinder. Prices 0 until entered on Admin › Adhesives.
insert into public.legacy_adhesive
  (adhesive_id, short_name, long_name, part_number, price, unit_type, field_spacing_in, perim_spacing_in, used_with_wall)
values
  (14, 'ndltpobond',  'Non-DL TPO Bonding Adhesive', null, 0, '5-gal. Pail', -1, -1, 1),
  (15, 'ndltpospray', 'Non-DL TPO Spray Adhesive',   null, 0, 'Cylinder',    -1, -1, 1),
  (16, 'epdmbond',    'EPDM Bonding Adhesive',        null, 0, '5-gal. Pail', -1, -1, 1),
  (17, 'epdmspray',   'EPDM Spray Adhesive',          null, 0, 'Cylinder',    -1, -1, 1)
on conflict (adhesive_id) do nothing;

with a(rs, id, cov) as (values (7, 14, 300), (7, 15, 1000), (8, 16, 300), (8, 17, 1000))
insert into public.adhesive_coverage_deck (roof_system_id, adhesive_id, deck_type_id, coverage_sqft, default_value, custom_value)
select a.rs, a.id, d, a.cov, 0, 0 from a, unnest(array[1,2,3,4,5,6,7,8,9,10]) d
 where not exists (select 1 from public.adhesive_coverage_deck x where x.roof_system_id = a.rs and x.adhesive_id = a.id);
with a(rs, id, cov) as (values (7, 14, 300), (7, 15, 1000), (8, 16, 300), (8, 17, 1000))
insert into public.adhesive_coverage_underlayment (roof_system_id, adhesive_id, underlayment_group_id, coverage_sqft, default_value, custom_value)
select a.rs, a.id, g.id, case when g.quote then 0 else a.cov end, 0, 0
  from a, (values (2,false),(3,false),(4,false),(7,false),(8,false),(17,false),(16,true),(18,true),(19,true)) g(id, quote)
 where not exists (select 1 from public.adhesive_coverage_underlayment x where x.roof_system_id = a.rs and x.adhesive_id = a.id);
with a(rs, id, cov) as (values (7, 14, 300), (7, 15, 1000), (8, 16, 300), (8, 17, 1000))
insert into public.adhesive_wall_coverage (roof_system_id, adhesive_id, coverage_sqft)
select a.rs, a.id, a.cov from a
 where not exists (select 1 from public.adhesive_wall_coverage x where x.roof_system_id = a.rs and x.adhesive_id = a.id);
with a(rs, id) as (values (7, 14), (7, 15), (8, 16), (8, 17))
insert into public.rdl_adhered_sheet_multi (roof_system_id, sheet_label, adhesive_id, multiplier, custom_multiplier)
select a.rs, 'Roll Good', a.id, 1, 0 from a
 where not exists (select 1 from public.rdl_adhered_sheet_multi x where x.roof_system_id = a.rs and x.adhesive_id = a.id);

-- Widths / bands / pull-test tables. Non-DL TPO copies Duro-Tuff (rs 3); EPDM: 120" ×1.0 and
-- 240" ×0.85, and the Duro-Tuff 120" pull-test rows serve both EPDM widths (flagged: EPDM
-- securement is manufacturer-specific).
insert into public.rdl_roll_good_width (roof_system_id, width_in, multiplier, custom_multiplier)
select 7, width_in, multiplier, custom_multiplier from public.rdl_roll_good_width where roof_system_id = 3
  and not exists (select 1 from public.rdl_roll_good_width where roof_system_id = 7);
insert into public.rdl_roll_good_width (roof_system_id, width_in, multiplier, custom_multiplier)
select 8, w, m, 0 from (values (120, 1.0), (240, 0.85)) v(w, m)
 where not exists (select 1 from public.rdl_roll_good_width where roof_system_id = 8);
insert into public.mech_tab_multi (roof_system_id, tab_spacing, multiplier, custom_multi)
select 7, tab_spacing, multiplier, custom_multi from public.mech_tab_multi where roof_system_id = 3
  and not exists (select 1 from public.mech_tab_multi where roof_system_id = 7);
insert into public.mech_tab_multi (roof_system_id, tab_spacing, multiplier, custom_multi)
select 8, w, m, 0 from (values (120, 1.0), (240, 0.85)) v(w, m)
 where not exists (select 1 from public.mech_tab_multi where roof_system_id = 8);
insert into public.mech_fastener_lookup (roof_system_id, membrane_thickness, design_table, tab_spacing, pull_test, field_spacing, perim_spacing, corner_spacing)
select 7, membrane_thickness, design_table, tab_spacing, pull_test, field_spacing, perim_spacing, corner_spacing
  from public.mech_fastener_lookup where roof_system_id = 3
  and not exists (select 1 from public.mech_fastener_lookup where roof_system_id = 7);
insert into public.mech_fastener_lookup (roof_system_id, membrane_thickness, design_table, tab_spacing, pull_test, field_spacing, perim_spacing, corner_spacing)
select 8, membrane_thickness, design_table, w, pull_test, field_spacing, perim_spacing, corner_spacing
  from public.mech_fastener_lookup, unnest(array[120, 240]) w
 where roof_system_id = 3 and tab_spacing = 120
   and not exists (select 1 from public.mech_fastener_lookup where roof_system_id = 8);

-- Membrane matrix: a "Black" colour column (EPDM) and blank price rows for the admin to fill.
update public.pricing_catalog p
   set data = jsonb_set(p.data, '{columns}', (p.data->'columns') || '["Black"]'::jsonb)
 where p.id = 'duro_last:duro_last_membrane' and not (p.data->'columns' ? 'Black');
update public.pricing_catalog p
set data = jsonb_set(p.data, '{rows}', (p.data->'rows')
  || jsonb_build_object('Description','Non-DL TPO - 45','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null)
  || jsonb_build_object('Description','Non-DL TPO - 60','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null)
  || jsonb_build_object('Description','Non-DL TPO - 80','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null)
  || jsonb_build_object('Description','EPDM Rubber - 45','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null)
  || jsonb_build_object('Description','EPDM Rubber - 60','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null)
  || jsonb_build_object('Description','EPDM Rubber - 75','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null)
  || jsonb_build_object('Description','EPDM Rubber - 90','_locked',true,'White',null,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null,'Black',null))
where p.id = 'duro_last:duro_last_membrane'
  and not exists (select 1 from jsonb_array_elements(p.data->'rows') r where r->>'Description' like 'EPDM Rubber - %');
