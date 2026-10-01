-- Two owner rules (Oct 1). Idempotent: safe to run again.
--
-- A. "Invoiced and Closed are a manager's": only an admin or a manager moves a ticket to
--    Invoiced or Closed. A technician sets Open / Scheduled / Done; an office user or a sales /
--    project manager the same. The app twin is stageProblem (src/lib/ticket-stage.ts). An
--    invoice still marks its ticket Invoiced when it is finalised (Closed when paid) for whoever
--    may finalise it (a sales / project manager too): through set_ticket_stage_from_invoice,
--    SECURITY DEFINER, which checks the invoice and is the one path the trigger lets through.
--
-- B. "It's essential we record all actions accurately and durably": the audit log is written by
--    the database. Every insert / update / delete on invoices, invoice_lines, crm_accounts,
--    crm_sites and crm_contacts (and crm_site_contacts, a contact's sites) writes its own
--    audit_log row, so a direct database write is logged too. The app no longer writes
--    audit_log (logAudit is gone); the insert policy for it is dropped.

-- ============================================================================================
-- A1. The stage rule on service_jobs.
--
-- Refused: a change of stage to 'invoiced' or 'closed' (or a new ticket at one of them) by a
-- signed-in user who is neither an admin nor a manager. Allowed: no signed-in user (migrations,
-- the SQL editor), the service role, admins, managers, and the invoice path (the transaction
-- flag jbk.stage_from_invoice, set only inside set_ticket_stage_from_invoice; a client cannot
-- set it: PostgREST exposes no set_config and each request is its own transaction).
create or replace function public.service_jobs_stage_rule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage in ('invoiced', 'closed')
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage)
     and auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin()
     and not public.is_manager()
     and coalesce(current_setting('jbk.stage_from_invoice', true), '') <> 'on'
  then
    raise exception 'Only a manager invoices or closes a ticket' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.service_jobs_stage_rule() from public;

drop trigger if exists service_jobs_stage_rule on public.service_jobs;
create trigger service_jobs_stage_rule before insert or update of stage on public.service_jobs
  for each row execute function public.service_jobs_stage_rule();

-- A2. The invoice path. Finalising (or sending a draft) marks the ticket Invoiced and points it
-- at the invoice; marking the invoice paid marks the ticket Closed. The caller must see invoices
-- (admin, manager or sales / PM — the twin of seesInvoices) and the ticket must have such an
-- invoice: Invoiced needs a final / sent / paid one, Closed a paid one (p_invoice, when given,
-- must be it). Called by finalizeInvoice, sendInvoice and markInvoicePaid
-- (src/lib/invoices.functions.ts ticketStageFromInvoice).
create or replace function public.set_ticket_stage_from_invoice(
  p_job uuid,
  p_stage text,
  p_invoice uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
  v_name text;
begin
  if auth.uid() is not null and not (public.is_admin() or public.is_manager() or public.is_sales_pm()) then
    raise exception 'Invoices are a manager''s or sales''' using errcode = '42501';
  end if;
  if p_stage = 'invoiced' then
    select exists (
      select 1 from public.invoices i
      where i.service_job_id = p_job
        and (p_invoice is null or i.id = p_invoice)
        and i.status in ('final', 'sent', 'paid')
    ) into v_ok;
  elsif p_stage = 'closed' then
    select exists (
      select 1 from public.invoices i
      where i.service_job_id = p_job
        and (p_invoice is null or i.id = p_invoice)
        and i.status = 'paid'
    ) into v_ok;
  else
    raise exception 'An invoice sets a ticket Invoiced or Closed, not %', p_stage;
  end if;
  if not v_ok then
    raise exception 'The ticket has no % invoice for that',
      case when p_stage = 'invoiced' then 'final' else 'paid' end;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), p.email) into v_name
    from public.profiles p where p.id = auth.uid();

  perform set_config('jbk.stage_from_invoice', 'on', true);
  update public.service_jobs
     set stage = p_stage,
         invoice_id = case when p_stage = 'invoiced' then coalesce(p_invoice, invoice_id)
                           else invoice_id end,
         updated_by_name = coalesce(v_name, updated_by_name)
   where id = p_job;
  perform set_config('jbk.stage_from_invoice', '', true);
end;
$$;
revoke all on function public.set_ticket_stage_from_invoice(uuid, text, uuid) from public, anon;
grant execute on function public.set_ticket_stage_from_invoice(uuid, text, uuid) to authenticated;

-- ============================================================================================
-- B1. Helpers for the summaries: "nothing" (null, blank text, an empty list), equality that
-- treats all nothings alike (jsonb compares numbers by value: 85.00 = 85; objects by content),
-- and a value in words like the app's History (audit.ts before this migration): — for nothing,
-- yes / no, numbers to 4 places without trailing zeros, text quoted (60 characters), a list
-- joined with commas, an object as JSON (80 characters).
create or replace function public.audit_blank(v jsonb)
returns boolean language sql immutable set search_path = public as $$
  select v is null
      or v = 'null'::jsonb
      or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
      or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0);
$$;

create or replace function public.audit_same(a jsonb, b jsonb)
returns boolean language sql immutable set search_path = public as $$
  select case
    when public.audit_blank(a) or public.audit_blank(b)
      then public.audit_blank(a) and public.audit_blank(b)
    else a = b
  end;
$$;

create or replace function public.audit_fmt(v jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  s text;
begin
  if public.audit_blank(v) then
    return '—';
  end if;
  case jsonb_typeof(v)
    when 'boolean' then
      return case when v = 'true'::jsonb then 'yes' else 'no' end;
    when 'number' then
      return trim_scale(round((v #>> '{}')::numeric, 4))::text;
    when 'string' then
      s := v #>> '{}';
      return '''' || case when length(s) > 60 then left(s, 59) || '…' else s end || '''';
    when 'array' then
      return (
        select string_agg(
          case when jsonb_typeof(e) = 'string' then e #>> '{}' else public.audit_fmt(e) end,
          ', ' order by o)
        from jsonb_array_elements(v) with ordinality as t(e, o)
      );
    else
      s := v::text;
      return case when length(s) > 80 then left(s, 79) || '…' else s end;
  end case;
end;
$$;

revoke all on function public.audit_blank(jsonb) from public, anon, authenticated;
revoke all on function public.audit_same(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.audit_fmt(jsonb) from public, anon, authenticated;

-- B2. The row trigger. SECURITY DEFINER (owned by the migration's role, the tables' owner), so
-- its insert into audit_log is not subject to audit_log's RLS: no insert policy is needed and
-- none is left for clients.
--
-- entity / entity_id: invoices → invoice (its id); invoice_lines → invoice_line (the invoice's
-- id, the line named in the summary); crm_accounts → account; crm_sites → site; crm_contacts →
-- contact; crm_site_contacts → contact (the contact's id; "site 'X' linked / unlinked").
--
-- action: insert = create, delete = delete; on update: deleted_at set = delete (a soft delete),
-- deleted_at cleared = update "restored"; on invoices: status → void = void, paid_on newly set
-- (or status → paid) = paid, sent_at newly set or changed (a re-send) = send, draft → final =
-- finalize; anything else = update.
--
-- changes: {column: {from, to}} for every column that changed, in table order, leaving out the
-- bookkeeping columns (v_skip): id, created_at, created_by, updated_at, updated_by_name,
-- pdf_path, sage_exported_at, sort (a line's position). On a create / delete the parent key
-- (invoice_lines.invoice_id, crm_sites / crm_contacts.account_id, invoices.service_job_id) is
-- left out too (it is the entity_id or the row's place, not a value). A create lists the set
-- columns (from null), a hard delete the last values (to null). An update that changed nothing
-- outside v_skip writes no row — except a Sage export (sage_exported_at newly set alone):
-- "Invoice 6012 exported to Sage".
--
-- An invoice line deleted because its invoice was deleted (the cascade) and a contact / site
-- link deleted with its contact or site write no row: the parent's own delete row says it.
--
-- who: by_user = auth.uid(); by_name / by_role from profiles (role 'sales' for a sales /
-- project manager, 'technician' for a technician user); no signed-in user (the service role,
-- migrations, the SQL editor) = by_name 'system', by_role null.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort'];
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
          replace(v_col, '_', ' ') || ' ' ||
          case when public.audit_blank(v_from) and v_action <> 'update'
            then public.audit_fmt(v_to)
            else public.audit_fmt(v_from) || ' → ' || public.audit_fmt(v_to)
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

drop trigger if exists invoices_audit on public.invoices;
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.audit_row();
drop trigger if exists invoice_lines_audit on public.invoice_lines;
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function public.audit_row();
drop trigger if exists crm_accounts_audit on public.crm_accounts;
create trigger crm_accounts_audit after insert or update or delete on public.crm_accounts
  for each row execute function public.audit_row();
drop trigger if exists crm_sites_audit on public.crm_sites;
create trigger crm_sites_audit after insert or update or delete on public.crm_sites
  for each row execute function public.audit_row();
drop trigger if exists crm_contacts_audit on public.crm_contacts;
create trigger crm_contacts_audit after insert or update or delete on public.crm_contacts
  for each row execute function public.audit_row();
drop trigger if exists crm_site_contacts_audit on public.crm_site_contacts;
create trigger crm_site_contacts_audit after insert or delete on public.crm_site_contacts
  for each row execute function public.audit_row();

-- B3. audit_log stays append-only and is written only by the trigger: the app's insert policy
-- (20261001070000 audit_log_insert) goes, and nobody but the table owner may insert, change or
-- empty it (the service role neither). Reading stays audit_log_read (admins and managers).
drop policy if exists audit_log_insert on public.audit_log;
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;
