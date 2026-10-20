-- Prices are an estimator's and the pricing page's to read (the fifth audit, Oct 20; owner
-- approved item 1). Every pricing, labor and settings table's SELECT policy was
-- `using (true)` — any signed-in token, a technician's included, read the whole catalog, every
-- labor table, the company settings row, the item-number map with its last imported price and
-- the import history — and the pricing READ server functions checked nothing (only the saves
-- did). The owner's rule since Oct 8 is "technician who cant see the pricing of anything".
--
-- 1. The SELECT policies of the tables the earlier migrations created with `using (true)`,
--    looped over here by name (the list is theirs — 20260831225744_admin_general.sql,
--    20260831233321_labor_engines_a.sql, 20260831234016, 20260901001301, 20260901002846,
--    20260901004655, 20260901005706_pricing_non_dl.sql, 20260903010000, 20260903030000,
--    20260909220000, 20260914100000, 20260914110000, 20260921170000_catalog_item_numbers.sql,
--    20260922190000_price_import_runs.sql), become
--    `has_access('pricing') or has_access('estimate')`: Estimate Pricing, or Estimate — an
--    estimator prices bids and must keep reading the catalog and the labor tables. The writes
--    are untouched (is_admin()). The server twin is assertPricingRead (src/lib/auth.functions.ts)
--    on every pricing / labor / settings read function (admin-*.functions.ts,
--    engine.functions.ts, bids.functions.ts getMarkupPresets / getWarrantyData).
--    Exception (5), pricing_catalog alone: `or is_sales_pm()` — an invoicer with the Invoices
--    tick and neither Estimate nor Estimate Pricing costs a ticket's materials from the catalog
--    (src/lib/invoices.server.ts cellCost / cellPiece, buildLinesFromJob) and must keep doing so.
--    Admins and managers pass has_access() by role.
-- 2. Exception (1), the inventory: Inventory is everyone's (owner, Oct 1), and it reads
--    pricing_catalog for a screen's category, its row labels, the pack sizes ("Fasteners/Box",
--    "Parts/Bag", "Parts/Package" — how many pieces one priced pack holds, src/lib/stock-units.ts)
--    and an adhesive's unit type ("4-Cartridge Case") — never a price. The view
--    `pricing_catalog_units` (plain, security_invoker = false, as repair_templates_catalog of
--    20261002160000) serves id, branch, category, sort and a price-free `data`:
--    pricing_catalog_unit_data() keeps `columns` (names only), on each row the label
--    (Description / Name / the first column), the two disambiguators catalog-row-key.ts uses
--    (Subtype, Part #) and the pack-size columns, and on an adhesives screen each product's name
--    and unit_type; every other key — every price and labor cell, colour prices included — is
--    dropped, and a master-detail screen keeps only its kind. src/lib/catalog-units.ts
--    unitDataOf is its TypeScript twin (tested). Readers switched: inventory.functions.ts
--    categories() and cellUnit() (so the stock page, Record, Transfer, Reconcile, the Export
--    report and the close-out's listServiceMaterialOptions). engine.functions.ts and
--    invoices.server.ts keep the base table: estimate and invoice paths.
--    Likewise `catalog_item_numbers_map`: catalog_item_numbers carries last_price, and the
--    inventory (readStock, addMovement, transferStock) and the close-out's material list
--    (service-field.functions.ts listServiceMaterialOptions) need only item_no, screen_id,
--    row_label, price_col (and dl_description); the view serves those.
-- 3. Exception (3), company_settings: the row holds the tax rate, labor display and shipping
--    rule (pricing), and the company name, address, phone and shop address (not). The view
--    `company_settings_public` serves the latter for the paths that read them without pricing:
--    the close-out's drive-time estimate under a technician (service-field.functions.ts
--    estimateTravel), the invoice header (invoices.server.ts loadBundle; an invoicer) and the
--    proposal header (bids.functions.ts getCompanyInfo). notify.server.ts and
--    restore-door.server.ts read the table with the service role (no policy applies).
-- 4. Exception (2), crm_settings (item b, "readable by every token"): crm_settings_read becomes
--    `is_admin() or is_manager()` (Admin › Reminders; getCrmSettings asserts the same). The
--    three values other paths read under anyone's token come through SECURITY DEFINER getters,
--    one integer or stamp each: unassigned_overdue_days() (Work Overview's "needs assignment"
--    timer, my-work.functions.ts listMyWork), opportunity_close_days() (a new opportunity's
--    default close date, opportunities.functions.ts — the front desk enters them) and
--    crm_last_dispatch_at() (the lazy reminder pass's ten-minute throttle,
--    followups.functions.ts dispatchRemindersIfDue — an office user runs it). The cron and the
--    notify passes read the row with the service role.
-- 5. service_settings (material_markup) is NOT in the list: invoices read it, and the owner did
--    not flag it (item 1(ii)(4)).
--
-- Every statement is idempotent (drop policy if exists + create policy; create or replace).
-- Applied by hand by the lead, then verified live by impersonating a technician, an estimator
-- and an office user. Pinned by src/lib/pricing-reads.test.ts.

-- 1. The price-free shaping of a catalog screen (the TypeScript twin: lib/catalog-units.ts). ---
create or replace function public.pricing_catalog_unit_data(d jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case
    when d->>'kind' = 'adhesives' then jsonb_build_object(
      'kind', 'adhesives',
      'products', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', p.value->'name', 'unit_type', p.value->'unit_type')) order by p.ordinality)
          from jsonb_array_elements(case when jsonb_typeof(d->'products') = 'array' then d->'products' else '[]'::jsonb end) with ordinality p
      ), '[]'::jsonb))
    when d->>'kind' is not null then jsonb_build_object('kind', d->'kind')
    else jsonb_build_object(
      'columns', case when jsonb_typeof(d->'columns') = 'array' then d->'columns' else '[]'::jsonb end,
      'rows', coalesce((
        select jsonb_agg(coalesce((
                 select jsonb_object_agg(e.key, e.value)
                   from jsonb_each(case when jsonb_typeof(r.value) = 'object' then r.value else '{}'::jsonb end) e
                  where e.key in ('Description', 'Name', 'Subtype', 'Part #', 'Fasteners/Box', 'Parts/Bag', 'Parts/Package')
                     or e.key = (d->'columns'->>0)
               ), '{}'::jsonb) order by r.ordinality)
          from jsonb_array_elements(case when jsonb_typeof(d->'rows') = 'array' then d->'rows' else '[]'::jsonb end) with ordinality r
      ), '[]'::jsonb))
  end
$$;
revoke all on function public.pricing_catalog_unit_data(jsonb) from public;
grant execute on function public.pricing_catalog_unit_data(jsonb) to authenticated;
comment on function public.pricing_catalog_unit_data(jsonb) is
  'A pricing_catalog screen''s data without its prices: columns by name, each row''s label / Subtype / Part # / pack-size cells, an adhesive''s name and unit_type (Oct 20; lib/catalog-units.ts unitDataOf is the twin).';

-- 2. The price-free views. --------------------------------------------------------------------
create or replace view public.pricing_catalog_units
  with (security_invoker = false, security_barrier = true) as
  select pc.id, pc.branch, pc.category, pc.sort, public.pricing_catalog_unit_data(pc.data) as data
    from public.pricing_catalog pc;
revoke all on public.pricing_catalog_units from public, anon, authenticated;
grant select on public.pricing_catalog_units to authenticated;
comment on view public.pricing_catalog_units is
  'pricing_catalog for the inventory (everyone''s): id, branch, category, sort and a price-free data (Oct 20, 20261020120000).';

create or replace view public.catalog_item_numbers_map
  with (security_invoker = false, security_barrier = true) as
  select n.item_no, n.screen_id, n.row_label, n.price_col, n.dl_description
    from public.catalog_item_numbers n;
revoke all on public.catalog_item_numbers_map from public, anon, authenticated;
grant select on public.catalog_item_numbers_map to authenticated;
comment on view public.catalog_item_numbers_map is
  'catalog_item_numbers without last_price: the item number of a stock cell, for the inventory and the close-out (Oct 20, 20261020120000).';

create or replace view public.company_settings_public
  with (security_invoker = false, security_barrier = true) as
  select c.id, c.company_name, c.address, c.city, c.state, c.zip, c.phone,
         c.shop_address, c.shop_city, c.shop_state, c.shop_zip
    from public.company_settings c;
revoke all on public.company_settings_public from public, anon, authenticated;
grant select on public.company_settings_public to authenticated;
comment on view public.company_settings_public is
  'company_settings without the pricing columns: the company name, address, phone and shop address, for the close-out''s drive time, the invoice and the proposal headers (Oct 20, 20261020120000).';

-- 3. crm_settings: the three getters, then the narrowed read. ---------------------------------
create or replace function public.unassigned_overdue_days()
returns integer language sql stable security definer set search_path = public as $$
  select s.unassigned_overdue_days from public.crm_settings s where s.id = 1;
$$;
revoke all on function public.unassigned_overdue_days() from public;
grant execute on function public.unassigned_overdue_days() to authenticated;
comment on function public.unassigned_overdue_days() is
  'Admin › Reminders'' "needs assignment" timer for Work Overview (everyone''s), now that crm_settings is an admin''s and a manager''s to read (Oct 20).';

create or replace function public.opportunity_close_days()
returns integer language sql stable security definer set search_path = public as $$
  select s.opportunity_close_days from public.crm_settings s where s.id = 1;
$$;
revoke all on function public.opportunity_close_days() from public;
grant execute on function public.opportunity_close_days() to authenticated;
comment on function public.opportunity_close_days() is
  'Admin › Reminders'' default close window for a new opportunity (the front desk enters them), now that crm_settings is an admin''s and a manager''s to read (Oct 20).';

create or replace function public.crm_last_dispatch_at()
returns timestamptz language sql stable security definer set search_path = public as $$
  select s.last_dispatch_at from public.crm_settings s where s.id = 1;
$$;
revoke all on function public.crm_last_dispatch_at() from public;
grant execute on function public.crm_last_dispatch_at() to authenticated;
comment on function public.crm_last_dispatch_at() is
  'The last reminder pass, for the lazy dispatcher''s ten-minute throttle (an office user runs it), now that crm_settings is an admin''s and a manager''s to read (Oct 20).';

drop policy if exists crm_settings_read on public.crm_settings;
create policy crm_settings_read on public.crm_settings for select to authenticated
  using (public.is_admin() or public.is_manager());

-- 4. The pricing, labor and settings reads, narrowed. -----------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    -- 20260901005706_pricing_non_dl.sql
    'pricing_catalog',
    -- 20260831225744_admin_general.sql
    'company_settings', 'shipping_steps', 'markup_options', 'warranties', 'high_wind_upcharges',
    -- 20260831233321_labor_engines_a.sql, 20260831234016_labor_parapet.sql
    'labor_setup', 'labor_setup_steps', 'labor_inspection_steps', 'labor_templates',
    'labor_template_adjustments', 'labor_curb', 'labor_curb_deck', 'labor_curb_type', 'labor_parapet',
    -- 20260901001301_roof_deck_labor.sql, 20260901002846_rdl_underlayment_tearoff.sql,
    -- 20260901004655_accessory_labor.sql, 20260914100000_rdl_roll_good_width.sql,
    -- 20260914110000_rdl_adhered_sheet_multi.sql
    'rdl_combos', 'rdl_labor_tables', 'accessory_labor', 'rdl_roll_good_width', 'rdl_adhered_sheet_multi',
    -- 20260903010000_legacy_fastener_adhesive_tables.sql, 20260903030000_mech_tab_multi.sql,
    -- 20260909220000_underlayment_board_groups.sql
    'mech_fastener_lookup', 'mech_sheet_tab_spacing', 'mech_tab_multi',
    'legacy_roof_system', 'legacy_adhesive',
    'underlayment_group', 'underlayment_board_group',
    'adhesive_labor_per_ksqft', 'adhesive_ribbon_spacing', 'adhesive_wall_coverage',
    'adhesive_coverage_deck', 'adhesive_coverage_underlayment', 'adhesive_allowed_under',
    -- 20260921170000_catalog_item_numbers.sql, 20260922190000_price_import_runs.sql
    'catalog_item_numbers', 'price_import_runs', 'price_import_changes'
  ] loop
    execute format('drop policy if exists %I on public.%I;', t || '_read', t);
    if t = 'pricing_catalog' then
      -- Exception (5): an invoicer with the Invoices tick alone costs materials from the catalog.
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.has_access(''pricing'') or public.has_access(''estimate'') or public.is_sales_pm());',
        t || '_read', t);
    else
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.has_access(''pricing'') or public.has_access(''estimate''));',
        t || '_read', t);
    end if;
  end loop;
end $$;
