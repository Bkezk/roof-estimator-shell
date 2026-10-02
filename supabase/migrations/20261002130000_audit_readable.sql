-- Readable History, and an atomic contact save (audit, Oct 2). Idempotent: safe to run again.
--
-- 1. The History (audit_log.summary, written by audit_row()) printed every changed column as
--    "<column> <from> → <to>" with the raw value: "county code id '6f1c…' → 'a2b3…'",
--    "account manager id '…' → '…'", "archived at — → '2026-10-01T14:03:07…'". Now:
--      - a reference column names the row it points at, and loses its "_id":
--        "county code 0073 Bath, KY → 0108 Kenton, KY" (county_codes: code, county, state),
--        "account manager Pat Office → Mo Manager" (profiles: full name, else email; also
--        assignee_id, technician_id, approved_by, created_by), "bill to vendor ABC Supply"
--        (vendors; also vendor_id), site_id → the site's name, account_id → the customer's,
--        contact_id → the contact's; a row that cannot be found → the raw value, as before;
--      - a timestamp (a column ending in _at) is a date: "Oct 1, 2026" (America/New_York);
--      - archived_at set reads "archived", cleared "restored"; deleted_at the same with
--        "deleted" / "restored" (a delete or a restore of a whole row was already its own
--        action and summary — "Customer 'X' deleted" / "Customer 'X' restored" — and stays so).
--    `changes` (the from / to per column) keeps the raw values. Every branch of audit_row()
--    is kept: it is 20261001110000_vendors.sql's exactly, but for the one expression that
--    prints a changed column (a test checks that).
-- 2. save_contact_with_sites(p_contact, p_site_ids): a contact and its site links in one
--    transaction (the app inserted the contact, then its links: a failed link left the contact
--    saved, and a retry made a duplicate). SECURITY INVOKER: the caller's RLS applies, as it did
--    to the app's own inserts.

-- ============================================================================================
-- 1a. A changed column's name in the summary: a reference column without its "_id".
create or replace function public.audit_col_name(p_col text)
returns text language sql immutable set search_path = public as $$
  select replace(
    case
      when p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                     'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id')
        then left(p_col, -3)
      else p_col
    end, '_', ' ');
$$;

-- 1b. A value in words, for one column of one table: a reference names its row, a timestamp is
-- a date, anything else is audit_fmt's (quoted text, yes / no, numbers, —). Never raises: a
-- value it cannot read is shown raw.
create or replace function public.audit_label(p_table text, p_col text, p_value jsonb)
returns text language plpgsql stable set search_path = public as $$
declare
  v_text text;
  v_id uuid;
  v_out text;
begin
  if public.audit_blank(p_value) then
    return '—';
  end if;
  v_text := p_value #>> '{}';
  begin
    if right(p_col, 3) = '_at' and jsonb_typeof(p_value) = 'string' then
      return to_char((v_text::timestamptz) at time zone 'America/New_York', 'Mon FMDD, YYYY');
    end if;
    if p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                 'approved_by', 'created_by', 'vendor_id', 'bill_to_vendor_id', 'site_id',
                 'account_id', 'contact_id') then
      v_id := v_text::uuid;
      if p_col = 'county_code_id' then
        select c.code || ' ' || c.county || ', ' || c.state into v_out
          from public.county_codes c where c.id = v_id;
      elsif p_col in ('account_manager_id', 'assignee_id', 'technician_id', 'approved_by', 'created_by') then
        select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), '')) into v_out
          from public.profiles p where p.id = v_id;
      elsif p_col in ('vendor_id', 'bill_to_vendor_id') then
        select v.name into v_out from public.vendors v where v.id = v_id;
      elsif p_col = 'site_id' then
        select s.name into v_out from public.crm_sites s where s.id = v_id;
      elsif p_col = 'account_id' then
        select a.name into v_out from public.crm_accounts a where a.id = v_id;
      else
        select c.name into v_out from public.crm_contacts c where c.id = v_id;
      end if;
      return coalesce(nullif(btrim(v_out), ''), public.audit_fmt(p_value));
    end if;
  exception when others then
    return public.audit_fmt(p_value);
  end;
  return public.audit_fmt(p_value);
end;
$$;

revoke all on function public.audit_col_name(text) from public, anon, authenticated;
revoke all on function public.audit_label(text, text, jsonb) from public, anon, authenticated;

-- 1c. audit_row() as 20261001110000_vendors.sql wrote it, but for the changed-column expression.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at'];
  v_parent text;
  v_entity text;
  v_entity_id uuid;
  v_label text;
  v_inv text;
  v_site text;
  v_action text;
  v_restored boolean := false;
  v_verb text;
  v_changes jsonb := '{}'::jsonb;
  v_parts text[] := '{}';
  v_count int := 0;
  v_summary text;
  v_col text;
  v_from jsonb;
  v_to jsonb;
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
begin
  -- Which entity, its id, and how the summary names the row (its name before the change).
  case tg_table_name
    when 'invoices' then v_entity := 'invoice';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_parent := 'service_job_id';
      v_label := rtrim('Invoice ' || coalesce(v_row ->> 'display_number',
                                               abs((v_row ->> 'number')::int)::text, ''));
    when 'invoice_lines' then v_entity := 'invoice_line';
      v_entity_id := (v_row ->> 'invoice_id')::uuid;
      v_parent := 'invoice_id';
      select coalesce(i.display_number, abs(i.number)::text, '') into v_inv
        from public.invoices i where i.id = v_entity_id;
      if not found then
        if tg_op = 'DELETE' then
          return null; -- the invoice is gone (its lines go with it): its own row says so
        end if;
        v_inv := '';
      end if;
      v_label := rtrim('Invoice ' || v_inv) || ' line '''
                 || coalesce(v_old ->> 'description', v_new ->> 'description', '') || '''';
    when 'crm_accounts' then v_entity := 'account';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_label := 'Customer ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
    when 'crm_sites' then v_entity := 'site';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_parent := 'account_id';
      v_label := 'Site ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
    when 'crm_contacts' then v_entity := 'contact';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_parent := 'account_id';
      v_label := 'Contact ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
    when 'service_job_purchase_orders' then v_entity := 'purchase_order';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_parent := 'service_job_id';
      v_label := 'PO ''' || coalesce(v_old ->> 'po_number', v_new ->> 'po_number', '') || '''';
    when 'vendors' then v_entity := 'vendor';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_label := 'Vendor ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
    when 'crm_site_contacts' then v_entity := 'contact';
      v_entity_id := (v_row ->> 'contact_id')::uuid;
      select c.name into v_label from public.crm_contacts c where c.id = v_entity_id;
      if not found then
        return null; -- the contact is gone: its own row says so
      end if;
      select s.name into v_site from public.crm_sites s where s.id = (v_row ->> 'site_id')::uuid;
      if not found then
        return null; -- the site is gone: its own row says so
      end if;
      v_action := 'update';
      v_summary := 'Contact ''' || v_label || ''' site ''' || v_site || ''''
                   || case when tg_op = 'INSERT' then ' linked' else ' unlinked' end;
      v_changes := jsonb_build_object('site', jsonb_build_object(
        'from', case when tg_op = 'DELETE' then to_jsonb(v_site) end,
        'to', case when tg_op = 'INSERT' then to_jsonb(v_site) end));
    else
      raise exception 'audit_row: no audit entity for table %', tg_table_name;
  end case;

  if v_summary is null then
    -- The action.
    if tg_op = 'INSERT' then v_action := 'create';
    elsif tg_op = 'DELETE' then v_action := 'delete';
    elsif v_old ? 'deleted_at' and v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then v_action := 'delete';
    elsif v_old ? 'deleted_at' and v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then v_action := 'update'; v_restored := true;
    elsif tg_table_name = 'invoices' then
      if v_new ->> 'status' = 'void' and v_old ->> 'status' is distinct from 'void' then v_action := 'void';
      elsif (v_old ->> 'paid_on' is null and v_new ->> 'paid_on' is not null) or (v_new ->> 'status' = 'paid' and v_old ->> 'status' is distinct from 'paid') then v_action := 'paid';
      elsif v_new ->> 'sent_at' is not null and v_new ->> 'sent_at' is distinct from v_old ->> 'sent_at' then v_action := 'send';
      elsif v_old ->> 'status' = 'draft' and v_new ->> 'status' = 'final' then v_action := 'finalize';
      else v_action := 'update';
      end if;
    else v_action := 'update';
    end if;

    -- The changed columns, in table order.
    for v_col in
      select a.attname::text from pg_attribute a
       where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
       order by a.attnum
    loop
      continue when v_col = any (v_skip);
      continue when v_col = v_parent and tg_op <> 'UPDATE';
      v_from := v_old -> v_col;
      v_to := v_new -> v_col;
      continue when public.audit_same(v_from, v_to);
      v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('from', v_from, 'to', v_to));
      v_count := v_count + 1;
      if v_action <> 'delete' and v_count <= 6 then
        v_parts := v_parts || (
          case
            when v_col in ('archived_at', 'deleted_at') and public.audit_blank(v_from)
              then case when v_col = 'archived_at' then 'archived' else 'deleted' end
            when v_col in ('archived_at', 'deleted_at') and public.audit_blank(v_to)
              then 'restored'
            else
              public.audit_col_name(v_col) || ' ' ||
              case when public.audit_blank(v_from) and v_action <> 'update'
                then public.audit_label(tg_table_name, v_col, v_to)
                else public.audit_label(tg_table_name, v_col, v_from) || ' → '
                     || public.audit_label(tg_table_name, v_col, v_to)
              end
          end);
      end if;
    end loop;

    if tg_op = 'UPDATE' and v_count = 0 then
      if tg_table_name = 'invoices' and v_new ->> 'sage_exported_at' is not null
         and v_new ->> 'sage_exported_at' is distinct from v_old ->> 'sage_exported_at' then
        v_summary := v_label || ' exported to Sage';
      else
        return null; -- nothing that matters changed
      end if;
    end if;

    if v_summary is null then
      if v_action <> 'delete' and v_count > 6 then
        v_parts := v_parts || ('+' || (v_count - 6) || ' more');
      end if;
      v_verb := case v_action
        when 'create' then case when v_entity = 'invoice_line' then 'added' else 'created' end
        when 'delete' then case when v_entity = 'invoice_line' then 'removed' else 'deleted' end
        when 'finalize' then 'finalized'
        when 'send' then 'sent'
        when 'paid' then 'marked paid'
        when 'void' then 'voided'
        else ''
      end;
      if v_restored then
        v_summary := v_label || ' restored';
      elsif coalesce(array_length(v_parts, 1), 0) = 0 then
        v_summary := case when v_verb = '' then v_label || ' saved' else v_label || ' ' || v_verb end;
      elsif v_verb = '' then
        v_summary := v_label || ' ' || array_to_string(v_parts, '; ');
      else
        v_summary := v_label || ' ' || v_verb || ': ' || array_to_string(v_parts, '; ');
      end if;
    end if;
  end if;

  -- Who.
  if v_uid is null then v_name := 'system'; v_role := null;
  else
    select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unknown user'),
           case
             when p.role = 'admin' then 'admin'
             when p.role = 'manager' then 'manager'
             when public.is_sales_pm() then 'sales'
             when coalesce(p.technician, false) then 'technician'
             else 'user'
           end
      into v_name, v_role
      from public.profiles p where p.id = v_uid;
    if not found then
      v_name := 'Unknown user';
      v_role := 'user';
    end if;
  end if;

  if v_changes = '{}'::jsonb then
    v_changes := null;
  end if;
  insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes) values (v_uid, v_name, v_role, v_entity, v_entity_id, v_action, v_summary, v_changes);
  return null;
end;
$$;
revoke all on function public.audit_row() from public;

-- ============================================================================================
-- 2. A contact and its sites in one transaction (crm.functions.ts saveContact calls it).
--    p_contact: the contact's fields that were sent — a key left out keeps that column (an
--    update), a null clears it; no "id" = a new contact. p_site_ids: the sites it is the contact
--    for (empty = the whole account); null keeps its links. Only the links that change are
--    deleted / inserted, so the audit log says "site 'X' linked / unlinked" for those alone.
--    Every site must be a live site of the contact's customer. Returns the contact row plus
--    "site_ids". SECURITY INVOKER: crm_contacts' and crm_site_contacts' RLS (Customers or
--    Service) decide, as for the app's own writes before.
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
    insert into public.crm_contacts (account_id, name, position, email, mobile, office_phone, is_billing, notes)
    values (v_account, p_contact ->> 'name', p_contact ->> 'position', p_contact ->> 'email',
            p_contact ->> 'mobile', p_contact ->> 'office_phone',
            coalesce((p_contact ->> 'is_billing')::boolean, false), p_contact ->> 'notes')
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
revoke all on function public.save_contact_with_sites(jsonb, uuid[]) from public, anon;
grant execute on function public.save_contact_with_sites(jsonb, uuid[]) to authenticated;
