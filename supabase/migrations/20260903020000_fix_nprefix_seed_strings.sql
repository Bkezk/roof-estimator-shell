-- Fix: the 2026-09-03 legacy seed migration leaked the T-SQL national-string prefix into every
-- text value ('Ndurolast', 'NWater Based Adhesive', ...) - the extraction parser consumed N'...'
-- quotes but left the N. Numeric-only tables (mech_fastener_lookup etc.) are unaffected.
-- This migration deletes and re-inserts the three affected tables' rows, re-derived from the same
-- source (BidAdvantage.DataAccess.SqlScript.xml) with the prefix handled. Seed-only; idempotent.

delete from public.legacy_roof_system;
insert into public.legacy_roof_system (roof_system_id, short_name, long_name, is_insulation, lap_over, needs_vents, mech_wall_fasteners, sort_order) values
  (0, 'insulations', 'Insulations', 1, 0, 0, null, 0),
  (1, 'durolast', 'Duro-Last', 0, 6, 1, 1, 1),
  (2, 'durobond', 'Duro-Bond', 0, 6, 1, 2, 3),
  (3, 'durotuff', 'Duro-Tuff', 0, 6, 1, null, 4),
  (4, 'duroroof', 'Duro-Roof', 0, 6, 1, null, 5),
  (5, 'durofleece', 'Duro-Fleece', 0, 3, 0, null, 2);

delete from public.underlayment_group;
insert into public.underlayment_group (underlayment_group_id, description, sort_option) values
  (1, 'Slip Sheets', 1),
  (2, 'ISO 4''x8''', 2),
  (3, 'ISO 4''x4''', 3),
  (4, 'EPO/XPS 4''x8''', 4),
  (5, 'Flute Filler', 6),
  (6, 'Fire Rated Mat', 7),
  (7, 'DensDeck/Securock', 8),
  (8, 'DensDeck Prime', 9),
  (9, 'Gypsum Board', 10),
  (10, 'Smooth Mod-Bit', 11),
  (11, 'Granulated Mod-Bit', 12),
  (12, 'Smooth Built-Up', 13),
  (13, 'Graveled Built-Up', 14),
  (14, 'Perlite', 15),
  (15, 'Spray Foam', 16),
  (16, 'Tapered ISO', 17),
  (17, 'EPO/XPS 4''x4''', 5),
  (18, 'Tapered Rigid', 18),
  (19, 'Crickets/Other', 19);

delete from public.legacy_adhesive;
insert into public.legacy_adhesive (adhesive_id, short_name, long_name, part_number, price, unit_type, field_spacing_in, perim_spacing_in, used_with_wall) values
  (1, 'waterbasedadhesive', 'Water Based Adhesive', 1111, 122.1, '5-gal. Bucket', -1, -1, 1),
  (2, 'solventbasedadhesive', 'Solvent Based Adhesive', '1112-010', 141.75, '5-gal. Bucket', -1, -1, 0),
  (3, 'dfadhesive2part', 'Duro-Fleece Adhesive(2-boxes)', 1107, 394.9, '5-gal. Box Set', 12, 6, 0),
  (4, 'dfadhesivecart', 'Duro-Fleece Adhesive(cartridge)', 1106, 1561.5, '4-Cartridge Case', 12, 6, 0),
  (5, 'durogrip', 'Duro-Grip Adhesive(CR-20)', 1109, 486.75, '5-gal. Box Set', 12, 6, 0),
  (6, 'olybondbaginbox', 'OlyBond500 Bag-in-Box', 1108, 394.25, '5-gal. Box Set', 12, 6, 0),
  (7, 'olybondspotshot', 'OlyBond500 SpotShot', 1106, 156.2, '4-Cartridge Case', 12, 6, 0),
  (8, 'milonestep', 'Millenium One Step', 1105, 125.45, '5-gal. Box Set', 12, 6, 0),
  (9, 'milpg1boxes', 'Millenium PG1 Boxes', 1130, 398.75, '5-gal. Box Set', 12, 6, 0),
  (10, 'milpg1drums', 'Millenium PG1 Drums', null, 2457, '50-Gal Drum Set', 12, 6, 0);
