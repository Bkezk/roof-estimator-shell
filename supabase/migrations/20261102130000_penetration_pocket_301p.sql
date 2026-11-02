-- UltraPly TPO Penetration Pocket: the 2013 Firestone sheet prints item code TPO301L, but the owner
-- wrote "301P" beside it (Nov 2) and the inventory item list carries FS-W56TPO-301P
-- "TPO-UP Penetration Pockets-W". The link follows the owner's number.
update public.catalog_item_numbers
set item_no = 'W56TPO301P'
where item_no = 'W56TPO301L'
  and screen_id = 'duro_last:exceptional_metals'
  and not exists (
    select 1 from public.catalog_item_numbers x
    where x.item_no = 'W56TPO301P' and x.screen_id = 'duro_last:exceptional_metals');
