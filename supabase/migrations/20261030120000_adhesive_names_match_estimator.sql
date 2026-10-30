-- One name per adhesive (owner, Oct 30: "TECH-Bond TPO Bonding Solvent Adhesive has a price and
-- coverage amount but it's not showing up on the cost of the Somerset Career Center"; "the EPDM
-- ones are the same"). The bid estimator has known these adhesives since Sept 22
-- (20260922110000_duro_tech_tpo_adhesives.sql, legacy_adhesive) as
--   TECH-Bond TPO Bonding Adhesive, TECH-Bond TPO LVOC Bonding Adhesive, EPDM Bonding Adhesive;
-- the Oct 27 price sheets (20261027120000_accessory_families.sql) added the same products to the
-- Adhesives price list under the sheet's wording, and the estimator joins an adhesive's price and
-- the grid's coverage to a bid by EXACT name (engine/adapters.ts buildAdhesivePrices,
-- applyAdhesivesScreenCoverage). So the priced name was never the picked one: $0 on the bid.
-- Renamed in place to the estimator's names: price, unit, part number and coverage rows kept.
-- The item numbers follow the product (row_label); dl_description stays the sheet's wording.
-- Saved bids price from their frozen snapshot until "Update pricing & labor" is pressed.

update public.pricing_catalog c
set data = jsonb_set(
  c.data,
  '{products}',
  (
    select jsonb_agg(
      case e->>'name'
        when 'TECH-Bond TPO Bonding Solvent Adhesive'
          then jsonb_set(e, '{name}', to_jsonb('TECH-Bond TPO Bonding Adhesive'::text))
        when 'TECH-Bond TPO LVOC Solvent Bonding Adhesive'
          then jsonb_set(e, '{name}', to_jsonb('TECH-Bond TPO LVOC Bonding Adhesive'::text))
        when 'EPDM Bonding Adhesive (BA-2004 T)'
          then jsonb_set(e, '{name}', to_jsonb('EPDM Bonding Adhesive'::text))
        else e
      end
      order by t.ord
    )
    from jsonb_array_elements(c.data->'products') with ordinality as t(e, ord)
  )
)
where c.id = 'duro_last:adhesives'
  -- Never make two products with one name: only when the estimator's names are not there yet.
  and not exists (
    select 1 from jsonb_array_elements(c.data->'products') e
    where e->>'name' in (
      'TECH-Bond TPO Bonding Adhesive', 'TECH-Bond TPO LVOC Bonding Adhesive', 'EPDM Bonding Adhesive'
    )
  );

update public.catalog_item_numbers
set row_label = case row_label
  when 'TECH-Bond TPO Bonding Solvent Adhesive' then 'TECH-Bond TPO Bonding Adhesive'
  when 'TECH-Bond TPO LVOC Solvent Bonding Adhesive' then 'TECH-Bond TPO LVOC Bonding Adhesive'
  when 'EPDM Bonding Adhesive (BA-2004 T)' then 'EPDM Bonding Adhesive'
end
where screen_id = 'duro_last:adhesives'
  and row_label in (
    'TECH-Bond TPO Bonding Solvent Adhesive',
    'TECH-Bond TPO LVOC Solvent Bonding Adhesive',
    'EPDM Bonding Adhesive (BA-2004 T)'
  );
