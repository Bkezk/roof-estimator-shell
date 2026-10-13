-- Bid reminders (owner, Oct 13: "Where are the bid reminders set? Is it in Reminders like opps
-- and service, now that bids have due dates?" → a Bids group on Admin › Reminders; and "can we
-- have users who set a bid set up a custom reminder on there as well on setup?" → a per-bid
-- reminder on the estimator's Setup › Bid Info). Idempotent: every statement can run again.
--
-- 1. crm_settings: the two Bids settings. bid_due_notice_days replaces the fixed "day before"
--    of the "Bid due tomorrow" notice (0 = on the due day; 0–30). bid_overdue_every_days is the
--    repeat while a draft sits past its due date: null = never (the default; the owner's rule —
--    one notice per rule per day at most, and nothing unless asked), else every N days (1–365).
-- 2. bids.notified_overdue_at: when the last "Bid past due" notice went (bid_overdue). Cleared
--    with notified_due_at when due_date changes, so the new day starts over.
-- 3. bids.reminder_on / reminder_note / reminded_at: the estimator's own "Remind me on" date
--    and its short "About" note, saved with the bid; reminded_at is stamped when the notice
--    (bid_reminder) went, so it fires once. Changing the date clears the stamp, so the box can
--    be set again for a new reminder. ANY status — the user asked for it, so a submitted bid is
--    reminded too (the due / past-due notices stay draft-only).
-- 4. bids_due_notice_reset: one trigger function handles the three stamps, before update of
--    due_date, reminder_on.
-- 5. audit_row(): reminded_at joins v_skip (notified_overdue_at and notified_due_at already
--    are), so the pass stamping a reminder as sent writes no audit row. The body is
--    20261013150000_audit_skip_share_views.sql's with that one entry added; the test
--    src/lib/bid-reminders.test.ts pins the diff to exactly that. reminder_on and reminder_note
--    ARE audited: a user set them.
--
-- Read by src/lib/bids-notify.server.ts (dispatchBidDueNotices: the due notice, the past-due
-- repeat and the custom reminder, each claimed with a conditional update on its own stamp);
-- the rules are src/lib/bid-status.ts bidDueNoticeDue / bidOverdueNoticeDue / bidReminderDue.

-- 1. ------------------------------------------------------------------------------------------
alter table public.crm_settings
  add column if not exists bid_due_notice_days integer not null default 1;
alter table public.crm_settings drop constraint if exists crm_settings_bid_due_notice_days_check;
alter table public.crm_settings add constraint crm_settings_bid_due_notice_days_check
  check (bid_due_notice_days between 0 and 30);
comment on column public.crm_settings.bid_due_notice_days is
  'Owner, Oct 13: the "Bid due" notice goes to whoever started a draft bid this many days before its due date (0 = on the due day). Was fixed at 1.';

alter table public.crm_settings
  add column if not exists bid_overdue_every_days integer;
alter table public.crm_settings drop constraint if exists crm_settings_bid_overdue_every_days_check;
alter table public.crm_settings add constraint crm_settings_bid_overdue_every_days_check
  check (bid_overdue_every_days is null or bid_overdue_every_days between 1 and 365);
comment on column public.crm_settings.bid_overdue_every_days is
  'Owner, Oct 13: while a draft bid is past its due date, remind whoever started it every this many days (first the day after). Null = never.';

-- 2. ------------------------------------------------------------------------------------------
alter table public.bids add column if not exists notified_overdue_at timestamptz;
comment on column public.bids.notified_overdue_at is
  'When the last "Bid past due" notice went to created_by (owner, Oct 13; every crm_settings.bid_overdue_every_days); cleared when due_date changes.';

-- 3. ------------------------------------------------------------------------------------------
alter table public.bids add column if not exists reminder_on date;
alter table public.bids add column if not exists reminder_note text;
alter table public.bids add column if not exists reminded_at timestamptz;
alter table public.bids drop constraint if exists bids_reminder_note_check;
alter table public.bids add constraint bids_reminder_note_check
  check (reminder_note is null or char_length(reminder_note) <= 200);
comment on column public.bids.reminder_on is
  'Owner, Oct 13: the day the person who started the bid asked to be reminded about it (Setup › Bid Info "Remind me on"); any status. Null = no reminder.';
comment on column public.bids.reminder_note is
  'Owner, Oct 13: what the reminder is about (at most 200 characters); the body of the "Bid reminder" notice. Cleared with reminder_on.';
comment on column public.bids.reminded_at is
  'When the "Bid reminder" notice went (owner, Oct 13); cleared when reminder_on changes, so the date can be set again for a new reminder.';

-- The reminder pass reads "reminder_on by today, not yet reminded": a small partial index.
create index if not exists bids_reminder_on_idx on public.bids (reminder_on)
  where reminder_on is not null and reminded_at is null and deleted_at is null;

-- 4. ------------------------------------------------------------------------------------------
create or replace function public.bids_due_notice_reset()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.due_date is distinct from old.due_date then
    new.notified_due_at := null;
    new.notified_overdue_at := null;
  end if;
  if new.reminder_on is distinct from old.reminder_on then
    new.reminded_at := null;
  end if;
  return new;
end $$;
revoke all on function public.bids_due_notice_reset() from public;

drop trigger if exists bids_due_notice_reset on public.bids;
create trigger bids_due_notice_reset before update of due_date, reminder_on on public.bids
  for each row execute function public.bids_due_notice_reset();

-- 5. ------------------------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at', 'stage_changed_at', 'done_at', 'done_by', 'done_by_name', 'notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'assignee', 'status_changed_at', 'data', 'notified_due_at', 'notify_failures', 'share_views', 'share_last_viewed_at', 'reminded_at'];
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
