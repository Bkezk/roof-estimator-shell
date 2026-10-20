-- Technicians are fenced from the customer book at the database (the fifth audit, Oct 20; owner
-- approved item a). crm_accounts_read / crm_sites_read / crm_contacts_read were
-- `customers or service or estimate` (20260926120000_service_phase_a.sql,
-- 20260927130000_service_field.sql): a technician-only token — Service access, the Technician
-- tick, nothing more (is_technician(), 20261008190000) — read every customer, property and
-- contact, directly and through listAccounts (crm.functions.ts readAccess admitted Service).
-- Owner, Oct 8: a technician sees "inventory and the tickets assigned to them".
--
-- What a technician's own pages read, and nothing more (the policies admit exactly this):
--  * My tickets (service-field.functions.ts myDay): crm_sites by the tickets' site_id
--    (technician_instructions), crm_contacts by their contact_id (name, phones), crm_accounts
--    by their account_id (phone) — id lists from service_jobs rows where technician_id = me.
--  * The ticket page (service-page.tsx CustomerBlock → crm.functions.ts getAccount: the
--    ticket's account and ALL that account's live sites, for the Property box; ContactSelect →
--    listContacts: ALL that account's contacts and their crm_site_contacts links, for the
--    Property contact box; site-select.tsx → getAccount again). WarrantyBadges → site_warranties
--    by site; CountyCodeLine → county_codes; PropertySiteSelect → property_sites by property.
--  * The close-out's drive time (estimateTravel → travelDestination): the ticket's crm_sites row
--    and, failing a street there, its crm_accounts row.
-- So a technician-only user reads: the accounts of their live tickets; the sites of those
-- tickets and every site of those accounts; the contacts of those tickets and every contact of
-- those accounts. "Their tickets" = a live service_jobs row (deleted_at is null) with
-- technician_id = auth.uid() or is_on_crew(id) (the named crew reads the ticket's page too).
--
-- 1. tech_sees_account(uuid) / tech_sees_site(uuid) / tech_sees_contact(uuid): SECURITY DEFINER
--    STABLE, mirroring is_on_crew (20260930091000) — they read service_jobs under the definer so
--    the policies never recurse through service_jobs' own RLS.
-- 2. The three read policies: Customers or Estimate access, or Service access without the
--    technician kind (the office, managers and owners ticked Technician keep full visibility,
--    owner Oct 8), or the row linked to one of the caller's tickets as above (sites and contacts
--    also by their account). The writes are untouched (customers or service — a technician's
--    contact log and site notes go through their own functions).
-- 3. Left as they are, documented: property_sites_read, site_warranties_read, county_codes_read
--    and crm_site_contacts_read (`customers or service or estimate`). The ticket page shows a
--    technician the property's sites, its warranties in force, its county code line and the
--    contact ↔ site links; none of them names a customer the technician cannot already see, and
--    county_codes is reference data. A later pass may fence property_sites / site_warranties by
--    tech_sees_site(property_id / site_id) the same way.
--
-- The app twin: crm.functions.ts listAccounts refuses a technician-only user (bookAccess);
-- getAccount / listContacts / searchAccounts keep readAccess and the database returns the
-- technician only what these policies admit. Idempotent throughout. Pinned by
-- src/lib/technician-customer-fence.test.ts.

-- 1. ------------------------------------------------------------------------------------------
create or replace function public.tech_sees_account(acct uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select acct is not null and exists (
    select 1 from public.service_jobs j
     where j.account_id = acct and j.deleted_at is null
       and (j.technician_id = auth.uid() or public.is_on_crew(j.id))
  );
$$;
revoke all on function public.tech_sees_account(uuid) from public;
grant execute on function public.tech_sees_account(uuid) to authenticated;
comment on function public.tech_sees_account(uuid) is
  'Is this customer the account of a live ticket the caller leads or is on the crew of? (Oct 20: a technician''s window on the customer book.)';

create or replace function public.tech_sees_site(site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select site is not null and exists (
    select 1 from public.service_jobs j
     where j.site_id = site and j.deleted_at is null
       and (j.technician_id = auth.uid() or public.is_on_crew(j.id))
  );
$$;
revoke all on function public.tech_sees_site(uuid) from public;
grant execute on function public.tech_sees_site(uuid) to authenticated;
comment on function public.tech_sees_site(uuid) is
  'Is this property the site of a live ticket the caller leads or is on the crew of? (Oct 20.)';

create or replace function public.tech_sees_contact(contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select contact is not null and exists (
    select 1 from public.service_jobs j
     where j.contact_id = contact and j.deleted_at is null
       and (j.technician_id = auth.uid() or public.is_on_crew(j.id))
  );
$$;
revoke all on function public.tech_sees_contact(uuid) from public;
grant execute on function public.tech_sees_contact(uuid) to authenticated;
comment on function public.tech_sees_contact(uuid) is
  'Is this contact the contact of a live ticket the caller leads or is on the crew of? (Oct 20.)';

-- 2. ------------------------------------------------------------------------------------------
drop policy if exists crm_accounts_read on public.crm_accounts;
create policy crm_accounts_read on public.crm_accounts for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate')
         or (public.has_access('service') and not public.is_technician())
         or public.tech_sees_account(id));

drop policy if exists crm_sites_read on public.crm_sites;
create policy crm_sites_read on public.crm_sites for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate')
         or (public.has_access('service') and not public.is_technician())
         or public.tech_sees_site(id)
         or public.tech_sees_account(account_id));

drop policy if exists crm_contacts_read on public.crm_contacts;
create policy crm_contacts_read on public.crm_contacts for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate')
         or (public.has_access('service') and not public.is_technician())
         or public.tech_sees_contact(id)
         or public.tech_sees_account(account_id));

-- 3. property_sites_read, site_warranties_read, county_codes_read, crm_site_contacts_read:
--    left as they are (see the header).
