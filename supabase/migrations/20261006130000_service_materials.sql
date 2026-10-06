-- Service material pricing (owner, Oct 6: "currently the materials pull from the bid estimate
-- pricing page, we need to separate the two. Do not change anything on the bid estimate pricing
-- side … they price differently"; "replace them with the materials available in centerpoint …
-- on the setup page have a tab that says material pricing and seed it with the prices").
--
-- service_materials is the price list a repair ticket bills from: CenterPoint's Material Library
-- as its "Add Material" picker showed it on Oct 6 — 133 materials, name, unit and cost, loaded
-- exactly as is. `cost` is what the material costs JBK; the invoice bills cost × (1 + markup)
-- (service_settings.material_markup, 75 %), as CenterPoint did (Quick Prime $54.35 → $95.11).
-- pricing_catalog (Estimate Pricing) is not touched.
--
-- Stock stays one ledger (inventory_movements, quantities only). A material that is the same
-- physical item as a bid-catalog product (79 of the 133: DL pipe stacks, drain boots, CDR rings,
-- Duro-Caulk, corners, term bar, DL membrane …) points at that catalog cell (stock_*), so bid
-- leftovers and repair purchases are one count — the owner: auto-matched, no "same stock as"
-- control for users. The rest (54: ISO, EPDM, TPO, Quick Seam, Acetone …) are stocked under
-- screen 'service' with the material's name as the row, so the Inventory page carries them too;
-- renaming one renames its stock entries (trigger below). Idempotent.
create table if not exists public.service_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  unit text not null check (length(btrim(unit)) > 0),
  cost numeric(12,4) not null default 0 check (cost >= 0),
  sort integer not null default 0,
  active boolean not null default true,
  stock_screen_id text,
  stock_row_label text,
  stock_price_col text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_materials_stock_link check (
    (stock_screen_id is null and stock_row_label is null and stock_price_col is null)
    or (stock_screen_id is not null and stock_row_label is not null and stock_price_col is not null)
  )
);
comment on table public.service_materials is
  'Service (repair ticket) material price list: cost per unit; invoices bill cost × (1 + markup).';
comment on column public.service_materials.stock_screen_id is
  'Set when the material is the same stock as a bid-catalog cell (auto-matched); null = stocked as screen ''service'', row = name.';
-- A service-only material's name is its stock key: one per name.
create unique index if not exists service_materials_own_name_idx
  on public.service_materials (name) where stock_screen_id is null;

alter table public.service_materials enable row level security;
-- Prices are the office's (as repair_templates_read): not a technician's.
drop policy if exists service_materials_read on public.service_materials;
create policy service_materials_read on public.service_materials for select to authenticated
  using (public.is_admin() or public.is_manager() or public.is_sales_pm()
         or (not public.is_technician()
             and (public.has_access('service') or public.has_access('estimate'))));
drop policy if exists service_materials_write on public.service_materials;
create policy service_materials_write on public.service_materials for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());

-- The names without the cost: what a technician's truck list and the Inventory page read.
create or replace view public.service_materials_catalog
  with (security_invoker = false, security_barrier = true) as
  select m.id, m.name, m.unit, m.sort, m.active,
         m.stock_screen_id, m.stock_row_label, m.stock_price_col
    from public.service_materials m
   where public.has_access('service') or public.has_access('inventory')
      or public.has_access('estimate');
revoke all on public.service_materials_catalog from public, anon, authenticated;
grant select on public.service_materials_catalog to authenticated;

-- Renaming a service-only material renames its stock entries (the name is the stock row).
create or replace function public.service_material_renamed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if old.stock_screen_id is null and new.stock_screen_id is null and new.name <> old.name then
    update public.inventory_movements
       set row_label = new.name
     where screen_id = 'service' and row_label = old.name;
  end if;
  return new;
end; $$;
revoke all on function public.service_material_renamed() from public;
drop trigger if exists service_materials_renamed on public.service_materials;
create trigger service_materials_renamed before update on public.service_materials
  for each row execute function public.service_material_renamed();

-- The 133 CenterPoint materials (only when the list is empty).
insert into public.service_materials
  (sort, name, unit, cost, stock_screen_id, stock_row_label, stock_price_col)
select * from (values
 (0, '045 EPDM 10''x100"', 'SF', 0.84, null, null, null),
 (1, '1" DL Closed Stack DL 1315', 'Each', 12.55, 'duro_last:pipe_stacks', '1" Closed Only', 'Price'),
 (2, '10" DL Closed Stack DL 1324', 'Each', 16.69, 'duro_last:pipe_stacks', '10" Closed/Open', 'Price'),
 (3, '10" DL Open Stack DL 2324', 'Each', 16.69, 'duro_last:pipe_stacks', '10" Closed/Open', 'Price'),
 (4, '11" DL Closed Stack DL 1325', 'Each', 16.69, 'duro_last:pipe_stacks', '11" Closed/Open', 'Price'),
 (5, '11" DL Open Stack DL 2325', 'Each', 16.69, 'duro_last:pipe_stacks', '11" Closed/Open', 'Price'),
 (6, '12" DL Closed Stack DL 1326', 'Each', 20.72, 'duro_last:pipe_stacks', '12" Closed/Open', 'Price'),
 (7, '12" DL Open Stack DL 2326', 'Each', 20.72, 'duro_last:pipe_stacks', '12" Closed/Open', 'Price'),
 (8, '13" DL Closed Stack', 'Each', 17.40, 'duro_last:pipe_stacks', '13" Closed/Open', 'Price'),
 (9, '13" DL OpenStack', 'Each', 17.40, 'duro_last:pipe_stacks', '13" Closed/Open', 'Price'),
 (10, '14" DL Closed Stack', 'Each', 17.40, 'duro_last:pipe_stacks', '14" Closed/Open', 'Price'),
 (11, '14" DL Open Stack', 'Each', 17.40, 'duro_last:pipe_stacks', '14" Closed/Open', 'Price'),
 (12, '15" DL Closed Stack', 'Each', 17.40, 'duro_last:pipe_stacks', '15" Closed/Open', 'Price'),
 (13, '15" DL Open Stack', 'Each', 17.40, 'duro_last:pipe_stacks', '15" Closed/Open', 'Price'),
 (14, '16" DL Open Stack', 'Each', 42.02, 'duro_last:pipe_stacks', '16" Open Only', 'Price'),
 (15, '18" DL Open Stack', 'Each', 42.67, 'duro_last:pipe_stacks', '18" Open Only', 'Price'),
 (16, '2" DL Closed Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '2" Closed/Open', 'Price'),
 (17, '2" DL Open Stack', 'Each', 15.10, 'duro_last:pipe_stacks', '2" Closed/Open', 'Price'),
 (18, '2" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '2" Closed/Open', 'Price'),
 (19, '20" DL Open Stack', 'Each', 43.31, 'duro_last:pipe_stacks', '20" Open Only', 'Price'),
 (20, '22" DL Open Stack', 'Each', 43.96, 'duro_last:pipe_stacks', '22" Open Only', 'Price'),
 (21, '24" DL Open Stack', 'Each', 44.60, 'duro_last:pipe_stacks', '24" Open Only', 'Price'),
 (22, '3" DL Closed Stack', 'Each', 15.10, 'duro_last:pipe_stacks', '3" Closed/Open', 'Price'),
 (23, '3" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '3" Closed/Open', 'Price'),
 (24, '3"x100'' Quick Seam Splice Tape', 'LF', 0.80, null, null, null),
 (25, '4" DL Closed Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '4" Closed/Open', 'Price'),
 (26, '4" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '4" Closed/Open', 'Price'),
 (27, '5" DL Closed Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '5" Closed/Open', 'Price'),
 (28, '5" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '5" Closed/Open', 'Price'),
 (29, '5"x100'' Quick Seam Flashing W56RAC1615', 'LF', 3.41, null, null, null),
 (30, '6" DL Closed Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '6" Closed/Open', 'Price'),
 (31, '6" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '6" Closed/Open', 'Price'),
 (32, '7" DL Closed Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '7" Closed/Open', 'Price'),
 (33, '7" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '7" Closed/Open', 'Price'),
 (34, '8" DL Closed Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '8" Closed/Open', 'Price'),
 (35, '8" DL Open Stack', 'Each', 11.40, 'duro_last:pipe_stacks', '8" Closed/Open', 'Price'),
 (36, '9" DL Closed Stack', 'Each', 14.00, 'duro_last:pipe_stacks', '9" Closed/Open', 'Price'),
 (37, '9" DL Open Stack', 'Each', 14.00, 'duro_last:pipe_stacks', '9" Closed/Open', 'Price'),
 (38, '9"x50'' Quick Seam Flashing', 'LF', 5.60, null, null, null),
 (39, 'Acetone', 'Gallon', 17.94, null, null, null),
 (40, 'All Purpose Sealant', 'Tube', 11.22, null, null, null),
 (41, 'All-Weather Cement Mesh', 'LF', 0.11, null, null, null),
 (42, 'All-Weather Roof Cement', 'Gal', 12.70, null, null, null),
 (43, 'All-Weather Roof Cement Caulk', 'each', 4.11, null, null, null),
 (44, 'CDR 2-1/2"', 'EA', 14.65, 'duro_last:cdr_rings', '2 1/2" Drain Ring', 'Price'),
 (45, 'CDR 2"', 'EA', 14.65, 'duro_last:cdr_rings', '2" Drain Rings', 'Price'),
 (46, 'CDR 3-1/2"', 'ea', 15.20, 'duro_last:cdr_rings', '3 1/2" Drain Rings', 'Price'),
 (47, 'CDR 3"', 'ea', 14.65, 'duro_last:cdr_rings', '3" Drain Rings', 'Price'),
 (48, 'CDR 4-1/2"', 'ea', 15.20, 'duro_last:cdr_rings', '4 1/2" Drain Rings', 'Price'),
 (49, 'CDR 4"', 'ea', 15.20, 'duro_last:cdr_rings', '4" Drain Rings', 'Price'),
 (50, 'CDR 5-1/2', 'ea', 17.25, 'duro_last:cdr_rings', '5 1/2" Drain Rings', 'Price'),
 (51, 'CDR 5"', 'ea', 15.90, 'duro_last:cdr_rings', '5" Drain Rings', 'Price'),
 (52, 'CDR 6-1/2"', 'ea', 17.85, 'duro_last:cdr_rings', '6 1/2" Drain Rings', 'Price'),
 (53, 'CDR 6"', 'ea', 17.25, 'duro_last:cdr_rings', '6" Drain Rings', 'Price'),
 (54, 'CDR 7-1/2"', 'ea', 22.90, 'duro_last:cdr_rings', '7 1/2" Drain Rings', 'Price'),
 (55, 'CDR 7"', 'ea', 18.45, 'duro_last:cdr_rings', '7" Drain Rings', 'Price'),
 (56, 'CDR 8"', 'ea', 24.80, 'duro_last:cdr_rings', '8" Drain Rings', 'Price'),
 (57, 'Cleaning Supplies', 'ea', 7.50, null, null, null),
 (58, 'Corner 6x6 Butterfly', 'ea', 6.55, 'duro_last:corners', 'Outside Butterfly 6" x 6"', 'White'),
 (59, 'Corner 6x6 Inside', 'ea', 3.40, 'duro_last:corners', 'Inside 6" x 6"', 'White'),
 (60, 'Corner 6x6 Outside', 'ea', 4.70, 'duro_last:corners', 'Outside 6" x 6"', 'White'),
 (61, 'DL 2315H - 1 1/2" DL Open Stack', 'Each', 15.25, 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Price'),
 (62, 'DL- 1 1/2" P-3 Head Screw', 'Each', 0.09, null, null, null),
 (63, 'DL- 4" P-3 Head Screw', 'Each', 0.21, null, null, null),
 (64, 'DL-1315H -1 1/2" DL Closed Stack', 'Each', 15.25, 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Price'),
 (65, 'Drain Boot 2-1/2"', 'ea', 15.99, 'duro_last:drain_boots', '2 1/2" Drain Boot', 'Price'),
 (66, 'Drain Boot 2"', 'ea', 15.99, 'duro_last:drain_boots', '2" Drain Boot', 'Price'),
 (67, 'Drain Boot 3-1/2"', 'ea', 15.99, 'duro_last:drain_boots', '3 1/2" Drain Boot', 'Price'),
 (68, 'Drain Boot 3"', 'ea', 15.99, 'duro_last:drain_boots', '3" Drain Boot', 'Price'),
 (69, 'Drain Boot 4-1/2"', 'ea', 15.99, 'duro_last:drain_boots', '4 1/2" Drain Boot', 'Price'),
 (70, 'Drain Boot 4"', 'ea', 15.99, 'duro_last:drain_boots', '4" Drain Boot', 'Price'),
 (71, 'Drain Boot 5-1/2"', 'ea', 15.99, 'duro_last:drain_boots', '5 1/2" Drain Boot', 'Price'),
 (72, 'Drain Boot 5"', 'ea', 15.99, 'duro_last:drain_boots', '5" Drain Boot', 'Price'),
 (73, 'Drain Boot 6-1/2"', 'ea', 15.99, 'duro_last:drain_boots', '6 1/2" Drain Boot', 'Price'),
 (74, 'Drain Boot 6"', 'ea', 15.99, 'duro_last:drain_boots', '6" Drain Boot', 'Price'),
 (75, 'Drain Boot 7-1/2"', 'ea', 15.99, 'duro_last:drain_boots', '7 1/2" Drain Boot', 'Price'),
 (76, 'Drain Boot 7"', 'ea', 15.99, 'duro_last:drain_boots', '7" Drain Boot', 'Price'),
 (77, 'Drain Boot 8"', 'ea', 15.99, 'duro_last:drain_boots', '8" Drain Boot', 'Price'),
 (78, 'Drive-Pin Anchor', 'each', 0.25, null, null, null),
 (79, 'Duct Tape', 'LF', 0.05, null, null, null),
 (80, 'Duro-Caulk Advanced White', 'ea', 8.95, null, null, null),
 (81, 'Duro-Caulk Bronze', 'Each', 8.95, 'duro_last:sealants', 'Duro-Caulk - Bronze', 'Price'),
 (82, 'Duro-Caulk Gray', 'each', 8.95, 'duro_last:sealants', 'Duro-Caulk - Gray', 'Price'),
 (83, 'Duro-Caulk White', 'Each', 8.95, 'duro_last:sealants', 'Duro-Caulk - White', 'Price'),
 (84, 'Duro-Caulk White', 'each', 8.95, 'duro_last:sealants', 'Duro-Caulk - White', 'Price'),
 (85, 'Duro-Last 40 mil white membrane', 'SqFt', 1.03, 'duro_last:duro_last_membrane', 'Duro-Last - 40mil Roll Goods', 'White'),
 (86, 'Duro-Mastic Strip Mastic', 'LF', 0.38, null, null, null),
 (87, 'EPDM Corner1646', 'EA', 7.12, null, null, null),
 (88, 'EPDM joint cover 1644', 'ea', 4.58, null, null, null),
 (89, 'Fan Fold EPS', 'SqFt', 0.30, null, null, null),
 (90, 'Firestone Aluminum Term Bar', 'Foot', 1.59, null, null, null),
 (91, 'Firestone EPDM Lap Sealant / Caulk', 'Tube', 10.22, null, null, null),
 (92, 'ISO Insulatin Q', 'ea', 17.61, null, null, null),
 (93, 'ISO Insulation 1.5"', 'ea', 27.72, null, null, null),
 (94, 'ISO Insulation 1"', 'ea', 20.88, null, null, null),
 (95, 'ISO Insulation 2.2"', 'ea', 40.66, null, null, null),
 (96, 'ISO Insulation 2.6"', 'ea', 48.05, null, null, null),
 (97, 'ISO Insulation 2"', 'ea', 36.96, null, null, null),
 (98, 'ISO Insulation 3"', 'ea', 55.44, null, null, null),
 (99, 'ISO Insulation A', 'ea', 14.68, null, null, null),
 (100, 'ISO Insulation AA', 'ea', 8.81, null, null, null),
 (101, 'ISO Insulation B', 'ea', 20.55, null, null, null),
 (102, 'ISO Insulation C', 'ea', 26.42, null, null, null),
 (103, 'ISO Insulation X', 'ea', 11.74, null, null, null),
 (104, 'ISO Insulation Y', 'ea', 23.48, null, null, null),
 (105, 'Karnak 97', 'gal', 26.50, null, null, null),
 (106, 'Metal Batten Strip', 'LF', 0.97, null, null, null),
 (107, 'misc. item', 'ea', 15.00, null, null, null),
 (108, 'Misc. Materials', '1', 15.00, null, null, null),
 (109, 'Patch - 6x6', 'Each', 3.00, null, null, null),
 (110, 'Pipe Boot 4 3/4" -10"', 'EA', 26.44, null, null, null),
 (111, 'Pitch Pan Filler', 'Each', 9.35, 'duro_last:sealants', 'Pitch Pocket Filler (10.2 oz)', 'Price'),
 (112, 'Plate 2" Poly Round', 'Each', 0.27, 'duro_last:fasteners_and_bits', '2" Poly Plates', 'Price/Box'),
 (113, 'Plate 3" Plastic Insulation', 'Each', 0.22, 'duro_last:fasteners_and_bits', '3" Insulation Plates', 'Price/Box'),
 (114, 'Plate 3" Square Steel', 'EACH', 0.35, 'duro_last:fasteners_and_bits', '3" Square Steel', 'Price/Box'),
 (115, 'Quick Prime 1 Gal', 'Gal', 54.35, null, null, null),
 (116, 'Rivets', 'Each', 0.09, null, null, null),
 (117, 'Screw 1-1/2"Oversized Galvanised Metal/Metal', 'Each', 0.14, null, null, null),
 (118, 'Screw 1-1/4"Galvanized Metal/Metal', 'Each', 0.11, null, null, null),
 (119, 'Screw Self Tapping with Washer 3/16x7/8', 'Each', 0.11, null, null, null),
 (120, 'Solar Seal', 'Tube', 7.50, null, null, null),
 (121, 'Splice Wash', 'Gallon', 25.61, null, null, null),
 (122, 'SS Band 3/8" x 20', 'Each', 1.20, 'duro_last:panduit', '3/8" x 20"', 'Price/Part'),
 (123, 'SS Band 3/8"x14', 'Each', 0.80, 'duro_last:panduit', '3/8" x 14"', 'Price/Part'),
 (124, 'Term Bar White Vinyl DL', 'LF', 0.65, 'duro_last:termination_bars', 'White', 'Price'),
 (125, 'TPO 60 mil white membrane', 'sqft', 0.85, null, null, null),
 (126, 'TPO T-Joint Covers', 'Each', 0.76, null, null, null),
 (127, 'Two-Way Vent White', 'ea', 20.99, 'duro_last:vents', 'White Vent', 'Price'),
 (128, 'UltraPly TPO 5-1/2" x 100'' QS Flashing', 'Lf', 2.86, null, null, null),
 (129, 'Uniflex Bonding Tape', 'LF', 1.76, null, null, null),
 (130, 'Uniflex One Flash Sealant', 'Gallon', 113.75, null, null, null),
 (131, 'UVSL. TPO Tan 1"-6" Pipe Boot with Clamps', 'Each', 37.65, null, null, null),
 (132, 'UVSL. TPO White 1"-6" Pipe Boot w/ clamp', 'Each', 37.65, null, null, null)
) as v(sort, name, unit, cost, stock_screen_id, stock_row_label, stock_price_col)
where not exists (select 1 from public.service_materials);
