-- Item-number mappings key a catalog row by its label, but two Duro-Last screens repeat labels:
-- Fasteners & Bits ("2"" under Spade / Drill Point / XHD / Auger / Nail / NTB) and Facia Bars /
-- Vinyl Covers ("White Vinyl Cover" for the 1 3/4" and the 4" bar). A mapping there resolved to
-- the FIRST row with that label, so an import would have written the Auger price into the Spade
-- row. Rows with a repeated label are now keyed "<label> [<Subtype or Part #>]" everywhere
-- (listPriceTargets / applyPriceImport / catalog chips — see src/lib/catalog-row-key.ts); this
-- re-keys the seeded mappings by their Part #. Idempotent.
with dup as (
  select p.id as screen_id, coalesce(r->>'Description', r->>'Name') as label
  from public.pricing_catalog p, jsonb_array_elements(p.data->'rows') r
  where p.branch = 'duro_last' and p.data->>'kind' is null
  group by 1, 2 having count(*) > 1
), keyed as (
  select p.id as screen_id, upper(replace(coalesce(r->>'Part #',''), ' ', '')) as part,
         coalesce(r->>'Description', r->>'Name') as label,
         coalesce(r->>'Description', r->>'Name') || ' [' || coalesce(nullif(r->>'Subtype', ''), r->>'Part #') || ']' as new_label
  from public.pricing_catalog p, jsonb_array_elements(p.data->'rows') r
  where p.branch = 'duro_last' and p.data->>'kind' is null
)
update public.catalog_item_numbers c
   set row_label = k.new_label
  from keyed k join dup d on d.screen_id = k.screen_id and d.label = k.label
 where c.screen_id = k.screen_id and c.row_label = k.label
   and upper(replace(c.item_no, ' ', '')) = k.part;
