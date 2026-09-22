-- Duro-Tech TPO adhesives per the owner's bid-calculator guide (page 1, §5): TECH-Bond TPO
-- Bonding Adhesive, TECH-Bond TPO LVOC Bonding Adhesive, TECH-Bond TPO Spray Adhesive. Coverage
-- starting values from the guide (bonding ≈ 300 sq ft per 5-gal pail; spray ≈ 1,000 sq ft per
-- cylinder) — keep editable on Admin › Adhesives. Prices 0 until entered (not on the price list).
-- docs/legacy-money-parity.md §22.34.
update public.legacy_adhesive
   set long_name = 'TECH-Bond TPO Bonding Adhesive', short_name = 'techbondtpo'
 where adhesive_id = 11 and long_name = 'TPO Bonding Adhesive';

insert into public.legacy_adhesive
  (adhesive_id, short_name, long_name, part_number, price, unit_type, field_spacing_in, perim_spacing_in, used_with_wall)
values
  (12, 'techbondtpolvoc', 'TECH-Bond TPO LVOC Bonding Adhesive', null, 0, '5-gal. Pail', -1, -1, 1),
  (13, 'techbondtpospray', 'TECH-Bond TPO Spray Adhesive', null, 0, 'Cylinder', -1, -1, 1)
on conflict (adhesive_id) do nothing;

insert into public.adhesive_coverage_deck (roof_system_id, adhesive_id, deck_type_id, coverage_sqft, default_value, custom_value)
select 6, a.id, d, a.cov, 0, 0
  from (values (12, 300), (13, 1000)) a(id, cov), unnest(array[1,2,3,4,5,6,7,8,9,10]) d
 where not exists (select 1 from public.adhesive_coverage_deck where roof_system_id = 6 and adhesive_id = a.id);
insert into public.adhesive_coverage_underlayment (roof_system_id, adhesive_id, underlayment_group_id, coverage_sqft, default_value, custom_value)
select 6, a.id, g.id, case when g.cov = 0 then 0 else a.cov end, 0, 0
  from (values (12, 300), (13, 1000)) a(id, cov),
       (values (2,300),(3,300),(4,300),(7,300),(8,300),(17,300),(16,0),(18,0),(19,0)) g(id, cov)
 where not exists (select 1 from public.adhesive_coverage_underlayment where roof_system_id = 6 and adhesive_id = a.id);
insert into public.adhesive_wall_coverage (roof_system_id, adhesive_id, coverage_sqft)
select 6, a.id, a.cov from (values (12, 300), (13, 1000)) a(id, cov)
 where not exists (select 1 from public.adhesive_wall_coverage where roof_system_id = 6 and adhesive_id = a.id);
insert into public.rdl_adhered_sheet_multi (roof_system_id, sheet_label, adhesive_id, multiplier, custom_multiplier)
select 6, 'Roll Good', a.id, 1, 0 from (values (12), (13)) a(id)
 where not exists (select 1 from public.rdl_adhered_sheet_multi where roof_system_id = 6 and adhesive_id = a.id);

-- The adhered combo's base labor per adhesive (guide 30–36 h / 2,500 → 13.2 h / 1,000 for each).
update public.rdl_combos
   set data = jsonb_set(data, '{adhesive,base_hours_per_1000_sqft_by_substrate}',
     '[{"substrate": "TECH-Bond TPO Bonding Adhesive", "labor_per_1000_sqft": 13.2},
       {"substrate": "TECH-Bond TPO LVOC Bonding Adhesive", "labor_per_1000_sqft": 13.2},
       {"substrate": "TECH-Bond TPO Spray Adhesive", "labor_per_1000_sqft": 13.2}]'::jsonb)
 where roof_system = 'Duro-Tech TPO' and attachment = 'adhesive';
