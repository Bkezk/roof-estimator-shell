-- Legacy lookup_Underlayments grouping: each priced underlayment board -> its parent insulation
-- type (underlayment_group), so the estimator's Underlayment screen can mirror the legacy
-- "Select Insulation Type" tile panel (parent tiles -> that parent's options) instead of one
-- flat list. The mapping is NAME-EXACT against the seeded price screen
-- (pricing_catalog 'duro_last:underlayment') and corroborated by the 2026-08-31 estimator
-- captures: the tile panel (Slip Sheets / 8'x4' ISO / Other Rigid / Fire Rated / Flute Filler /
-- 4'x4' ISO / Other Rigid 4'x4' / Tapered-Other) and the expanded "Other Rigid 4'x4'" option
-- list (1/2"..4" Rigid 4'x4'), which pins "Rigid"-named boards to the EPO/XPS groups.
-- Groups with no priced boards (Flute Filler, Tapered/*, existing-substrate families) simply
-- have no rows here; the legacy quote-only entries ("Rigid Quote 4'x4'", Tapered ISO/EPS,
-- Tapered Perlite/Crickets, Other) are not priced boards and are not seeded as options.
create table public.underlayment_board_group (
  board_name text primary key,
  underlayment_group_id int not null
    references public.underlayment_group (underlayment_group_id),
  sort int not null
);
alter table public.underlayment_board_group enable row level security;
create policy "underlayment_board_group_read" on public.underlayment_board_group
  for select to authenticated using (true);

insert into public.underlayment_board_group (board_name, underlayment_group_id, sort) values
  -- Slip Sheets (1)
  ('Duro-Blue Slipsheet', 1, 1),
  ('Duro-Weave', 1, 2),
  ('Geotextile', 1, 3),
  ('Duro-Fold', 1, 4),
  ('Ultra-Fold', 1, 5),
  -- ISO 4'x8' (2) — the legacy "8' x 4' ISO" tile
  ('1/2" ISO', 2, 1),
  ('1" ISO', 2, 2),
  ('1 1/2" ISO', 2, 3),
  ('2" ISO', 2, 4),
  ('2 1/2" ISO', 2, 5),
  ('2.7" ISO', 2, 6),
  ('3" ISO', 2, 7),
  ('3 1/2" ISO', 2, 8),
  ('4" ISO', 2, 9),
  -- ISO 4'x4' (3) — the legacy "4' x 4' ISO" tile
  ('1/2" HD ISO 4''x 4''', 3, 1),
  ('1" ISO 4''x 4''', 3, 2),
  ('1 1/2" ISO 4''x 4''', 3, 3),
  ('2" ISO 4''x 4''', 3, 4),
  ('2 1/2" ISO 4''x 4''', 3, 5),
  ('2.7" ISO 4''x 4''', 3, 6),
  ('3" ISO 4''x 4''', 3, 7),
  ('3 1/2" ISO 4''x 4''', 3, 8),
  ('4" ISO 4''x 4''', 3, 9),
  -- EPO/XPS 4'x8' (4) — the legacy "Other Rigid" (8'x4') tile
  ('1" Rigid', 4, 1),
  ('1 1/2" Rigid', 4, 2),
  ('2" Rigid', 4, 3),
  ('2 1/2" Rigid', 4, 4),
  ('2.7" Rigid', 4, 5),
  ('3" Rigid', 4, 6),
  ('3 1/2" Rigid', 4, 7),
  ('4" Rigid', 4, 8),
  -- EPO/XPS 4'x4' (17) — the legacy "Other Rigid" (4'x4') tile (captured option list)
  ('1/2" Rigid 4''x 4''', 17, 1),
  ('1" Rigid 4''x 4''', 17, 2),
  ('1 1/2" Rigid 4''x 4''', 17, 3),
  ('2" Rigid 4''x 4''', 17, 4),
  ('2 1/2" Rigid 4''x 4''', 17, 5),
  ('2.7" Rigid 4''x 4''', 17, 6),
  ('3" Rigid 4''x 4''', 17, 7),
  ('3 1/2" Rigid 4''x 4''', 17, 8),
  ('4" Rigid 4''x 4''', 17, 9),
  -- Fire Rated Mat (6)
  ('FR 10', 6, 1),
  ('FR 50', 6, 2),
  -- DensDeck/Securock (7)
  ('1/4" Dens Deck', 7, 1),
  ('3/8" Dens Deck', 7, 2),
  ('1/4" Securock GFRB', 7, 3),
  ('3/8" Securock GFRB', 7, 4),
  ('1/2" Securock GFRB', 7, 5),
  ('5/8" Securock GFRB', 7, 6),
  -- DensDeck Prime (8)
  ('1/4" DensDeck Prime', 8, 1),
  ('1/2" DensDeck Prime', 8, 2),
  ('5/8" DensDeck Prime', 8, 3),
  -- Gypsum Board (9)
  ('5/8" F/C Sheet Rock', 9, 1);
