-- Live tile placement for the Underlayment "Select Insulation Type" panel (legacy SubType 1..8).
-- CAPTURED from the 2026-08-31 estimator batch: each tile's open context menu photographed
-- (Slip Sheets 121934; 8'x4' ISO 121946; Other Rigid 8'x4' 122002; Fire Rated 122032; Flute
-- Filler quote dialog 122049; 4'x4' ISO 122117; Other Rigid 4'x4' 122200; Tapered/Other 122216).
-- Board -> tile is the live ref_UnderlaymentTypes SubType (docs §10.1/§10.2); the notable
-- correction vs the provisional grouping: ALL DensDeck / DensDeck Prime / Securock / F/C Sheet
-- Rock boards live under the FIRE RATED tile (SubType 5). The underlayment_group_id column
-- keeps the ADHESIVE group (AdhesiveGroupID) — a separate axis used for adhered-eligibility
-- and coverage, unchanged here.
-- SubTypes: 1 Slip Sheets, 2 8'x4' ISO, 3 Other Rigid 8'x4', 4 Flute Filler (quote dialog),
-- 5 Fire Rated, 6 Tapered/Other (quote menu), 7 4'x4' ISO, 8 Other Rigid 4'x4'.
alter table public.underlayment_board_group
  add column if not exists subtype int,
  add column if not exists subtype_sort int;

-- Slip Sheets (1), in the captured menu order.
update public.underlayment_board_group set subtype = 1, subtype_sort = s.n
from (values ('Duro-Fold', 1), ('Ultra-Fold', 2), ('Duro-Blue Slipsheet', 3),
             ('Geotextile', 4), ('Duro-Weave', 5)) as s(name, n)
where board_name = s.name;

-- 8'x4' ISO (2).
update public.underlayment_board_group set subtype = 2, subtype_sort = s.n
from (values ('1/2" ISO', 1), ('1" ISO', 2), ('1 1/2" ISO', 3), ('2" ISO', 4),
             ('2 1/2" ISO', 5), ('2.7" ISO', 6), ('3" ISO', 7), ('3 1/2" ISO', 8),
             ('4" ISO', 9)) as s(name, n)
where board_name = s.name;

-- Other Rigid 8'x4' (3).
update public.underlayment_board_group set subtype = 3, subtype_sort = s.n
from (values ('1" Rigid', 1), ('1 1/2" Rigid', 2), ('2" Rigid', 3), ('2 1/2" Rigid', 4),
             ('2.7" Rigid', 5), ('3" Rigid', 6), ('3 1/2" Rigid', 7), ('4" Rigid', 8))
     as s(name, n)
where board_name = s.name;

-- Fire Rated (5) — the captured menu includes the DensDeck/Securock/gypsum families.
update public.underlayment_board_group set subtype = 5, subtype_sort = s.n
from (values ('FR 10', 1), ('FR 50', 2), ('1/4" Dens Deck', 3), ('3/8" Dens Deck', 4),
             ('1/4" DensDeck Prime', 5), ('1/2" DensDeck Prime', 6), ('5/8" DensDeck Prime', 7),
             ('1/4" Securock GFRB', 8), ('3/8" Securock GFRB', 9), ('1/2" Securock GFRB', 10),
             ('5/8" Securock GFRB', 11), ('5/8" F/C Sheet Rock', 12)) as s(name, n)
where board_name = s.name;

-- 4'x4' ISO (7).
update public.underlayment_board_group set subtype = 7, subtype_sort = s.n
from (values ('1/2" HD ISO 4''x 4''', 1), ('1" ISO 4''x 4''', 2), ('1 1/2" ISO 4''x 4''', 3),
             ('2" ISO 4''x 4''', 4), ('2 1/2" ISO 4''x 4''', 5), ('2.7" ISO 4''x 4''', 6),
             ('3" ISO 4''x 4''', 7), ('3 1/2" ISO 4''x 4''', 8), ('4" ISO 4''x 4''', 9))
     as s(name, n)
where board_name = s.name;

-- Other Rigid 4'x4' (8).
update public.underlayment_board_group set subtype = 8, subtype_sort = s.n
from (values ('1/2" Rigid 4''x 4''', 1), ('1" Rigid 4''x 4''', 2), ('1 1/2" Rigid 4''x 4''', 3),
             ('2" Rigid 4''x 4''', 4), ('2 1/2" Rigid 4''x 4''', 5), ('2.7" Rigid 4''x 4''', 6),
             ('3" Rigid 4''x 4''', 7), ('3 1/2" Rigid 4''x 4''', 8), ('4" Rigid 4''x 4''', 9))
     as s(name, n)
where board_name = s.name;
