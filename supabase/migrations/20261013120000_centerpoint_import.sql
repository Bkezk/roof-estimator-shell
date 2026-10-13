-- CenterPoint import (owner, Oct 13; src/lib/centerpoint-import.ts, src/lib/centerpoint-import.test.ts
-- pins this file). The Book of Business export is read into crm_accounts / crm_sites /
-- crm_contacts by an admin from Admin › Import from CenterPoint. Idempotent.
--
-- 1. Twins: two CenterPoint companies (or two properties under one company) with the same name
--    and address fold into one row; the folded row's CenterPoint ID is kept here so a re-run
--    recognises it and the later ticket import can find the customer by either ID.
alter table public.crm_accounts
  add column if not exists centerpoint_alias_ids text[] not null default '{}';
alter table public.crm_sites
  add column if not exists centerpoint_alias_ids text[] not null default '{}';
comment on column public.crm_accounts.centerpoint_alias_ids is
  'CenterPoint company IDs folded into this customer by the import (same name and address).';
comment on column public.crm_sites.centerpoint_alias_ids is
  'CenterPoint property IDs folded into this property by the import (same name and address).';
-- audit_row() lists its skipped columns in a hard-coded constant (v_skip); the alias columns
-- stay audited, which is fine: they are written once, by the import.

-- 2. A customer imported from CenterPoint may have no email or phone anywhere (decision 2: the
--    office fills it in; the Customers page shows "No contact info"). The rule for everyone else
--    is unchanged: a live customer saved by hand needs one. Same expression as
--    20260930090000_customer_manager_mailing.sql plus `source = 'import'`; still NOT VALID.
alter table public.crm_accounts drop constraint if exists crm_accounts_contact_required;
alter table public.crm_accounts add constraint crm_accounts_contact_required check (
  deleted_at is not null
  or source = 'import'
  or nullif(btrim(email), '') is not null
  or nullif(btrim(phone), '') is not null
  or nullif(btrim(mobile), '') is not null
) not valid;

-- 3. One live row per CenterPoint ID, so a re-run (or two admins clicking Import) cannot create
--    the same customer, property or contact twice. Deleted rows are exempt: a deleted customer
--    with the ID does not block importing it again.
create unique index if not exists crm_accounts_centerpoint_company_id_key
  on public.crm_accounts (centerpoint_company_id)
  where centerpoint_company_id is not null and deleted_at is null;
create unique index if not exists crm_sites_centerpoint_property_id_key
  on public.crm_sites (centerpoint_property_id)
  where centerpoint_property_id is not null and deleted_at is null;
create unique index if not exists crm_contacts_centerpoint_contact_id_key
  on public.crm_contacts (centerpoint_contact_id)
  where centerpoint_contact_id is not null and deleted_at is null;
