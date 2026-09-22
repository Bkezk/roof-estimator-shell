-- Legacy Part # 1767 sat on BOTH the "1/2" Bit -" row and the 11" Auger row of Fasteners & Bits.
-- On Duro-Last's current list 1767 is the 11" auger screw ($1.75 EA), so the bit-row mapping is
-- stale: an import would have written the screw price over the bit. Drop that one mapping; the
-- bit keeps its price until its real item number is mapped. Idempotent.
delete from public.catalog_item_numbers
 where screen_id = 'duro_last:fasteners_and_bits' and item_no = '1767' and row_label like '1/2" Bit%';
