-- Bid status drives the opportunity, one direction only; any status is the editor's (the
-- manager-only closing rule goes); claim / restore start the follow-up (app side); History for
-- opportunities and bids (owner decisions, Oct 12). Idempotent: every statement can run again.
--
-- A. The bid is the source of truth for the opportunity it was started from ("Start a bid" links
--    the two: crm_opportunities.bid_id, written by opportunities.functions.ts linkBid). A bid that
--    becomes Submitted moves an Open / Contacted opportunity to Quoted (never backwards from Won /
--    Lost / No response); a bid Won makes the opportunity Won; a bid Lost makes it Lost. The
--    opportunity's own status never touches the bid (owner: someone may close an opportunity to
--    clear their board while the bid is still being worked).
--      sync_opportunity_from_bid(p_bid)  SECURITY DEFINER: whoever may edit the bid (Estimate
--                                        access, as bids_authenticated_all) or the system; reads
--                                        the bid's status, finds the live opportunity (bid_id =
--                                        the bid, else bids.opportunity_id), applies the mapping
--                                        (opportunity_status_from_bid) and writes the status (a
--                                        plain update: since Oct 12 no trigger limits who sets a
--                                        status). The status log row comes from
--                                        crm_opportunities_log as for a manual change (by_user =
--                                        the person who changed the bid); the app then syncs the
--                                        follow-up (opportunities.functions.ts
--                                        syncOpportunityFromBid). NOTE for the owner: a
--                                        non-manager who marks a bid Won or Lost closes the
--                                        opportunity through this path, by design.
--      crm_opportunities_closing_rule    DROPPED (trigger and function). Owner, Oct 12: anyone
--                                        who may edit an opportunity sets any status — Won, Lost
--                                        and No response included (people close opportunities to
--                                        clear their board); the log records who and when. The
--                                        rule was 20261002140000_followup_guard.sql §2 (Oct 2); its
--                                        app twins (opportunity-form.ts oppStatusProblem, the
--                                        disabled options and hint on the page) go with it. The
--                                        follow-up rules (crm_followups_manager_only) are untouched.
--    bids.opportunity_id (20260924010000, never written) is backfilled from crm_opportunities.bid_id,
--    given its foreign key, and written by linkBid from now on, so the bid side knows its
--    opportunity ("From opportunity: …" on the Bids page and in the estimator).
--    bids.submitted_at is stamped when the status first becomes submitted and never overwritten;
--    bids.status_changed_at on every status change (the server functions stamp both; the trigger
--    bids_status_stamps fills them in for any write that left them out and keeps an older
--    submitted_at).
-- B. History (owner item 12): entity 'opportunity' and 'bid' join the audit_log entity check
--    (every existing entity kept); audit_row() is 20261009100000_tasks_tracking.sql's EXACTLY plus
--    the two branches ("Opportunity 'Reroof gym' status open → quoted", "Bid 'Gym reroof' status
--    draft → submitted") and, in v_skip, status_changed_at (the status says it, like
--    stage_changed_at) and data (the bid's whole estimator payload, saved on every step: it would
--    fill `changes` with two copies of it per save). No other audited table has those columns.
--    audit_col_name() / audit_label() are 20261006200000's exactly plus bid_id (the bid's name) and
--    opportunity_id (the opportunity's title). Reading stays audit_log_read (admins and managers),
--    as for tickets and invoices. opportunity-bid-history.test.ts pins all of B;
--    bid-drives-opportunity.test.ts pins A; opportunity-status-anyone.test.ts the dropped rule.

-- ============================================================================================
-- A1. The bid side: the stamps, the link column backfilled and keyed.
alter table public.bids
  add column if not exists submitted_at timestamptz,
  add column if not exists status_changed_at timestamptz;
comment on column public.bids.submitted_at is
  'When the status first became submitted (owner, Oct 12); never overwritten after.';
comment on column public.bids.status_changed_at is
  'When the status last changed (owner, Oct 12).';

update public.bids b
   set opportunity_id = o.id
  from public.crm_opportunities o
 where o.bid_id = b.id
   and b.opportunity_id is distinct from o.id;

-- A value that points nowhere (the column was never written by the app) goes before the key.
update public.bids b
   set opportunity_id = null
 where b.opportunity_id is not null
   and not exists (select 1 from public.crm_opportunities o where o.id = b.opportunity_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'bids_opportunity_id_fkey' and c.conrelid = 'public.bids'::regclass
  ) then
    alter table public.bids add constraint bids_opportunity_id_fkey
      foreign key (opportunity_id) references public.crm_opportunities(id) on delete set null;
  end if;
end $$;
create index if not exists bids_opportunity_idx on public.bids (opportunity_id);

create or replace function public.bids_status_stamps()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and new.status_changed_at is not distinct from old.status_changed_at then
    new.status_changed_at := now();
  end if;
  if new.status = 'submitted' and new.submitted_at is null
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    new.submitted_at := now();
  end if;
  -- Once stamped, the first submission stays.
  if tg_op = 'UPDATE' and old.submitted_at is not null
     and new.submitted_at is distinct from old.submitted_at then
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end $$;
revoke all on function public.bids_status_stamps() from public;

drop trigger if exists bids_status_stamps on public.bids;
create trigger bids_status_stamps before insert or update of status, submitted_at
  on public.bids
  for each row execute function public.bids_status_stamps();

-- ============================================================================================
-- A2. The closing rule goes (owner, Oct 12): any status is the editor's. crm_opportunities_write
-- (Customers access or the assignee) still says who may edit at all.
drop trigger if exists crm_opportunities_closing_rule on public.crm_opportunities;
drop function if exists public.crm_opportunities_closing_rule();

-- ============================================================================================
-- A3. The mapping (pure; the twin of src/lib/bid-status.ts oppStatusFromBid) and the sync.
create or replace function public.opportunity_status_from_bid(p_bid_status text, p_opp_status text)
returns text language sql immutable as $$
  select case
    when p_bid_status = 'submitted' and p_opp_status in ('open', 'contacted') then 'quoted'
    when p_bid_status = 'won' and p_opp_status is distinct from 'won' then 'won'
    when p_bid_status = 'lost' and p_opp_status is distinct from 'lost' then 'lost'
    else null
  end;
$$;
revoke all on function public.opportunity_status_from_bid(text, text) from public;
grant execute on function public.opportunity_status_from_bid(text, text) to authenticated, service_role;

create or replace function public.sync_opportunity_from_bid(p_bid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bid public.bids%rowtype;
  v_opp public.crm_opportunities%rowtype;
  v_to text;
begin
  -- Whoever may edit the bid (bids_authenticated_all: Estimate access), or the system.
  if not (public.followup_is_system() or public.has_access('estimate')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into v_bid from public.bids b where b.id = p_bid;
  if not found then
    return jsonb_build_object('action', 'none', 'reason', 'no bid');
  end if;
  -- The live opportunity this bid belongs to: the one that names the bid first (linkBid writes
  -- crm_opportunities.bid_id), else the one the bid names.
  select * into v_opp from public.crm_opportunities o
   where o.deleted_at is null
     and (o.bid_id = p_bid or o.id = v_bid.opportunity_id)
   order by (o.bid_id is not distinct from p_bid) desc, o.updated_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('action', 'none', 'reason', 'no opportunity');
  end if;
  v_to := public.opportunity_status_from_bid(v_bid.status, v_opp.status);
  if v_to is null then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'status', v_opp.status);
  end if;
  update public.crm_opportunities
     set status = v_to,
         updated_by_name = public.event_actor_name(auth.uid())
   where id = v_opp.id;
  return jsonb_build_object('action', 'updated', 'opportunity_id', v_opp.id,
                            'from', v_opp.status, 'to', v_to);
end $$;
comment on function public.sync_opportunity_from_bid(uuid) is
  'Bid status drives the opportunity (owner, Oct 12): submitted → quoted (from open / contacted only), won → won, lost → lost; never the other way.';
revoke all on function public.sync_opportunity_from_bid(uuid) from public;
revoke all on function public.sync_opportunity_from_bid(uuid) from anon;
grant execute on function public.sync_opportunity_from_bid(uuid) to authenticated, service_role;

-- ============================================================================================
-- B. History: the entity check, the labels, audit_row(), the triggers.
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log add constraint audit_log_entity_check
  check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact', 'purchase_order',
                    'vendor', 'ticket', 'ticket_time', 'task', 'opportunity', 'bid'));

-- audit_col_name() / audit_label() as 20261006200000_audit_ticket_readable.sql wrote them, plus
-- bid_id and opportunity_id.
create or replace function public.audit_col_name(p_col text)
returns text language sql immutable set search_path = public as $$
  select replace(
    case
      when p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                     'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id', 'location_id',
                     'bid_id', 'opportunity_id')
        then left(p_col, -3)
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
  begin
    if right(p_col, 3) = '_at' and jsonb_typeof(p_value) = 'string' then
      return to_char((v_text::timestamptz) at time zone 'America/New_York', 'Mon FMDD, YYYY');
    end if;
    if p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                 'approved_by', 'created_by', 'vendor_id', 'bill_to_vendor_id', 'site_id',
                 'account_id', 'contact_id', 'location_id', 'bid_id', 'opportunity_id') then
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

-- audit_row() as 20261009100000_tasks_tracking.sql wrote it, plus the two branches and the two
-- skips (see the header).
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at', 'stage_changed_at', 'done_at', 'done_by', 'done_by_name', 'notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'assignee', 'status_changed_at', 'data'];
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

drop trigger if exists crm_opportunities_audit on public.crm_opportunities;
create trigger crm_opportunities_audit after insert or update or delete on public.crm_opportunities
  for each row execute function public.audit_row();
drop trigger if exists bids_audit on public.bids;
create trigger bids_audit after insert or update or delete on public.bids
  for each row execute function public.audit_row();
