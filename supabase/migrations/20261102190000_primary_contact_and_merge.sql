-- The customer's contact is one Primary contact row, and an admin can merge two customers
-- (owner, Nov 2, from the Customers page suggestions).
--
-- 1. PRIMARY CONTACT. A customer carried its own Contact / Cell phone / Office phone / Email
--    (crm_accounts.contact_name, mobile, phone, email) AND a Contacts list (crm_contacts); 500 of
--    the 509 named account contacts were also a contact row with the same name, and the office
--    would update one and not the other. Now one contact row per customer is marked
--    `is_primary` (crm_contacts_one_primary: one live primary per customer), and the customer's
--    four fields are a MIRROR of that row, kept by trigger — every reader (the list, the search,
--    the ticket's customer line, the documents' "Submitted to", the CenterPoint check
--    constraint crm_accounts_contact_required) keeps working unchanged, while the page edits the
--    person under Contacts only. Marking a contact primary unmarks the previous one; a primary
--    contact must be reachable (email or a phone) unless no one on the customer is; a deleted
--    contact is never primary. When the primary is deleted or unmarked the customer keeps the
--    last mirrored values (the page says "No primary contact") so the customer stays reachable.
--    Backfill: the matching row by name is marked (its blanks filled from the customer; a value
--    that differed is kept in the contact's notes); a customer with contact info but no matching
--    row gets one. The audit and updated_at triggers are off for the backfill: it changes no
--    fact anyone typed.
-- 2. MERGE. merge_accounts(p_keep, p_drop), admins only, one transaction: every row linked to the
--    merged customer (properties, contacts, tickets, bids, opportunities, tasks, takeoffs,
--    documents, follow-ups) moves to the kept one; what the kept customer lacked (account
--    manager, Sage #, billing instructions, address, contact, CenterPoint ids) is taken from the
--    merged one, the notes are joined; the merged customer is deleted with a note saying where
--    it went, and the audit log records the merge on the kept customer with the counts.

-- ---- 1. the primary contact ---------------------------------------------------------------

alter table public.crm_contacts add column if not exists is_primary boolean not null default false;
create unique index if not exists crm_contacts_one_primary
  on public.crm_contacts (account_id) where is_primary and deleted_at is null;

create or replace function public.crm_contact_primary_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null then
    new.is_primary := false;
  end if;
  if new.is_primary and (tg_op = 'INSERT' or not old.is_primary or old.account_id <> new.account_id) then
    if nullif(btrim(coalesce(new.email, '')), '') is null
       and nullif(btrim(coalesce(new.mobile, '')), '') is null
       and nullif(btrim(coalesce(new.office_phone, '')), '') is null
       and exists (
         select 1 from public.crm_accounts a
          where a.id = new.account_id
            and (nullif(btrim(a.email), '') is not null
                 or nullif(btrim(a.phone), '') is not null
                 or nullif(btrim(a.mobile), '') is not null)) then
      raise exception 'The primary contact needs an email or a phone number';
    end if;
    update public.crm_contacts c set is_primary = false
     where c.account_id = new.account_id and c.id <> new.id and c.is_primary;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_contact_primary_before() from public;

create or replace function public.crm_contact_primary_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_primary and new.deleted_at is null then
    update public.crm_accounts a
       set contact_name = new.name, mobile = new.mobile, phone = new.office_phone, email = new.email
     where a.id = new.account_id
       and (a.contact_name is distinct from new.name
            or a.mobile is distinct from new.mobile
            or a.phone is distinct from new.office_phone
            or a.email is distinct from new.email);
  end if;
  return null;
end;
$$;
revoke all on function public.crm_contact_primary_after() from public;

drop trigger if exists crm_contacts_primary_before on public.crm_contacts;
create trigger crm_contacts_primary_before before insert or update on public.crm_contacts
  for each row execute function public.crm_contact_primary_before();
drop trigger if exists crm_contacts_primary_after on public.crm_contacts;
create trigger crm_contacts_primary_after after insert or update on public.crm_contacts
  for each row execute function public.crm_contact_primary_after();

-- The backfill, with the history and updated_at triggers off (nothing anyone typed changes).
alter table public.crm_contacts disable trigger crm_contacts_audit;
alter table public.crm_contacts disable trigger crm_contacts_updated_at;
alter table public.crm_accounts disable trigger crm_accounts_audit;
alter table public.crm_accounts disable trigger crm_accounts_updated_at;

-- (a) The contact row named as the customer's contact: marked primary, its blanks filled from
--     the customer, a value that differed kept in its notes (the mirror then takes the row's).
with m as (
  select distinct on (a.id) a.id as account_id, c.id as contact_id,
         nullif(btrim(a.mobile), '') as a_mobile, nullif(btrim(a.phone), '') as a_phone,
         nullif(btrim(a.email), '') as a_email
    from public.crm_accounts a
    join public.crm_contacts c
      on c.account_id = a.id and c.deleted_at is null
     and lower(btrim(c.name)) = lower(btrim(a.contact_name))
   where a.deleted_at is null and nullif(btrim(a.contact_name), '') is not null
   order by a.id, c.is_billing desc, c.created_at
)
update public.crm_contacts c
   set is_primary = true,
       mobile = coalesce(nullif(btrim(c.mobile), ''), m.a_mobile),
       office_phone = coalesce(nullif(btrim(c.office_phone), ''), m.a_phone),
       email = coalesce(nullif(btrim(c.email), ''), m.a_email),
       notes = concat_ws(E'\n', nullif(c.notes, ''), nullif(
         'The customer also had: ' || concat_ws(', ',
           case when m.a_mobile is not null and nullif(btrim(c.mobile), '') is not null
                 and btrim(c.mobile) <> m.a_mobile then 'cell ' || m.a_mobile end,
           case when m.a_phone is not null and nullif(btrim(c.office_phone), '') is not null
                 and btrim(c.office_phone) <> m.a_phone then 'office ' || m.a_phone end,
           case when m.a_email is not null and nullif(btrim(c.email), '') is not null
                 and lower(btrim(c.email)) <> lower(m.a_email) then 'email ' || m.a_email end),
         'The customer also had: '))
  from m
 where c.id = m.contact_id;

-- (b) A customer with contact info and no row to point at: one is made from it.
insert into public.crm_contacts (account_id, name, mobile, office_phone, email, is_primary)
select a.id, coalesce(nullif(btrim(a.contact_name), ''), a.name),
       nullif(btrim(a.mobile), ''), nullif(btrim(a.phone), ''), nullif(btrim(a.email), ''), true
  from public.crm_accounts a
 where a.deleted_at is null
   and (nullif(btrim(a.contact_name), '') is not null or nullif(btrim(a.mobile), '') is not null
        or nullif(btrim(a.phone), '') is not null or nullif(btrim(a.email), '') is not null)
   and not exists (select 1 from public.crm_contacts c
                    where c.account_id = a.id and c.deleted_at is null and c.is_primary);

alter table public.crm_contacts enable trigger crm_contacts_audit;
alter table public.crm_contacts enable trigger crm_contacts_updated_at;
alter table public.crm_accounts enable trigger crm_accounts_audit;
alter table public.crm_accounts enable trigger crm_accounts_updated_at;

-- save_contact_with_sites (20261002130000) learns is_primary; everything else as it was.
create or replace function public.save_contact_with_sites(p_contact jsonb, p_site_ids uuid[] default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p_contact ->> 'id', '')::uuid;
  v_account uuid := nullif(p_contact ->> 'account_id', '')::uuid;
  v_row public.crm_contacts;
  v_sites uuid[];
begin
  if v_account is null then
    raise exception 'The contact needs its customer';
  end if;
  if not exists (select 1 from public.crm_accounts a where a.id = v_account and a.deleted_at is null) then
    raise exception 'This customer was deleted; an admin or a manager can restore it';
  end if;
  if p_site_ids is not null and exists (
    select 1 from unnest(p_site_ids) as t(site_id)
     where not exists (
       select 1 from public.crm_sites s
        where s.id = t.site_id and s.account_id = v_account and s.deleted_at is null)
  ) then
    raise exception 'A site picked is not one of this customer''s sites';
  end if;
  if v_id is null then
    insert into public.crm_contacts (account_id, name, position, email, mobile, office_phone, is_billing, is_primary, notes)
    values (v_account, p_contact ->> 'name', p_contact ->> 'position', p_contact ->> 'email',
            p_contact ->> 'mobile', p_contact ->> 'office_phone',
            coalesce((p_contact ->> 'is_billing')::boolean, false),
            coalesce((p_contact ->> 'is_primary')::boolean, false), p_contact ->> 'notes')
    returning * into v_row;
  else
    update public.crm_contacts c set
      name = case when p_contact ? 'name' then p_contact ->> 'name' else c.name end,
      position = case when p_contact ? 'position' then p_contact ->> 'position' else c.position end,
      email = case when p_contact ? 'email' then p_contact ->> 'email' else c.email end,
      mobile = case when p_contact ? 'mobile' then p_contact ->> 'mobile' else c.mobile end,
      office_phone = case when p_contact ? 'office_phone' then p_contact ->> 'office_phone' else c.office_phone end,
      is_billing = case when p_contact ? 'is_billing'
                     then coalesce((p_contact ->> 'is_billing')::boolean, false) else c.is_billing end,
      is_primary = case when p_contact ? 'is_primary'
                     then coalesce((p_contact ->> 'is_primary')::boolean, false) else c.is_primary end,
      notes = case when p_contact ? 'notes' then p_contact ->> 'notes' else c.notes end
    where c.id = v_id and c.account_id = v_account and c.deleted_at is null
    returning * into v_row;
    if not found then
      raise exception 'Contact not found';
    end if;
  end if;
  if p_site_ids is not null then
    delete from public.crm_site_contacts sc
     where sc.contact_id = v_row.id and not (sc.site_id = any (p_site_ids));
    insert into public.crm_site_contacts (site_id, contact_id)
      select distinct t.site_id, v_row.id from unnest(p_site_ids) as t(site_id)
      on conflict (site_id, contact_id) do nothing;
  end if;
  select coalesce(array_agg(sc.site_id order by sc.site_id), '{}') into v_sites
    from public.crm_site_contacts sc where sc.contact_id = v_row.id;
  return to_jsonb(v_row) || jsonb_build_object('site_ids', to_jsonb(v_sites));
end;
$$;

-- ---- 2. merge --------------------------------------------------------------------------------

create or replace function public.merge_accounts(p_keep uuid, p_drop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_keep public.crm_accounts;
  v_drop public.crm_accounts;
  n_sites int; n_contacts int; n_jobs int; n_bids int; n_opps int;
  n_tasks int; n_takeoffs int; n_docs int; n_followups int;
  v_name text;
  v_parts text[] := '{}';
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can merge customers';
  end if;
  if p_keep = p_drop then
    raise exception 'Pick a different customer to merge into';
  end if;
  select * into v_keep from public.crm_accounts where id = p_keep and deleted_at is null for update;
  if not found then
    raise exception 'The customer to keep was not found, or is deleted';
  end if;
  select * into v_drop from public.crm_accounts where id = p_drop and deleted_at is null for update;
  if not found then
    raise exception 'The customer to merge was not found, or is deleted';
  end if;

  -- A primary contact on both: the kept customer's stays primary.
  if exists (select 1 from public.crm_contacts
              where account_id = p_keep and is_primary and deleted_at is null) then
    update public.crm_contacts set is_primary = false where account_id = p_drop and is_primary;
  end if;

  update public.crm_sites set account_id = p_keep where account_id = p_drop;
  get diagnostics n_sites = row_count;
  update public.crm_contacts set account_id = p_keep where account_id = p_drop;
  get diagnostics n_contacts = row_count;
  update public.service_jobs set account_id = p_keep, customer_name = v_keep.name where account_id = p_drop;
  get diagnostics n_jobs = row_count;
  update public.bids set account_id = p_keep where account_id = p_drop;
  get diagnostics n_bids = row_count;
  update public.crm_opportunities set account_id = p_keep where account_id = p_drop;
  get diagnostics n_opps = row_count;
  update public.tasks set account_id = p_keep, account_name = v_keep.name where account_id = p_drop;
  get diagnostics n_tasks = row_count;
  update public.takeoffs set account_id = p_keep where account_id = p_drop;
  get diagnostics n_takeoffs = row_count;
  update public.documents set account_id = p_keep where account_id = p_drop;
  get diagnostics n_docs = row_count;
  update public.crm_followups set account_id = p_keep where account_id = p_drop;
  get diagnostics n_followups = row_count;

  -- What the kept customer lacked, from the merged one; the notes joined; the ids kept.
  update public.crm_accounts a set
    account_manager_id = coalesce(a.account_manager_id, v_drop.account_manager_id),
    external_id = coalesce(nullif(btrim(a.external_id), ''), nullif(btrim(v_drop.external_id), '')),
    billing_instructions = coalesce(nullif(btrim(a.billing_instructions), ''), nullif(btrim(v_drop.billing_instructions), '')),
    contact_name = coalesce(nullif(btrim(a.contact_name), ''), nullif(btrim(v_drop.contact_name), '')),
    mobile = coalesce(nullif(btrim(a.mobile), ''), nullif(btrim(v_drop.mobile), '')),
    phone = coalesce(nullif(btrim(a.phone), ''), nullif(btrim(v_drop.phone), '')),
    email = coalesce(nullif(btrim(a.email), ''), nullif(btrim(v_drop.email), '')),
    address1 = case when nullif(btrim(a.address1), '') is null then v_drop.address1 else a.address1 end,
    address2 = case when nullif(btrim(a.address1), '') is null then v_drop.address2 else a.address2 end,
    city = case when nullif(btrim(a.address1), '') is null then v_drop.city else a.city end,
    state = case when nullif(btrim(a.address1), '') is null then v_drop.state else a.state end,
    zip = case when nullif(btrim(a.address1), '') is null then v_drop.zip else a.zip end,
    notes = concat_ws(E'\n', nullif(a.notes, ''), nullif(v_drop.notes, '')),
    centerpoint_company_id = coalesce(a.centerpoint_company_id, v_drop.centerpoint_company_id),
    centerpoint_alias_ids = (
      select coalesce(array_agg(distinct x), '{}')
        from unnest(a.centerpoint_alias_ids || v_drop.centerpoint_alias_ids
                    || case when v_drop.centerpoint_company_id is not null
                            and v_drop.centerpoint_company_id is distinct from a.centerpoint_company_id
                            then array[v_drop.centerpoint_company_id] else '{}'::text[] end) as x),
    tax_exempt = a.tax_exempt or v_drop.tax_exempt
  where a.id = p_keep;

  update public.crm_accounts set
    deleted_at = now(),
    notes = concat_ws(E'\n', nullif(notes, ''),
      'Merged into ' || v_keep.name || ' on '
      || to_char(now() at time zone 'America/New_York', 'Mon FMDD, YYYY'))
  where id = p_drop;

  if n_sites > 0 then v_parts := v_parts || (n_sites || ' propert' || case when n_sites = 1 then 'y' else 'ies' end); end if;
  if n_contacts > 0 then v_parts := v_parts || (n_contacts || ' contact' || case when n_contacts = 1 then '' else 's' end); end if;
  if n_jobs > 0 then v_parts := v_parts || (n_jobs || ' ticket' || case when n_jobs = 1 then '' else 's' end); end if;
  if n_bids > 0 then v_parts := v_parts || (n_bids || ' bid' || case when n_bids = 1 then '' else 's' end); end if;
  if n_opps > 0 then v_parts := v_parts || (n_opps || ' opportunit' || case when n_opps = 1 then 'y' else 'ies' end); end if;
  if n_tasks > 0 then v_parts := v_parts || (n_tasks || ' task' || case when n_tasks = 1 then '' else 's' end); end if;
  if n_takeoffs > 0 then v_parts := v_parts || (n_takeoffs || ' takeoff' || case when n_takeoffs = 1 then '' else 's' end); end if;
  if n_docs > 0 then v_parts := v_parts || (n_docs || ' document' || case when n_docs = 1 then '' else 's' end); end if;
  if n_followups > 0 then v_parts := v_parts || (n_followups || ' follow-up' || case when n_followups = 1 then '' else 's' end); end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), 'Unknown user')
    into v_name from public.profiles p where p.id = auth.uid();
  v_counts := jsonb_build_object(
    'merged_from', v_drop.name, 'merged_from_id', p_drop,
    'properties', n_sites, 'contacts', n_contacts, 'tickets', n_jobs, 'bids', n_bids,
    'opportunities', n_opps, 'tasks', n_tasks, 'takeoffs', n_takeoffs, 'documents', n_docs,
    'followups', n_followups);
  insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes)
  values (auth.uid(), coalesce(v_name, 'system'), 'admin', 'account', p_keep, 'update',
          'Customer ''' || v_drop.name || ''' merged into ''' || v_keep.name || ''''
          || case when coalesce(array_length(v_parts, 1), 0) = 0 then '' else ': ' || array_to_string(v_parts, ', ') end,
          v_counts);
  return v_counts || jsonb_build_object('kept', p_keep, 'kept_name', v_keep.name);
end;
$$;
revoke all on function public.merge_accounts(uuid, uuid) from public, anon;
grant execute on function public.merge_accounts(uuid, uuid) to authenticated;
