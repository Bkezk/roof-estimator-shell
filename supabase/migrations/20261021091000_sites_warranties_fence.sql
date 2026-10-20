-- Named sites and warranties fenced for technicians (the sixth audit, Oct 21; owner approved
-- item b). property_sites_read (20261006170000_property_sites.sql) and site_warranties_read
-- (20261005160000_site_warranties.sql) admitted `has_access('service')` outright, so a
-- technician-only token read every property's named sites and every roof warranty — the pass
-- 20261020122000_technician_customer_fence.sql left for later (its header, item 3). Their
-- `_write` policies are `for all` too, and a FOR ALL policy also grants SELECT (see
-- 20261020123000_customer_write_policies_split.sql), so narrowing the read policies alone would
-- change nothing: both are split into insert / update / delete with the same rule.
--
-- 1. The read policies follow crm_sites_read (20261020122000): Customers or Estimate access, or
--    Service access without the technician kind (the office, managers and owners ticked
--    Technician keep full visibility, owner Oct 8), or the row's property being the site of a
--    live ticket the caller leads or is on the crew of — tech_sees_site(property_id) for a named
--    site, tech_sees_site(site_id) for a warranty (SECURITY DEFINER STABLE, defined there).
--    What a technician's ticket page reads is exactly that: WarrantyBadges (siteId = the
--    ticket's site → warranties.functions.ts listSiteWarranties .eq site_id), PropertySiteSelect
--    (propertyId = the ticket's site → property-sites.functions.ts listPropertySites .eq
--    property_id), saveServiceJob's location check (property_sites by the ticket's location_id,
--    whose property_id is the ticket's site), and My tickets (service-field.functions.ts myDay:
--    site_warranties .in site_id of their own tickets). A site of the same customer that is not
--    a ticket's reads as having no named sites and no warranties (an empty list, not an error).
-- 2. The write policies: `customers or service`, as before, split so they grant no read.
--
-- Idempotent: every policy is dropped if it exists before it is created; a replay leaves one
-- select policy and three write policies per table and no FOR ALL one. Pinned by
-- src/lib/sites-warranties-fence.test.ts.

-- 1. ------------------------------------------------------------------------------------------
drop policy if exists property_sites_read on public.property_sites;
create policy property_sites_read on public.property_sites for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate')
         or (public.has_access('service') and not public.is_technician())
         or public.tech_sees_site(property_id));

drop policy if exists site_warranties_read on public.site_warranties;
create policy site_warranties_read on public.site_warranties for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate')
         or (public.has_access('service') and not public.is_technician())
         or public.tech_sees_site(site_id));

-- 2. ------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['property_sites', 'site_warranties'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_write', t);
    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_access(''customers'') or public.has_access(''service''));',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_access(''customers'') or public.has_access(''service'')) with check (public.has_access(''customers'') or public.has_access(''service''));',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_access(''customers'') or public.has_access(''service''));',
      t || '_delete', t);
  end loop;
end $$;
