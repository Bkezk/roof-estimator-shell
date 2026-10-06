-- Service materials that bids use too (owner, Oct 6: "the service only items are sometimes used
-- as a bid items. ISO is underlayment, epdm, TPO are Roofing Membranes, Acetone is cleaning
-- supplies"). On top of 20261006130000_service_materials.sql:
--
-- 1. Same stock as the bid catalog, where the catalog has the item:
--    - 045 EPDM → Duro-Last Membrane › EPDM Rubber - 45 › Black (sq ft, as CenterPoint).
--    - TPO 60 mil white → Duro-Last Membrane › Non-DL TPO - 60 › White (sq ft).
--    - ISO 1", 1 1/2", 2", 3" → Underlayment › <n>" ISO, which bids count by the sq ft while
--      CenterPoint prices a board: stock_per_unit = 32 (a 4' x 8' board; CenterPoint's board
--      prices are 32–40 × the catalog's sq-ft cost), so a tech takes 2 boards = 64 sq ft and
--      the ticket bills 2 boards. Tapered ISO (A, AA, B, C, X, Y, Q) and 2.2" / 2.6" have no
--      catalog row and stay their own stock.
-- 2. A group (category) for every material still stocked on its own, so the Inventory page
--    shows ISO under Underlayment, Acetone under Cleaning Supplies … instead of one "Service
--    materials" heap. A material that shares bid stock shows under the catalog's own group.
-- Idempotent.
alter table public.service_materials add column if not exists category text;
alter table public.service_materials add column if not exists stock_per_unit numeric
  check (stock_per_unit is null or stock_per_unit > 0);
alter table public.service_materials add column if not exists piece_name text;
comment on column public.service_materials.category is
  'Inventory group of a material stocked on its own (Underlayment, Sealants, Cleaning Supplies …).';
comment on column public.service_materials.stock_per_unit is
  'Stock units in one of its units when they differ (an ISO board = 32 sq ft of the catalog''s ISO).';
comment on column public.service_materials.piece_name is
  'What one unit is called when stock_per_unit is set ("board").';

create or replace view public.service_materials_catalog
  with (security_invoker = false, security_barrier = true) as
  select m.id, m.name, m.unit, m.sort, m.active,
         m.stock_screen_id, m.stock_row_label, m.stock_price_col,
         m.category, m.stock_per_unit, m.piece_name
    from public.service_materials m
   where public.has_access('service') or public.has_access('inventory')
      or public.has_access('estimate');
revoke all on public.service_materials_catalog from public, anon, authenticated;
grant select on public.service_materials_catalog to authenticated;

-- 1. The bid-catalog twins (only while still unmatched).
update public.service_materials m
   set stock_screen_id = v.screen, stock_row_label = v.row_label, stock_price_col = v.col,
       stock_per_unit = v.per, piece_name = v.piece
  from (values
    ('045 EPDM 10''x100"', 'duro_last:duro_last_membrane', 'EPDM Rubber - 45', 'Black', null::numeric, null::text),
    ('TPO 60 mil white membrane', 'duro_last:duro_last_membrane', 'Non-DL TPO - 60', 'White', null, null),
    ('ISO Insulation 1"', 'duro_last:underlayment', '1" ISO', 'Cost/Sq. Ft.', 32, 'board'),
    ('ISO Insulation 1.5"', 'duro_last:underlayment', '1 1/2" ISO', 'Cost/Sq. Ft.', 32, 'board'),
    ('ISO Insulation 2"', 'duro_last:underlayment', '2" ISO', 'Cost/Sq. Ft.', 32, 'board'),
    ('ISO Insulation 3"', 'duro_last:underlayment', '3" ISO', 'Cost/Sq. Ft.', 32, 'board')
  ) as v(name, screen, row_label, col, per, piece)
 where m.name = v.name and m.stock_screen_id is null;

-- 2. Groups for the materials stocked on their own (only where none is set).
update public.service_materials m
   set category = v.category
  from (values
    ('ISO Insulation 2.2"', 'Underlayment'), ('ISO Insulation 2.6"', 'Underlayment'),
    ('ISO Insulation A', 'Underlayment'), ('ISO Insulation AA', 'Underlayment'),
    ('ISO Insulation B', 'Underlayment'), ('ISO Insulation C', 'Underlayment'),
    ('ISO Insulation X', 'Underlayment'), ('ISO Insulation Y', 'Underlayment'),
    ('ISO Insulatin Q', 'Underlayment'), ('Fan Fold EPS', 'Underlayment'),
    ('3"x100'' Quick Seam Splice Tape', 'Membrane Accs'),
    ('5"x100'' Quick Seam Flashing W56RAC1615', 'Membrane Accs'),
    ('9"x50'' Quick Seam Flashing', 'Membrane Accs'),
    ('UltraPly TPO 5-1/2" x 100'' QS Flashing', 'Membrane Accs'),
    ('EPDM Corner1646', 'Membrane Accs'), ('EPDM joint cover 1644', 'Membrane Accs'),
    ('TPO T-Joint Covers', 'Membrane Accs'), ('Uniflex Bonding Tape', 'Membrane Accs'),
    ('Patch - 6x6', 'Membrane Accs'),
    ('All Purpose Sealant', 'Sealants'), ('All-Weather Roof Cement', 'Sealants'),
    ('All-Weather Roof Cement Caulk', 'Sealants'), ('Duro-Caulk Advanced White', 'Sealants'),
    ('Duro-Mastic Strip Mastic', 'Sealants'), ('Firestone EPDM Lap Sealant / Caulk', 'Sealants'),
    ('Karnak 97', 'Sealants'), ('Solar Seal', 'Sealants'), ('Uniflex One Flash Sealant', 'Sealants'),
    ('All-Weather Cement Mesh', 'Sealants'),
    ('Acetone', 'Cleaning Supplies'), ('Cleaning Supplies', 'Cleaning Supplies'),
    ('Splice Wash', 'Cleaning Supplies'),
    ('Quick Prime 1 Gal', 'Adhesives'),
    ('DL- 1 1/2" P-3 Head Screw', 'Fasteners & Bits'), ('DL- 4" P-3 Head Screw', 'Fasteners & Bits'),
    ('Drive-Pin Anchor', 'Fasteners & Bits'), ('Rivets', 'Fasteners & Bits'),
    ('Screw 1-1/2"Oversized Galvanised Metal/Metal', 'Fasteners & Bits'),
    ('Screw 1-1/4"Galvanized Metal/Metal', 'Fasteners & Bits'),
    ('Screw Self Tapping with Washer 3/16x7/8', 'Fasteners & Bits'),
    ('Firestone Aluminum Term Bar', 'Termination Bars'), ('Metal Batten Strip', 'Termination Bars'),
    ('Pipe Boot 4 3/4" -10"', 'Pipe Stacks'),
    ('UVSL. TPO Tan 1"-6" Pipe Boot with Clamps', 'Pipe Stacks'),
    ('UVSL. TPO White 1"-6" Pipe Boot w/ clamp', 'Pipe Stacks'),
    ('Duct Tape', 'Misc'), ('misc. item', 'Misc'), ('Misc. Materials', 'Misc')
  ) as v(name, category)
 where m.name = v.name and m.stock_screen_id is null and m.category is null;
