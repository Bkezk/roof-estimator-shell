-- ISO comes in two board sizes (owner, Oct 6: "there are two different iso boards, theres 8x4 and
-- 4x4"). The bid catalog already has both (Underlayment › 1" ISO and 1" ISO 4'x 4' …, by the sq
-- ft). CenterPoint's ISO prices are 4' x 8' boards (1" at $20.88 a board ≈ 35 × the catalog's
-- $0.59 a sq ft), so (on top of 20261006140000_service_material_groups.sql):
--   - the four matched CenterPoint boards say so: "ISO Insulation 1" 4'x8'" … (32 sq ft a board);
--   - a 4' x 4' board of each is added against the catalog's "… ISO 4'x 4'" stock (16 sq ft a
--     board) at half the 4' x 8' price — the same cost a sq ft; change it on Material pricing.
-- Tapered ISO (A, AA, B …) and 2.2" / 2.6" are unchanged. Idempotent.
update public.service_materials m
   set name = v.new_name
  from (values
    ('ISO Insulation 1"', 'ISO Insulation 1" 4''x8''', '1" ISO'),
    ('ISO Insulation 1.5"', 'ISO Insulation 1.5" 4''x8''', '1 1/2" ISO'),
    ('ISO Insulation 2"', 'ISO Insulation 2" 4''x8''', '2" ISO'),
    ('ISO Insulation 3"', 'ISO Insulation 3" 4''x8''', '3" ISO')
  ) as v(old_name, new_name, row_label)
 where m.name = v.old_name and m.stock_screen_id = 'duro_last:underlayment'
   and m.stock_row_label = v.row_label;

insert into public.service_materials
  (sort, name, unit, cost, stock_screen_id, stock_row_label, stock_price_col, stock_per_unit, piece_name)
select b.sort, v.name, b.unit, round(b.cost / 2, 2), 'duro_last:underlayment', v.row_label,
       'Cost/Sq. Ft.', 16, 'board'
  from (values
    ('ISO Insulation 1" 4''x4''', '1" ISO 4''x 4''', '1" ISO'),
    ('ISO Insulation 1.5" 4''x4''', '1 1/2" ISO 4''x 4''', '1 1/2" ISO'),
    ('ISO Insulation 2" 4''x4''', '2" ISO 4''x 4''', '2" ISO'),
    ('ISO Insulation 3" 4''x4''', '3" ISO 4''x 4''', '3" ISO')
  ) as v(name, row_label, big_row)
  join public.service_materials b
    on b.stock_screen_id = 'duro_last:underlayment' and b.stock_row_label = v.big_row
 where not exists (select 1 from public.service_materials x where x.name = v.name);
