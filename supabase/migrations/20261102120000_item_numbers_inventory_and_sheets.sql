-- Item numbers and prices checked against the owner's inventory item list (item_numbers.xlsx,
-- Nov 2: 1,125 active items, ids DL-xxxx / FS-W56...), the Duro-Tech TPO sheets (09/28/2026) and
-- the Firestone sheets (2012-2013) the owner photographed. Owner, Nov 2: "we want to ensure we
-- dont have duplicate products, and we need the correct item numbers assigned to the correct
-- things". Every change below names its source. Item numbers that both the inventory list and
-- the sheets agree with are untouched; numbers neither source knows are left as they are and
-- reported, not guessed.
--
-- Links (catalog_item_numbers): a number that the inventory list puts on another product comes
-- off (1134-1137 off plain Duro-Caulk: they are Duro-Caulk PLUS; 1231 off the Tan/Gray/Dark
-- Gray/Terra Cotta/Rock Ply vents: it is the white vent; 1629/1630/1631 off the 6"/7"/8" nails:
-- they are the SDS/straight screws) and the inventory's own number goes on (1137, 1231B/G/DG,
-- 1628/1638/1639, the drip edge, gravel stop, corner and pipe-stack colours, the legacy Duro-Last
-- adhesives). Two typed numbers with no source anywhere come off (5 1/2" nail "1628" = the 6"
-- nail; 9" nail "162-009"). Two underlayment pseudo-numbers are typos fixed.
--
-- Prices (pricing_catalog): Duro-Tuff 60 White 125 -> 1.25 per sq ft (the same roll, 661346, is
-- 1.25 on the Duro-Bond 60 row and 1.29 in the other colours); Quickseam Yellow Safety Strip 397
-- -> 545 per carton (the Universal accessories sheet: $397 is the termination bar line above it).
--
-- Products: the Duro-Tech "TECH-Bond Spray Solvent Adhesive (canister)" row leaves Other
-- Accessories and joins the Adhesives list as "TECH-Bond TPO Spray Adhesive" (11028T, $595), the
-- name the bid estimator prices adhesives by (legacy_adhesive id 13), with the same coverage
-- rows as the TECH-Bond pails (blank: the office fills the Adhesives grid). SkyPaver Chestnut
-- 1.23" gets W56GARPAVB: the sheet prints PAVW for Chestnut and Ash alike, and its 1.98" set
-- prints Chestnut PAVB2 / Ash PAVW2.
--
-- Saved bids price from their frozen snapshot until "Update pricing & labor" is pressed; bid
-- accessory lines keep the price they were added at.

-- ---- links that come off
delete from public.catalog_item_numbers
where (item_no, screen_id, row_label, price_col) in (
  ('1134', 'duro_last:sealants', 'Duro-Caulk - Gray', 'Price'),
  ('1135', 'duro_last:sealants', 'Duro-Caulk - Bronze', 'Price'),
  ('1136', 'duro_last:sealants', 'Duro-Caulk - White', 'Price'),
  ('1137', 'duro_last:sealants', 'Duro-Caulk - Tan', 'Price'),
  ('1137P', 'duro_last:sealants', 'Duro-Caulk Plus - Tan', 'Price'),
  ('1231', 'duro_last:vents', 'Tan Vent', 'Price'),
  ('1231', 'duro_last:vents', 'Gray Vent', 'Price'),
  ('1231', 'duro_last:vents', 'Dark Gray Vent', 'Price'),
  ('1231', 'duro_last:vents', 'Terra Cotta Vent', 'Price'),
  ('1231', 'duro_last:vents', 'Rock Ply Vent', 'Price'),
  ('1629', 'duro_last:fasteners_and_bits', '6" [Nail]', 'Price/Box'),
  ('1630', 'duro_last:fasteners_and_bits', '7" [Nail]', 'Price/Box'),
  ('1631', 'duro_last:fasteners_and_bits', '8" [Nail]', 'Price/Box'),
  ('1628', 'duro_last:fasteners_and_bits', '5 1/2" [Nail]', 'Price/Box'),
  ('162-009', 'duro_last:fasteners_and_bits', '9" [Nail]', 'Price/Box'),
  ('2 1/2" Rigid', 'duro_last:underlayment', '2 1/2" Rigid 4''x 4''', 'Cost/Sq. Ft.'),
  ('1/2" Rigid 4''x 4', 'duro_last:underlayment', '1/2" Rigid 4''x 4''', 'Cost/Sq. Ft.'),
  ('W56GARPAVW', 'non_dl:preset_custom_applications', 'SkyPaver Chestnut 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 'Price'),
  ('11028T', 'duro_last:other_accessories', 'Duro-Tech TPO TECH-Bond Spray Solvent Adhesive (canister)', 'Price')
);

-- ---- links that go on (source in the comment)
insert into public.catalog_item_numbers (item_no, screen_id, row_label, price_col, dl_description) values
  ('1137', 'duro_last:sealants', 'Duro-Caulk Plus - Tan', 'Price', null) /* inventory DL-1137 */,
  ('1231B', 'duro_last:vents', 'Tan Vent', 'Price', null) /* inventory DL-1231B */,
  ('1231G', 'duro_last:vents', 'Gray Vent', 'Price', null) /* inventory DL-1231G */,
  ('1231DG', 'duro_last:vents', 'Dark Gray Vent', 'Price', null) /* inventory DL-1231DG */,
  ('1628', 'duro_last:fasteners_and_bits', '6" [Nail]', 'Price/Box', null) /* inventory DL-1628 */,
  ('1638', 'duro_last:fasteners_and_bits', '7" [Nail]', 'Price/Box', null) /* inventory DL-1638 */,
  ('1639', 'duro_last:fasteners_and_bits', '8" [Nail]', 'Price/Box', null) /* inventory DL-1639 */,
  ('1111', 'duro_last:adhesives', 'Water Based Adhesive', 'Price', null) /* inventory DL-1111 */,
  ('1112-010', 'duro_last:adhesives', 'Solvent Based Adhesive', 'Price', null) /* inventory DL-1112-010 */,
  ('1107', 'duro_last:adhesives', 'Duro-Fleece Adhesive(2-boxes)', 'Price', null) /* inventory DL-1107 */,
  ('1106', 'duro_last:adhesives', 'Duro-Fleece Adhesive(cartridge)', 'Price', null) /* inventory DL-1106 */,
  ('1109', 'duro_last:adhesives', 'Duro-Grip Adhesive(CR-20)', 'Price', null) /* inventory DL-1109 */,
  ('1108', 'duro_last:adhesives', 'OlyBond500 Bag-in-Box', 'Price', null) /* inventory DL-1108 */,
  ('1104', 'duro_last:adhesives', 'OlyBond500 SpotShot', 'Price', null) /* inventory DL-1104 */,
  ('1105', 'duro_last:adhesives', 'Millenium One Step', 'Price', null) /* inventory DL-1105 */,
  ('1220', 'duro_last:drip_edge', 'Drip Edge 2"', 'White Price', null) /* inventory DL-1220 */,
  ('1220B', 'duro_last:drip_edge', 'Drip Edge 2"', 'Tan Price', null) /* inventory DL-1220B */,
  ('1220G', 'duro_last:drip_edge', 'Drip Edge 2"', 'Gray Price', null) /* inventory DL-1220G */,
  ('1228', 'duro_last:drip_edge', 'Drip Edge 2" Clip', 'White Price', null) /* inventory DL-1228 */,
  ('1228G', 'duro_last:drip_edge', 'Drip Edge 2" Clip', 'Gray Price', null) /* inventory DL-1228G */,
  ('1558G', 'duro_last:drip_edge', 'Drip Edge 2" Corner', 'Gray Price', null) /* inventory DL-1558G */,
  ('1583', 'duro_last:drip_edge', 'Drip Edge 4"', 'White Price', null) /* inventory DL-1583 */,
  ('1583B', 'duro_last:drip_edge', 'Drip Edge 4"', 'Tan Price', null) /* inventory DL-1583B */,
  ('1583G', 'duro_last:drip_edge', 'Drip Edge 4"', 'Gray Price', null) /* inventory DL-1583G */,
  ('1584', 'duro_last:drip_edge', 'Drip Edge 4" Clip', 'White Price', null) /* inventory DL-1584 */,
  ('1226', 'duro_last:gravel_stops', 'Gravel Stop 2"', 'White Price', null) /* inventory DL-1226 */,
  ('1226B', 'duro_last:gravel_stops', 'Gravel Stop 2"', 'Tan Price', null) /* inventory DL-1226B */,
  ('1226G', 'duro_last:gravel_stops', 'Gravel Stop 2"', 'Gray Price', null) /* inventory DL-1226G */,
  ('1587', 'duro_last:gravel_stops', 'Gravel Stop 4"', 'White Price', null) /* inventory DL-1587 */,
  ('1587B', 'duro_last:gravel_stops', 'Gravel Stop 4"', 'Tan Price', null) /* inventory DL-1587B */,
  ('1613G', 'duro_last:gravel_stops', 'Gravel Stop 2" Clip', 'Gray Price', null) /* inventory DL-1613G */,
  ('1311B', 'duro_last:corners', 'Inside 6" x 6"', 'Tan', null) /* inventory DL-1311B */,
  ('1311G', 'duro_last:corners', 'Inside 6" x 6"', 'Gray', null) /* inventory DL-1311G */,
  ('1311DG', 'duro_last:corners', 'Inside 6" x 6"', 'Dark Gray', null) /* inventory DL-1311DG */,
  ('1313B', 'duro_last:corners', 'Inside 6" x 18"', 'Tan', null) /* inventory DL-1313B */,
  ('1313G', 'duro_last:corners', 'Inside 6" x 18"', 'Gray', null) /* inventory DL-1313G */,
  ('1313DG', 'duro_last:corners', 'Inside 6" x 18"', 'Dark Gray', null) /* inventory DL-1313DG */,
  ('1312B', 'duro_last:corners', 'Outside 6" x 6"', 'Tan', null) /* inventory DL-1312B */,
  ('1312G', 'duro_last:corners', 'Outside 6" x 6"', 'Gray', null) /* inventory DL-1312G */,
  ('1312DG', 'duro_last:corners', 'Outside 6" x 6"', 'Dark Gray', null) /* inventory DL-1312DG */,
  ('1314B', 'duro_last:corners', 'Outside 6" x 18"', 'Tan', null) /* inventory DL-1314B */,
  ('1314G', 'duro_last:corners', 'Outside 6" x 18"', 'Gray', null) /* inventory DL-1314G */,
  ('1314DG', 'duro_last:corners', 'Outside 6" x 18"', 'Dark Gray', null) /* inventory DL-1314DG */,
  ('1309B', 'duro_last:corners', 'Outside 18" x 12"', 'Tan', null) /* inventory DL-1309B */,
  ('1309G', 'duro_last:corners', 'Outside 18" x 12"', 'Gray', null) /* inventory DL-1309G */,
  ('1309DG', 'duro_last:corners', 'Outside 18" x 12"', 'Dark Gray', null) /* inventory DL-1309DG */,
  ('1312 BF B', 'duro_last:corners', 'Outside Butterfly 6" x 6"', 'Tan', null) /* inventory DL-1312 BF B */,
  ('1312 BF G', 'duro_last:corners', 'Outside Butterfly 6" x 6"', 'Gray', null) /* inventory DL-1312 BF G */,
  ('1312 BF DG', 'duro_last:corners', 'Outside Butterfly 6" x 6"', 'Dark Gray', null) /* inventory DL-1312 BF DG */,
  ('1312 TerCot', 'duro_last:corners', 'Outside 6" x 6"', 'Terra Cotta', null) /* inventory DL-1312 TerCot */,
  ('1315TN', 'duro_last:pipe_stacks', '1" Closed Only', 'Tan Price', null) /* inventory DL-1315TN */,
  ('1315GY', 'duro_last:pipe_stacks', '1" Closed Only', 'Gray Price', null) /* inventory DL-1315GY */,
  ('1315DGY', 'duro_last:pipe_stacks', '1" Closed Only', 'Dark Gray', null) /* inventory DL-1315DGY */,
  ('2315H-TN', 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Tan Price', null) /* inventory DL-2315H-TN */,
  ('2315H-GY', 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Gray Price', null) /* inventory DL-2315H-GY */,
  ('2315H-DGY', 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Dark Gray', null) /* inventory DL-2315H-DGY */,
  ('1315HB', 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Tan Price', null) /* inventory DL-1315HB */,
  ('1315HG', 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Gray Price', null) /* inventory DL-1315HG */,
  ('1315HDG', 'duro_last:pipe_stacks', '1.5" Closed/Open', 'Dark Gray', null) /* inventory DL-1315HDG */,
  ('2316TN', 'duro_last:pipe_stacks', '2" Closed/Open', 'Tan Price', null) /* inventory DL-2316TN */,
  ('2316GY', 'duro_last:pipe_stacks', '2" Closed/Open', 'Gray Price', null) /* inventory DL-2316GY */,
  ('2316DGY', 'duro_last:pipe_stacks', '2" Closed/Open', 'Dark Gray', null) /* inventory DL-2316DGY */,
  ('1316B', 'duro_last:pipe_stacks', '2" Closed/Open', 'Tan Price', null) /* inventory DL-1316B */,
  ('1316GY', 'duro_last:pipe_stacks', '2" Closed/Open', 'Gray Price', null) /* inventory DL-1316GY */,
  ('1316DGY', 'duro_last:pipe_stacks', '2" Closed/Open', 'Dark Gray', null) /* inventory DL-1316DGY */,
  ('2317TN', 'duro_last:pipe_stacks', '3" Closed/Open', 'Tan Price', null) /* inventory DL-2317TN */,
  ('2317GY', 'duro_last:pipe_stacks', '3" Closed/Open', 'Gray Price', null) /* inventory DL-2317GY */,
  ('2317DGY', 'duro_last:pipe_stacks', '3" Closed/Open', 'Dark Gray', null) /* inventory DL-2317DGY */,
  ('1317B', 'duro_last:pipe_stacks', '3" Closed/Open', 'Tan Price', null) /* inventory DL-1317B */,
  ('1317GY', 'duro_last:pipe_stacks', '3" Closed/Open', 'Gray Price', null) /* inventory DL-1317GY */,
  ('1317DGY', 'duro_last:pipe_stacks', '3" Closed/Open', 'Dark Gray', null) /* inventory DL-1317DGY */,
  ('2318TN', 'duro_last:pipe_stacks', '4" Closed/Open', 'Tan Price', null) /* inventory DL-2318TN */,
  ('2318GY', 'duro_last:pipe_stacks', '4" Closed/Open', 'Gray Price', null) /* inventory DL-2318GY */,
  ('2318DGY', 'duro_last:pipe_stacks', '4" Closed/Open', 'Dark Gray', null) /* inventory DL-2318DGY */,
  ('1318TN', 'duro_last:pipe_stacks', '4" Closed/Open', 'Tan Price', null) /* inventory DL-1318TN */,
  ('1318GY', 'duro_last:pipe_stacks', '4" Closed/Open', 'Gray Price', null) /* inventory DL-1318GY */,
  ('1318DGY', 'duro_last:pipe_stacks', '4" Closed/Open', 'Dark Gray', null) /* inventory DL-1318DGY */,
  ('2319TN', 'duro_last:pipe_stacks', '5" Closed/Open', 'Tan Price', null) /* inventory DL-2319TN */,
  ('2319GY', 'duro_last:pipe_stacks', '5" Closed/Open', 'Gray Price', null) /* inventory DL-2319GY */,
  ('2319DGY', 'duro_last:pipe_stacks', '5" Closed/Open', 'Dark Gray', null) /* inventory DL-2319DGY */,
  ('1319TN', 'duro_last:pipe_stacks', '5" Closed/Open', 'Tan Price', null) /* inventory DL-1319TN */,
  ('1319GY', 'duro_last:pipe_stacks', '5" Closed/Open', 'Gray Price', null) /* inventory DL-1319GY */,
  ('1319DGY', 'duro_last:pipe_stacks', '5" Closed/Open', 'Dark Gray', null) /* inventory DL-1319DGY */,
  ('2320TN', 'duro_last:pipe_stacks', '6" Closed/Open', 'Tan Price', null) /* inventory DL-2320TN */,
  ('2320GY', 'duro_last:pipe_stacks', '6" Closed/Open', 'Gray Price', null) /* inventory DL-2320GY */,
  ('2320DGY', 'duro_last:pipe_stacks', '6" Closed/Open', 'Dark Gray', null) /* inventory DL-2320DGY */,
  ('1320TN', 'duro_last:pipe_stacks', '6" Closed/Open', 'Tan Price', null) /* inventory DL-1320TN */,
  ('1320GY', 'duro_last:pipe_stacks', '6" Closed/Open', 'Gray Price', null) /* inventory DL-1320GY */,
  ('1320DGY', 'duro_last:pipe_stacks', '6" Closed/Open', 'Dark Gray', null) /* inventory DL-1320DGY */,
  ('2321TN', 'duro_last:pipe_stacks', '7" Closed/Open', 'Tan Price', null) /* inventory DL-2321TN */,
  ('2321GY', 'duro_last:pipe_stacks', '7" Closed/Open', 'Gray Price', null) /* inventory DL-2321GY */,
  ('2321DGY', 'duro_last:pipe_stacks', '7" Closed/Open', 'Dark Gray', null) /* inventory DL-2321DGY */,
  ('1321TN', 'duro_last:pipe_stacks', '7" Closed/Open', 'Tan Price', null) /* inventory DL-1321TN */,
  ('1321GY', 'duro_last:pipe_stacks', '7" Closed/Open', 'Gray Price', null) /* inventory DL-1321GY */,
  ('1321DGY', 'duro_last:pipe_stacks', '7" Closed/Open', 'Dark Gray', null) /* inventory DL-1321DGY */,
  ('2322TN', 'duro_last:pipe_stacks', '8" Closed/Open', 'Tan Price', null) /* inventory DL-2322TN */,
  ('2322GY', 'duro_last:pipe_stacks', '8" Closed/Open', 'Gray Price', null) /* inventory DL-2322GY */,
  ('2322DGY', 'duro_last:pipe_stacks', '8" Closed/Open', 'Dark Gray', null) /* inventory DL-2322DGY */,
  ('1322TN', 'duro_last:pipe_stacks', '8" Closed/Open', 'Tan Price', null) /* inventory DL-1322TN */,
  ('1322GY', 'duro_last:pipe_stacks', '8" Closed/Open', 'Gray Price', null) /* inventory DL-1322GY */,
  ('1322DGY', 'duro_last:pipe_stacks', '8" Closed/Open', 'Dark Gray', null) /* inventory DL-1322DGY */,
  ('2323TN', 'duro_last:pipe_stacks', '9" Closed/Open', 'Tan Price', null) /* inventory DL-2323TN */,
  ('2323GY', 'duro_last:pipe_stacks', '9" Closed/Open', 'Gray Price', null) /* inventory DL-2323GY */,
  ('2323DGY', 'duro_last:pipe_stacks', '9" Closed/Open', 'Dark Gray', null) /* inventory DL-2323DGY */,
  ('1323TN', 'duro_last:pipe_stacks', '9" Closed/Open', 'Tan Price', null) /* inventory DL-1323TN */,
  ('1323GY', 'duro_last:pipe_stacks', '9" Closed/Open', 'Gray Price', null) /* inventory DL-1323GY */,
  ('1323DGY', 'duro_last:pipe_stacks', '9" Closed/Open', 'Dark Gray', null) /* inventory DL-1323DGY */,
  ('2324TN', 'duro_last:pipe_stacks', '10" Closed/Open', 'Tan Price', null) /* inventory DL-2324TN */,
  ('2324GY', 'duro_last:pipe_stacks', '10" Closed/Open', 'Gray Price', null) /* inventory DL-2324GY */,
  ('2324DGY', 'duro_last:pipe_stacks', '10" Closed/Open', 'Dark Gray', null) /* inventory DL-2324DGY */,
  ('1324TN', 'duro_last:pipe_stacks', '10" Closed/Open', 'Tan Price', null) /* inventory DL-1324TN */,
  ('1324GY', 'duro_last:pipe_stacks', '10" Closed/Open', 'Gray Price', null) /* inventory DL-1324GY */,
  ('1324DGY', 'duro_last:pipe_stacks', '10" Closed/Open', 'Dark Gray', null) /* inventory DL-1324DGY */,
  ('2325TN', 'duro_last:pipe_stacks', '11" Closed/Open', 'Tan Price', null) /* inventory DL-2325TN */,
  ('2325GY', 'duro_last:pipe_stacks', '11" Closed/Open', 'Gray Price', null) /* inventory DL-2325GY */,
  ('2325DGY', 'duro_last:pipe_stacks', '11" Closed/Open', 'Dark Gray', null) /* inventory DL-2325DGY */,
  ('1325TN', 'duro_last:pipe_stacks', '11" Closed/Open', 'Tan Price', null) /* inventory DL-1325TN */,
  ('1325GY', 'duro_last:pipe_stacks', '11" Closed/Open', 'Gray Price', null) /* inventory DL-1325GY */,
  ('1325DGY', 'duro_last:pipe_stacks', '11" Closed/Open', 'Dark Gray', null) /* inventory DL-1325DGY */,
  ('2326B', 'duro_last:pipe_stacks', '12" Closed/Open', 'Tan Price', null) /* inventory DL-2326B */,
  ('2326G', 'duro_last:pipe_stacks', '12" Closed/Open', 'Gray Price', null) /* inventory DL-2326G */,
  ('2326DG', 'duro_last:pipe_stacks', '12" Closed/Open', 'Dark Gray', null) /* inventory DL-2326DG */,
  ('1326B', 'duro_last:pipe_stacks', '12" Closed/Open', 'Tan Price', null) /* inventory DL-1326B */,
  ('1326G', 'duro_last:pipe_stacks', '12" Closed/Open', 'Gray Price', null) /* inventory DL-1326G */,
  ('1326DG', 'duro_last:pipe_stacks', '12" Closed/Open', 'Dark Gray', null) /* inventory DL-1326DG */,
  ('2327B', 'duro_last:pipe_stacks', '13" Closed/Open', 'Tan Price', null) /* inventory DL-2327B */,
  ('2327G', 'duro_last:pipe_stacks', '13" Closed/Open', 'Gray Price', null) /* inventory DL-2327G */,
  ('2327DG', 'duro_last:pipe_stacks', '13" Closed/Open', 'Dark Gray', null) /* inventory DL-2327DG */,
  ('1327B', 'duro_last:pipe_stacks', '13" Closed/Open', 'Tan Price', null) /* inventory DL-1327B */,
  ('1327G', 'duro_last:pipe_stacks', '13" Closed/Open', 'Gray Price', null) /* inventory DL-1327G */,
  ('1327DG', 'duro_last:pipe_stacks', '13" Closed/Open', 'Dark Gray', null) /* inventory DL-1327DG */,
  ('2328B', 'duro_last:pipe_stacks', '14" Closed/Open', 'Tan Price', null) /* inventory DL-2328B */,
  ('2328G', 'duro_last:pipe_stacks', '14" Closed/Open', 'Gray Price', null) /* inventory DL-2328G */,
  ('2328DG', 'duro_last:pipe_stacks', '14" Closed/Open', 'Dark Gray', null) /* inventory DL-2328DG */,
  ('1328B', 'duro_last:pipe_stacks', '14" Closed/Open', 'Tan Price', null) /* inventory DL-1328B */,
  ('1328G', 'duro_last:pipe_stacks', '14" Closed/Open', 'Gray Price', null) /* inventory DL-1328G */,
  ('1328DG', 'duro_last:pipe_stacks', '14" Closed/Open', 'Dark Gray', null) /* inventory DL-1328DG */,
  ('2329B', 'duro_last:pipe_stacks', '15" Closed/Open', 'Tan Price', null) /* inventory DL-2329B */,
  ('2329G', 'duro_last:pipe_stacks', '15" Closed/Open', 'Gray Price', null) /* inventory DL-2329G */,
  ('2329DG', 'duro_last:pipe_stacks', '15" Closed/Open', 'Dark Gray', null) /* inventory DL-2329DG */,
  ('1329B', 'duro_last:pipe_stacks', '15" Closed/Open', 'Tan Price', null) /* inventory DL-1329B */,
  ('1329G', 'duro_last:pipe_stacks', '15" Closed/Open', 'Gray Price', null) /* inventory DL-1329G */,
  ('1329DG', 'duro_last:pipe_stacks', '15" Closed/Open', 'Dark Gray', null) /* inventory DL-1329DG */,
  ('11107', 'duro_last:walk_pads_wall_vents', '30" x 60" Gray - Walk Pad', 'Price', null) /* inventory DL-11107 */,
  ('2 1/2" Rigid 4''x 4''', 'duro_last:underlayment', '2 1/2" Rigid 4''x 4''', 'Cost/Sq. Ft.', null) /* typo: board name used as number, like its neighbours */,
  ('1/2" Rigid 4''x 4''', 'duro_last:underlayment', '1/2" Rigid 4''x 4''', 'Cost/Sq. Ft.', null) /* typo */,
  ('W56GARPAVB', 'non_dl:preset_custom_applications', 'SkyPaver Chestnut 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 'Price', null) /* Firestone SkyPaver sheet (1.98" set: Chestnut = PAVB2) */,
  ('11028T', 'duro_last:adhesives', 'TECH-Bond TPO Spray Adhesive', 'Price', 'TECH-Bond TPO Spray Solvent Adhesive') /* Duro-Tech sheet 11028T $595 canister */
on conflict (item_no, screen_id, row_label, price_col) do nothing;

-- ---- Duro-Tuff 60 White: 125 -> 1.25 per sq ft (only while it still reads 125)
update public.pricing_catalog c
set data = jsonb_set(c.data, '{rows}', (
  select jsonb_agg(
    case when e->>'Description' = 'Duro-Tuff - 60' and (e->>'White')::numeric = 125
      then jsonb_set(e, '{White}', '1.25'::jsonb) else e end
    order by t.ord)
  from jsonb_array_elements(c.data->'rows') with ordinality as t(e, ord)))
where c.id = 'duro_last:duro_last_membrane';

-- ---- Quickseam Yellow Safety Strip: 397 -> 545 per carton (only while it still reads 397)
update public.pricing_catalog c
set data = jsonb_set(c.data, '{rows}', (
  select jsonb_agg(
    case when e->>'Description' = 'Quickseam Yellow Safety Strip 5.5" x 100'' (100 lin ft)'
      and (e->>'Price')::numeric = 397
      then jsonb_set(e, '{Price}', '545'::jsonb) else e end
    order by t.ord)
  from jsonb_array_elements(c.data->'rows') with ordinality as t(e, ord)))
where c.id in ('non_dl_tpo:other_accessories', 'epdm:other_accessories');

-- ---- TECH-Bond TPO Spray Adhesive joins the Adhesives list (never a second one of the name)
update public.pricing_catalog c
set data = jsonb_set(c.data, '{products}', c.data->'products' || jsonb_build_array(jsonb_build_object(
  'name', 'TECH-Bond TPO Spray Adhesive',
  'part_no', '11028T',
  'price', 595,
  'unit_type', 'canister',
  'coverage', (
    select jsonb_agg(jsonb_set(cv, '{field_coverage}', 'null'::jsonb))
    from jsonb_array_elements(c.data->'products') p, jsonb_array_elements(p->'coverage') cv
    where p->>'name' = 'TECH-Bond TPO Bonding Adhesive'))))
where c.id = 'duro_last:adhesives'
  and not exists (
    select 1 from jsonb_array_elements(c.data->'products') e
    where e->>'name' = 'TECH-Bond TPO Spray Adhesive');

-- ---- and leaves Other Accessories
update public.pricing_catalog c
set data = jsonb_set(c.data, '{rows}', coalesce((
  select jsonb_agg(e order by t.ord)
  from jsonb_array_elements(c.data->'rows') with ordinality as t(e, ord)
  where e->>'Description' <> 'Duro-Tech TPO TECH-Bond Spray Solvent Adhesive (canister)'), '[]'::jsonb))
where c.id = 'duro_last:other_accessories';
