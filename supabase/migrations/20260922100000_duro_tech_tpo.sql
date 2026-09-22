-- Duro-Tech TPO (Duro-Last's TPO membrane) as roof system 6 — docs/legacy-money-parity.md §22.34.
-- NO legacy source: the legacy estimator knew five systems. Data is cloned from Duro-Tuff (the
-- nearest roll-goods, welded-seam system) with the owner's "Roof Membrane Bid Calculator
-- Reference" starting values (labor hours, deck multipliers, complexity, adhesive coverage) and
-- the Duro-Last price list (membrane $/sq ft). Every value is an estimating START to calibrate
-- on the admin screens. Idempotent.

insert into public.legacy_roof_system
  (roof_system_id, short_name, long_name, is_insulation, lap_over, needs_vents, mech_wall_fasteners, sort_order)
values (6, 'durotech', 'Duro-Tech TPO', 0, 6, 1, null, 6)
on conflict (roof_system_id) do nothing;

-- Labor combos. Mechanical: the guide's 24–30 h / 2,500 sq ft on a wood deck for a 10' roll at
-- "Open" complexity → base 27 h (the standard model's 10 h base is overridden per combo via
-- base_hours_per_2500); deck multipliers = the guide's table midpoints; roll-width and fastener
-- spacing multipliers copied from Duro-Tuff; thickness 45/60 = 1.0, 80 mil = 1.075 (guide:
-- "5–10% extra handling"). Complexity (guide): Open 1.00, Moderate 1.20–1.30, very cut-up
-- 1.40–1.60+ → 1.0 / 1.1 / 1.25 / 1.4 / 1.6 / 2.0 (default index 2 = Moderate 1.25).
-- Adhered: the guide's 30–36 h / 2,500 → 33 h = 13.2 h per 1,000 sq ft for the TPO bonding adhesive.
insert into public.rdl_combos (roof_system, attachment, formula, data, sort)
select * from (values
  ('Duro-Tech TPO','mechanical',
   'Mechanical Labor = 27 Hrs x Deck Type Multi x Roll Width Multi x Fastener Spacing Multi x Complexity x Thickness',
   '{"base": {"tab_or_width_label": "Width", "tab_value": 30, "tab_multiplier": 2.8},
     "base_hours_per_2500": 27,
     "deck_multipliers": {"Wood": 1, "Steel": 1.05, "Retrofit": 1.225, "Concrete": 1.325, "Gypsum": 1.225, "LWC/Steel": 1.225, "LWC/Concrete": 1.325, "LWC/Other": 1.225, "Tectum": 1.225, "Purlin": 1.05},
     "fastener_spacing_multipliers": [{"spacing_in": 24, "multiplier": 0.91}, {"spacing_in": 21, "multiplier": 0.96}, {"spacing_in": 18, "multiplier": 1}, {"spacing_in": 15, "multiplier": 1.04}, {"spacing_in": 12, "multiplier": 1.1}, {"spacing_in": 9, "multiplier": 1.21}, {"spacing_in": 6, "multiplier": 1.41}],
     "complexity_factors": [{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}],
     "sheet_size_multipliers": null,
     "thickness_multipliers": [{"mil": 45, "multiplier": 1}, {"mil": 60, "multiplier": 1}, {"mil": 80, "multiplier": 1.075}],
     "adhesive": null,
     "notes": "Duro-Tech TPO (no legacy source). Base 27 h / 2500 sq ft = midpoint of the Roof Membrane Bid Calculator Reference 24-30 h (mechanically fastened TPO, wood deck, 10 ft roll, Open complexity). Deck multipliers from the guide table midpoints; roll-width (2.6/1.3/1.0) and fastener-spacing multipliers copied from Duro-Tuff; complexity 1.0/1.1/1.25/1.4/1.6/2.0 (guide 1.00 / 1.20-1.30 / 1.40-1.60+); 80 mil +7.5% handling. Calibrate against company production history."}'::jsonb, 10),
  ('Duro-Tech TPO','adhesive',
   'Adhesive Labor = Base Labor x Complexity x Thickness',
   '{"base": null, "deck_multipliers": null, "fastener_spacing_multipliers": null,
     "complexity_factors": [{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}],
     "sheet_size_multipliers": null,
     "thickness_multipliers": [{"mil": 45, "multiplier": 1}, {"mil": 60, "multiplier": 1}, {"mil": 80, "multiplier": 1.075}],
     "adhesive": {"base_hours_per_1000_sqft_by_substrate": [{"substrate": "TPO Bonding Adhesive", "labor_per_1000_sqft": 13.2}]},
     "notes": "Duro-Tech TPO adhered (no legacy source). 13.2 h / 1000 sq ft = the guide 30-36 h / 2500 sq ft midpoint (33 h). Roll-width multipliers 2.6/1.3/1.0 apply as on Duro-Tuff. Calibrate."}'::jsonb, 11)
) v(roof_system, attachment, formula, data, sort)
where not exists (select 1 from public.rdl_combos c where c.roof_system = 'Duro-Tech TPO');

-- The TPO bonding adhesive (the price list carries only spray guns / hoses / primer under "TPO
-- Adhesives" — the pail itself is not on this sheet, so price 0 until the owner enters it).
insert into public.legacy_adhesive
  (adhesive_id, short_name, long_name, part_number, price, unit_type, field_spacing_in, perim_spacing_in, used_with_wall)
values (11, 'tpobonding', 'TPO Bonding Adhesive', null, 0, '5-gal. Pail', -1, -1, 1)
on conflict (adhesive_id) do nothing;

-- Coverage (guide: ~60 sq ft/gal finished ⇒ ~300 sq ft per 5-gal pail) on every deck, over the
-- board groups a membrane adheres to, and on parapet walls; tapered / crickets groups = 0 (quote).
insert into public.adhesive_coverage_deck (roof_system_id, adhesive_id, deck_type_id, coverage_sqft, default_value, custom_value)
select 6, 11, d, 300, 0, 0 from unnest(array[1,2,3,4,5,6,7,8,9,10]) d
where not exists (select 1 from public.adhesive_coverage_deck where roof_system_id = 6);
insert into public.adhesive_coverage_underlayment (roof_system_id, adhesive_id, underlayment_group_id, coverage_sqft, default_value, custom_value)
select 6, 11, g.id, g.cov, 0, 0 from (values (2,300),(3,300),(4,300),(7,300),(8,300),(17,300),(16,0),(18,0),(19,0)) g(id, cov)
where not exists (select 1 from public.adhesive_coverage_underlayment where roof_system_id = 6);
insert into public.adhesive_wall_coverage (roof_system_id, adhesive_id, coverage_sqft)
select 6, 11, 300 where not exists (select 1 from public.adhesive_wall_coverage where roof_system_id = 6);

-- Roll widths (Duro-Tech TPO ships 30" / 60" / 120" × 100') and their labor multipliers, the
-- mechanical width bands, the pull-test → spacing table and the adhered sheet multiplier — all
-- copied from Duro-Tuff (roof_system_id 3), flagged for verification against Duro-Last's TPO
-- approved patterns.
insert into public.rdl_roll_good_width (roof_system_id, width_in, multiplier, custom_multiplier)
select 6, width_in, multiplier, custom_multiplier from public.rdl_roll_good_width where roof_system_id = 3
  and not exists (select 1 from public.rdl_roll_good_width where roof_system_id = 6);
insert into public.mech_tab_multi (roof_system_id, tab_spacing, multiplier, custom_multi)
select 6, tab_spacing, multiplier, custom_multi from public.mech_tab_multi where roof_system_id = 3
  and not exists (select 1 from public.mech_tab_multi where roof_system_id = 6);
insert into public.mech_fastener_lookup (roof_system_id, membrane_thickness, design_table, tab_spacing, pull_test, field_spacing, perim_spacing, corner_spacing)
select 6, membrane_thickness, design_table, tab_spacing, pull_test, field_spacing, perim_spacing, corner_spacing
  from public.mech_fastener_lookup where roof_system_id = 3
  and not exists (select 1 from public.mech_fastener_lookup where roof_system_id = 6);
insert into public.rdl_adhered_sheet_multi (roof_system_id, sheet_label, adhesive_id, multiplier, custom_multiplier)
select 6, 'Roll Good', 11, 1, 0
where not exists (select 1 from public.rdl_adhered_sheet_multi where roof_system_id = 6);

-- Membrane $/sq ft from the Duro-Last price list (roll price ÷ roll area, identical across widths):
-- 45 mil white 0.75; 60 mil white / tan / gray 0.84; 80 mil white 1.30. Flat-family rows like
-- "Duro-Tuff - 50" (first numeric colour cell is the price).
update public.pricing_catalog p
set data = jsonb_set(p.data, '{rows}', (p.data->'rows')
  || jsonb_build_object('Description','Duro-Tech TPO - 45','_locked',true,'White',0.75,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null)
  || jsonb_build_object('Description','Duro-Tech TPO - 60','_locked',true,'White',0.84,'Tan',0.84,'Gray',0.84,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null)
  || jsonb_build_object('Description','Duro-Tech TPO - 80','_locked',true,'White',1.30,'Tan',null,'Gray',null,'Dark Gray',null,'Terra Cotta',null,'Rock-Ply',null))
where p.id = 'duro_last:duro_last_membrane'
  and not exists (select 1 from jsonb_array_elements(p.data->'rows') r where r->>'Description' like 'Duro-Tech TPO - %');
