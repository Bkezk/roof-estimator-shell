-- Owner, Nov 3 (service pages review, item 50: "data in that should be useful not just raw
-- data"). Of 584 ticket rows in audit_log, 426 carried the ticket's field bookkeeping as if
-- someone had edited the ticket: "field status — → en_route", "on site at Nov 3, 2026",
-- "contacted at …", "helper count 0 → 1", "crew confirmed at …", the thumbnail-era marks and the
-- city/state copies — and the inspection column as two JSON documents of every answer.
--
-- 1. audit_row(): the ticket's stamps and copies join v_skip (as 20261026120000 wrote the body,
--    plus these entries): contacted_at (the contact log is the record), field_status / en_route_at
--    / on_site_at (the clock: service_time_entries and service_job_events hold it), helper_count /
--    crew_confirmed_at (the crew question; service_job_crew is the record), assigned_at /
--    escalated_at (dispatch bookkeeping), nothing_used_at / notes_skipped_at (the close-out's
--    marks), site_city / site_state (copies of the property). The `inspection` column stays, as a
--    sentence: "inspection checklist saved: 3 of 11 items flagged, grade C" — audit_inspection(),
--    below — and `changes.inspection` holds the two sentences, not the two documents.
-- 2. audit_col_name() / audit_label(): signature_path reads "signature — → signed", invoice_id
--    "invoice — → Invoice 1042" (they were a storage path and a uuid).
-- 3. crm_contact_log_apply(): a ticket contact no longer writes a second copy into
--    service_job_events (kind 'contact'): the ticket page already reads the contact log itself
--    (ticket-activity.tsx; lib/ticket-timeline.ts mergeTimeline skips the copies that exist).
--    The stamp on service_jobs.contacted_at stays. Existing copies are left as they are.
--
-- service-review-batch-c-nov3.test.ts pins all three.

-- 1a. The inspection sentence.
create or replace function public.audit_inspection(p_value jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'object' then null
    else
      'checklist saved: '
      || coalesce((select count(*) from jsonb_array_elements(coalesce(p_value -> 'items', '[]'::jsonb)) i
                    where i ->> 'status' = 'issue'), 0)
      || ' of '
      || coalesce(jsonb_array_length(case when jsonb_typeof(p_value -> 'items') = 'array' then p_value -> 'items' else '[]'::jsonb end), 0)
      || ' items flagged'
      || case when coalesce(p_value ->> 'grade', '') <> '' then ', grade ' || (p_value ->> 'grade') else '' end
      || case when (p_value ->> 'recommend_repairs')::boolean then ', repairs recommended' else '' end
  end;
$$;
revoke all on function public.audit_inspection(jsonb) from public, anon, authenticated;

-- 2. The column names and labels (20261012100000's bodies plus signature_path and invoice_id).
create or replace function public.audit_col_name(p_col text)
returns text language sql immutable set search_path = public as $$
  select replace(
    case
      when p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                     'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id', 'location_id',
                     'bid_id', 'opportunity_id', 'invoice_id')
        then left(p_col, -3)
      when p_col = 'signature_path' then 'signature'
      else p_col
    end, '_', ' ');
$$;

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
  if p_col = 'signature_path' then
    return 'signed';
  end if;
  begin
    if right(p_col, 3) = '_at' and jsonb_typeof(p_value) = 'string' then
      return to_char((v_text::timestamptz) at time zone 'America/New_York', 'Mon FMDD, YYYY');
    end if;
    if p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                 'approved_by', 'created_by', 'vendor_id', 'bill_to_vendor_id', 'site_id',
                 'account_id', 'contact_id', 'location_id', 'bid_id', 'opportunity_id', 'invoice_id') then
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
      elsif p_col = 'location_id' then
        select l.name into v_out from public.property_sites l where l.id = v_id;
      elsif p_col = 'account_id' then
        select a.name into v_out from public.crm_accounts a where a.id = v_id;
      elsif p_col = 'bid_id' then
        select b.name into v_out from public.bids b where b.id = v_id;
      elsif p_col = 'opportunity_id' then
        select o.title into v_out from public.crm_opportunities o where o.id = v_id;
      elsif p_col = 'invoice_id' then
        select rtrim('Invoice ' || coalesce(i.display_number, abs(i.number)::text, '')) into v_out
          from public.invoices i where i.id = v_id;
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

-- 1b. audit_row() as 20261026120000 wrote it, plus the v_skip entries and the inspection sentence.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at', 'stage_changed_at', 'done_at', 'done_by', 'done_by_name', 'notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'assignee', 'status_changed_at', 'data', 'notified_due_at', 'notify_failures', 'share_views', 'share_last_viewed_at', 'reminded_at', 'content_updated_at', 'content_saved_at',
    -- The ticket's field bookkeeping (Nov 3, review item 50; see the header).
    'contacted_at', 'field_status', 'en_route_at', 'on_site_at', 'helper_count', 'escalated_at', 'assigned_at', 'crew_confirmed_at', 'nothing_used_at', 'notes_skipped_at', 'site_city', 'site_state'];
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
      v_label := 'Property ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
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
    when 'service_jobs' then v_entity := 'ticket';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_label := rtrim('Ticket ' || coalesce(v_row ->> 'number', ''));
    when 'service_time_entries' then v_entity := 'ticket_time';
      v_entity_id := (v_row ->> 'service_job_id')::uuid;
      v_parent := 'service_job_id';
      select j.number::text into v_inv from public.service_jobs j where j.id = v_entity_id;
      if not found then
        if tg_op = 'DELETE' then
          return null; -- the ticket is gone (its time goes with it): its own row says so
        end if;
        v_inv := '';
      end if;
      v_label := rtrim('Ticket ' || v_inv) || ' time ''' || coalesce(v_old ->> 'kind', v_new ->> 'kind', '') || '''';
    when 'tasks' then v_entity := 'task';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_label := 'Task ''' || coalesce(v_old ->> 'title', v_new ->> 'title', '') || '''';
    when 'crm_opportunities' then v_entity := 'opportunity';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_label := 'Opportunity ''' || coalesce(v_old ->> 'title', v_new ->> 'title', '') || '''';
    when 'bids' then v_entity := 'bid';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_label := 'Bid ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
    when 'property_sites' then v_entity := 'site';
      v_entity_id := (v_row ->> 'property_id')::uuid;
      v_parent := 'property_id';
      select s.name into v_site from public.crm_sites s where s.id = v_entity_id;
      if not found then
        if tg_op = 'DELETE' then
          return null; -- the property is gone (its sites go with it): its own row says so
        end if;
        v_site := '';
      end if;
      v_label := 'Property ''' || v_site || ''' site ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';
    when 'site_warranties' then v_entity := 'site';
      v_entity_id := (v_row ->> 'site_id')::uuid;
      v_parent := 'site_id';
      select s.name into v_site from public.crm_sites s where s.id = v_entity_id;
      if not found then
        if tg_op = 'DELETE' then
          return null; -- the property is gone (its warranties go with it): its own row says so
        end if;
        v_site := '';
      end if;
      v_label := 'Property ''' || v_site || ''' warranty '''
                 || btrim(coalesce(v_old ->> 'manufacturer', v_new ->> 'manufacturer', '') || ' '
                          || coalesce(v_old ->> 'kind', v_new ->> 'kind', '')) || '''';
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
      -- The inspection checklist (Nov 3): its two JSON documents are the summaries, not the raw
      -- answers (the ticket holds those).
      if v_col = 'inspection' then
        v_from := to_jsonb(public.audit_inspection(v_from));
        v_to := to_jsonb(public.audit_inspection(v_to));
      end if;
      v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('from', v_from, 'to', v_to));
      v_count := v_count + 1;
      if v_action <> 'delete' and v_count <= 6 then
        v_parts := v_parts || (
          case
            when v_col in ('archived_at', 'deleted_at') and public.audit_blank(v_from)
              then case when v_col = 'archived_at' then 'archived' else 'deleted' end
            when v_col in ('archived_at', 'deleted_at') and public.audit_blank(v_to)
              then 'restored'
            when v_col = 'inspection'
              then 'inspection ' || coalesce(v_to #>> '{}', 'checklist cleared')
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

-- 3. A ticket contact: the stamp, no second copy.
create or replace function public.crm_contact_log_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A note, a comment or a "service done" row is not a contact: nothing is stamped or moved.
  if new.method in ('note', 'comment', 'service') then
    return new;
  end if;
  if new.kind = 'ticket' then
    update public.service_jobs set contacted_at = new.at
     where id = new.item_id and (contacted_at is null or contacted_at < new.at);
  else
    update public.crm_opportunities
       set contacted_at = greatest(coalesce(contacted_at, new.at), new.at),
           status = case when status = 'open' then 'contacted' else status end,
           updated_by_name = coalesce(new.by_name, updated_by_name)
     where id = new.item_id;
  end if;
  return new;
end $$;
