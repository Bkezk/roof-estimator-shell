-- Customers audit, Nov 6 (docs/qa/customers-audit-2026-11-06.md; owner: "fix all please").
--
-- 3. RESTORE KEEPS THE PRIMARY. crm_contact_primary_before cleared is_primary on any row being
--    deleted, so a customer deleted and then restored came back with no primary contact (the
--    header said "no primary contact marked", and the next primary — or a merge — overwrote the
--    customer's phones and email). The flag now stays on a soft-deleted row: the mirror
--    (crm_contact_primary_after) and the one-primary index (crm_contacts_one_primary) already
--    ignore deleted rows, every reader filters them, and marking another contact primary unmarks
--    deleted ones too — so a restore brings the flag back with the row.
-- 4. A MERGED CUSTOMER IS NOT RESTORED. merge_accounts records where the merged customer went
--    (crm_accounts.merged_into); its page offers no Restore and restoreAccount refuses.

-- ---- 3 ---------------------------------------------------------------------------------------

create or replace function public.crm_contact_primary_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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

-- ---- 4 ---------------------------------------------------------------------------------------

alter table public.crm_accounts
  add column if not exists merged_into uuid references public.crm_accounts(id) on delete set null;

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

  -- The merged customer: deleted, with the note and where it went (merged_into).
  update public.crm_accounts set
    deleted_at = now(),
    merged_into = p_keep,
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
