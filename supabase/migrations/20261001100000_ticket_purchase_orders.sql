-- Purchase orders on service tickets (owner, Oct 1: replacing CenterPoint). A crew sometimes
-- buys material for a job on the way (Lowe's, a supply house); CenterPoint's close-out page
-- records it under "PO Information": Date, PO #, Title, Price, Notes, the receipt and Approved?.
-- The app side is src/lib/service-pos.functions.ts (pure helpers: src/lib/purchase-orders.ts)
-- and src/components/service/purchase-orders-section.tsx. The approved total is an internal
-- cost on the ticket's invoice (cost and margin only; never on the customer's invoice or PDF).
-- Idempotent: safe to run again.

-- 1. The table. The receipt (an image or a PDF) lives in the private "service" bucket at
-- <job id>/po-<time>-<random>.<ext> (the same bucket and naming discipline as
-- service_job_photos); the browser uploads it and the row records where.
create table if not exists public.service_job_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  po_date date not null default current_date,
  po_number text not null check (length(btrim(po_number)) between 1 and 60),
  title text,
  price numeric(12,2) not null check (price >= 0),
  notes text,
  receipt_path text,
  receipt_name text,
  receipt_size bigint,
  approved boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_job_purchase_orders_job_idx
  on public.service_job_purchase_orders (service_job_id);
drop trigger if exists service_job_purchase_orders_updated_at on public.service_job_purchase_orders;
create trigger service_job_purchase_orders_updated_at before update on public.service_job_purchase_orders
  for each row execute function public.update_updated_at_column();

-- 2. Who. Read: whoever reads the ticket (the twin of service_jobs_read: Customers, or Service
-- and not a plain technician, or the ticket's lead or crew). Write: Service access and working
-- the ticket (the office, its lead technician or a crew member) — a PO of one's own; admins and
-- managers any PO. The app twins are canAddPo / canEditPo (src/lib/purchase-orders.ts), checked
-- again in src/lib/service-pos.functions.ts.
alter table public.service_job_purchase_orders enable row level security;
drop policy if exists service_job_purchase_orders_read on public.service_job_purchase_orders;
create policy service_job_purchase_orders_read on public.service_job_purchase_orders
  for select to authenticated
  using (
    public.has_access('customers')
    or (public.has_access('service')
        and (not public.is_technician() or public.is_admin() or public.is_manager()
             or public.leads_job(service_job_id) or public.is_on_crew(service_job_id)))
  );
drop policy if exists service_job_purchase_orders_insert on public.service_job_purchase_orders;
create policy service_job_purchase_orders_insert on public.service_job_purchase_orders
  for insert to authenticated
  with check (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or public.is_manager()
         or public.leads_job(service_job_id) or public.is_on_crew(service_job_id))
  );
drop policy if exists service_job_purchase_orders_update on public.service_job_purchase_orders;
create policy service_job_purchase_orders_update on public.service_job_purchase_orders
  for update to authenticated
  using (
    public.has_access('service')
    and (public.is_admin() or public.is_manager()
         or (created_by = auth.uid()
             and (not public.is_technician() or public.leads_job(service_job_id)
                  or public.is_on_crew(service_job_id))))
  )
  with check (
    public.has_access('service')
    and (public.is_admin() or public.is_manager()
         or (created_by = auth.uid()
             and (not public.is_technician() or public.leads_job(service_job_id)
                  or public.is_on_crew(service_job_id))))
  );
drop policy if exists service_job_purchase_orders_delete on public.service_job_purchase_orders;
create policy service_job_purchase_orders_delete on public.service_job_purchase_orders
  for delete to authenticated
  using (
    public.has_access('service')
    and (public.is_admin() or public.is_manager()
         or (created_by = auth.uid()
             and (not public.is_technician() or public.leads_job(service_job_id)
                  or public.is_on_crew(service_job_id))))
  );

-- 3. Approval is a manager's. Only an admin or a manager sets approved (and with it approved_by
-- / approved_at): a change of approved (or a new PO approved) by anyone else is refused. When
-- approved flips true the trigger stamps who and when; when it flips false it clears them;
-- nobody writes them by hand. An approved PO is locked for everyone else (its price is the
-- approved cost): no edit, no delete — ask a manager. created_by is the signed-in user on a new
-- row and never changes; a PO never moves to another ticket. No signed-in user (migrations, the
-- SQL editor) and the service role pass. The app twin is canEditPo (purchase-orders.ts).
create or replace function public.service_job_purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_boss boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role'
    or public.is_admin()
    or public.is_manager();
begin
  if tg_op = 'DELETE' then
    if old.approved and not v_boss then
      raise exception 'An approved PO is locked; ask a manager' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.approved and not v_boss then
      raise exception 'Only a manager approves a PO' using errcode = '42501';
    end if;
    if v_uid is not null then
      new.created_by := v_uid;
    end if;
    if new.approved then
      new.approved_by := coalesce(v_uid, new.approved_by);
      new.approved_at := coalesce(new.approved_at, now());
    else
      new.approved_by := null;
      new.approved_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.approved is distinct from old.approved and not v_boss then
    raise exception 'Only a manager approves a PO' using errcode = '42501';
  end if;
  if old.approved and not v_boss then
    raise exception 'An approved PO is locked; ask a manager' using errcode = '42501';
  end if;
  if new.service_job_id is distinct from old.service_job_id then
    raise exception 'A PO stays on its ticket' using errcode = '42501';
  end if;
  new.created_by := old.created_by;
  if new.approved and not old.approved then
    new.approved_by := coalesce(v_uid, new.approved_by);
    new.approved_at := now();
  elsif old.approved and not new.approved then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;
revoke all on function public.service_job_purchase_orders_guard() from public;

drop trigger if exists service_job_purchase_orders_guard on public.service_job_purchase_orders;
create trigger service_job_purchase_orders_guard
  before insert or update or delete on public.service_job_purchase_orders
  for each row execute function public.service_job_purchase_orders_guard();

-- 4. The audit log: a PO is its own entity ('purchase_order', entity_id = the PO's id; on an
-- update its ticket shows in the changes only if it moved, which the guard refuses).
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log add constraint audit_log_entity_check
  check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact', 'purchase_order'));

-- audit_row() exactly as 20261001080000_audit_triggers_stage_rule.sql wrote it, plus the
-- service_job_purchase_orders branch ("PO 'Jbk24-0255' price 12.5 → 14"; "PO 'Jbk24-0255'
-- approved no → yes"). approved_by / approved_at join the bookkeeping columns (only a PO has
-- them): the trigger stamps them from the approval, and the log row's by_name / at already say
-- who approved and when.
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

drop trigger if exists service_job_purchase_orders_audit on public.service_job_purchase_orders;
create trigger service_job_purchase_orders_audit after insert or update or delete on public.service_job_purchase_orders
  for each row execute function public.audit_row();
