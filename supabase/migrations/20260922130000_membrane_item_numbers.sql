-- Duro-Last item numbers for the membrane price matrix, from the Duro-Last price list's
-- "Duro-Last Roll Goods" and "Duro-Tech (TPO)" categories (the workbook's "Duro-Last Membrane"
-- tab carries NO item numbers — it prices per sq ft by description / mil / colour). Each colour
-- cell of a Roll Goods row gets its roll item numbers (both roll widths); the Price List Import
-- converts a roll price to $/sq ft (roll $ ÷ roll area) before writing the cell. Tabs / Parapets
-- rows are prefabricated (no list item), Duro-Bond / Duro-Tuff / Duro-Fleece (PVC) are not on
-- this list. docs/legacy-money-parity.md §22.36. Idempotent.
insert into public.catalog_item_numbers (item_no, screen_id, row_label, price_col, dl_description)
values
  ('55701', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'White', 'DL 40MIL WHT 5''4"X100'''),
  ('55703', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'White', 'DL 40MIL WHT 2''8"X100'''),
  ('55704', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'Tan', 'MATL 40MIL TAN 64X100'' DL'),
  ('55705', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'Tan', 'MATL 40MILTAN 32X100'' DL'),
  ('55706', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'Gray', 'MATL 40MIL GRY 64X100'' DL'),
  ('55707', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'Gray', 'MATL 40MIL GRY 32X100'' DL'),
  ('55708', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'Dark Gray', 'MATL 40MIL D/GRY 64X100'' DL'),
  ('55709', 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'Dark Gray', 'MATL 40MIL D/GRY 32X100'' DL'),
  ('55710', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'White', 'DL 50MIL WHT 5''4"X100'''),
  ('55712', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'White', 'DL 50MIL WHT 2''8"X100'''),
  ('55713', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Tan', 'MATL 50MIL TAN 64X100'' DL'),
  ('55714', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Tan', 'MATL 50MIL TAN 32X100'' DL'),
  ('55715', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Gray', 'MATL 50MIL GRY 64X100'' DL'),
  ('55716', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Gray', 'MATL 50MIL GRY 32X100'' DL'),
  ('55717', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Dark Gray', 'MATL 50MIL D/GRY 64X100'' DL'),
  ('55718', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Dark Gray', 'MATL 50MIL D/GRY 32X100'' DL'),
  ('55719', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Terra Cotta', 'MATL 50MIL TERRA COTTA 64X100'''),
  ('55720', 'duro_last:duro_last_membrane', 'Duro-Last - 50mil Roll Goods', 'Terra Cotta', 'MATL 50MIL TERRA COTTA 32X100'''),
  ('55721', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'White', 'DL 60MIL WHT 5''4"X100'''),
  ('55723', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'White', 'DL 60MIL WHT 2''8"X100'''),
  ('55724', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'Tan', 'MATL 60MIL TAN 64X100'' DL'),
  ('55725', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'Tan', 'MATL 60MIL TAN 32X100'' DL'),
  ('55726', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'Gray', 'MATL 60MIL GRY 64X100'' DL'),
  ('55727', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'Gray', 'MATL 60MIL GRY 32X100'' DL'),
  ('55728', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'Dark Gray', 'MATL 60MIL D/GRY 64X100'' DL'),
  ('55729', 'duro_last:duro_last_membrane', 'Duro-Last - 60mil Roll Goods', 'Dark Gray', 'MATL 60MIL D/GRY 32X100'' DL'),
  ('44101', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 45', 'White', 'D-TECH TPO WHT 45 MIL 30x1200'),
  ('44102', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 45', 'White', 'D-TECH TPO WHT 45 MIL 60x1200'),
  ('44103', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 45', 'White', 'D-TECH TPO WHT 45 MIL 120x1200'),
  ('44113', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'White', 'D-TECH TPO WHT 60 MIL 30x1200'),
  ('44114', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'White', 'D-TECH TPO WHT 60 MIL 60x1200'),
  ('44115', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'White', 'D-TECH TPO WHT 60 MIL 120x1200'),
  ('44117', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'Tan', 'D-TECH TPO TAN 60 MIL 30x1200'),
  ('44118', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'Tan', 'D-TECH TPO TAN 60 MIL 60x1200'),
  ('44119', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'Tan', 'D-TECH TPO TAN 60 MIL 120x1200'),
  ('44121', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'Gray', 'D-TECH TPO GRY 60 MIL 30x1200'),
  ('44122', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'Gray', 'D-TECH TPO GRY 60 MIL 60x1200'),
  ('44123', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 60', 'Gray', 'D-TECH TPO GRY 60 MIL 120x1200'),
  ('44125', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 80', 'White', 'D-TECH TPO WHT 80 MIL 30x1200'),
  ('44126', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 80', 'White', 'D-TECH TPO WHT 80 MIL 60x1200'),
  ('44127', 'duro_last:duro_last_membrane', 'Duro-Tech TPO - 80', 'White', 'D-TECH TPO WHT 80 MIL 120x1200')
on conflict (item_no, screen_id, row_label, price_col) do nothing;
