-- Follow-up guard, the opportunity closing statuses, escalation to managers and case-blind lead
-- source names (audit, Oct 2). Idempotent: every statement can run again.
--
-- 1. Follow-ups (crm_followups). The manager-only trigger (20261001030000) let any signed-in user
--    who passes RLS PATCH a follow-up with status 'closed' + closed_by_sync = true (the sync's
--    marker), or move next_remind_at / due_at / every_days straight through PostgREST, so a rep
--    could end or push out their own reminders. Now a signed-in user who is neither an admin nor
--    a manager changes none of the reminder fields, the status or the sync marker, and starts no
--    follow-up, except inside the three functions below, which set the transaction-local flag
--    jbk.followup_sync (the pattern of set_ticket_stage_from_invoice, 20261001080000; a client
--    cannot set it: PostgREST exposes no set_config and each request is its own transaction).
--    Each function checks the item first, so calling it directly through /rest/v1/rpc does no
--    more than the app's own sync would:
--      followup_sync_upsert     start / refresh / hand over the item's open follow-up; the
--                               assignee and the date must be the item's own
--                               (src/lib/followups.server.ts syncFollowup)
--      followup_sync_close      close it, only when the item is finished, deleted, unassigned or
--                               reassigned (or the caller is an admin / a manager)
--      followup_claim_reminder  the reminder pass's claim when it runs as a signed-in user
--                               (src/lib/notify.server.ts), only while the reminder is due, and
--                               never by its own assignee
--    The system (the service role; SQL with no request) passes everything, as before.
-- 2. Opportunities: Won / Lost / No response are a manager's or an admin's (the twin of
--    src/lib/opportunity-form.ts oppStatusProblem): a rep moves Open → Contacted → Quoted.
-- 3. "Escalate untouched items to every admin" now reaches every admin and manager.
-- 4. lead_sources.name is unique whatever its case or outer spaces.

-- ============================================================================================
-- Who is the system: the service role, or SQL with no request at all (no JWT: the SQL editor,
-- migrations). Never anon, never a signed-in user (20261002090000_service_role_helpers.sql).
create or replace function public.followup_is_system()
returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'));
$$;
revoke all on function public.followup_is_system() from public;
revoke all on function public.followup_is_system() from anon;
grant execute on function public.followup_is_system() to authenticated, service_role;

-- 1a. The rule.
create or replace function public.crm_followups_manager_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.followup_is_system() or public.is_admin() or public.is_manager()
     or coalesce(current_setting('jbk.followup_sync', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    raise exception 'A follow-up is started by the app when an item is assigned'
      using errcode = '42501';
  end if;
  -- A snooze, a close by hand, a reopen, or the sync's marker set by hand.
  if new.snoozed_until is distinct from old.snoozed_until
     or new.status is distinct from old.status
     or new.closed_by_sync is distinct from old.closed_by_sync then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  -- The reminder fields, and what the follow-up is for and whose it is.
  if new.due_at is distinct from old.due_at
     or new.next_remind_at is distinct from old.next_remind_at
     or new.every_days is distinct from old.every_days
     or new.reminders_sent is distinct from old.reminders_sent
     or new.last_reminded_at is distinct from old.last_reminded_at
     or new.assignee_id is distinct from old.assignee_id
     or new.kind is distinct from old.kind
     or new.item_id is distinct from old.item_id then
    raise exception 'Only a manager can change a follow-up''s reminders' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.crm_followups_manager_only() from public;

drop trigger if exists crm_followups_manager_only on public.crm_followups;
create trigger crm_followups_manager_only before update on public.crm_followups
  for each row execute function public.crm_followups_manager_only();
drop trigger if exists crm_followups_manager_only_delete on public.crm_followups;
create trigger crm_followups_manager_only_delete before delete on public.crm_followups
  for each row execute function public.crm_followups_manager_only();
drop trigger if exists crm_followups_manager_only_insert on public.crm_followups;
create trigger crm_followups_manager_only_insert before insert on public.crm_followups
  for each row execute function public.crm_followups_manager_only();

-- 1b. Start, refresh or hand over the item's open follow-up (followups.server.ts syncFollowup).
-- The app's rules: due on the item's date at 12:00 UTC (or close_days / first_days from now when
-- the item has none); a ticket reminds on its due day (or now, if that is past); an opportunity
-- first after opportunity_first_days, never later than its due date. A moved date moves the due
-- date, clears a snooze, and resets the next reminder when none was sent yet or a snooze was
-- running. Returns what happened (action started / reassigned / unchanged), the follow-up's id,
-- due_at and every_days, and whether a running snooze was cleared.
create or replace function public.followup_sync_upsert(
  p_kind text,
  p_item_id uuid,
  p_assignee_id uuid,
  p_account_id uuid,
  p_title text,
  p_url text,
  p_due_date date,
  p_created_by uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_system boolean := public.followup_is_system();
  v_found boolean;
  v_item_assignee uuid;
  v_item_date date;
  v_item_done boolean;
  v_s public.crm_settings%rowtype;
  v_first integer;
  v_every integer;
  v_close integer;
  v_due timestamptz;
  v_first_remind timestamptz;
  f public.crm_followups%rowtype;
  v_has_open boolean;
  v_date_moved boolean := false;
  v_snooze_cleared boolean := false;
  v_id uuid;
  v_action text;
begin
  if p_kind is null or p_kind not in ('ticket', 'opportunity', 'invoice') then
    raise exception 'Unknown follow-up kind %', p_kind;
  end if;
  if p_assignee_id is null then
    raise exception 'A follow-up needs an assignee';
  end if;
  if not v_system then
    -- Who may write follow-ups at all (the crm_followups_write policy).
    if not (public.has_access('customers') or public.has_access('service')
            or p_assignee_id = auth.uid()) then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
    -- The item must say the same: still open work, this assignee, this date.
    if p_kind = 'opportunity' then
      select o.assignee_id, o.expected_close,
             o.deleted_at is not null or o.status in ('won', 'lost', 'no_response')
        into v_item_assignee, v_item_date, v_item_done
        from public.crm_opportunities o where o.id = p_item_id;
      v_found := found;
    elsif p_kind = 'ticket' then
      select j.technician_id, j.scheduled_date,
             j.deleted_at is not null or j.stage in ('done', 'invoiced', 'closed')
        into v_item_assignee, v_item_date, v_item_done
        from public.service_jobs j where j.id = p_item_id;
      v_found := found;
    else
      -- The office's "invoice it" timer: open while the ticket sits at Done; its assignee is
      -- picked by the app from the office (ticket-events.server.ts); undated.
      select p_assignee_id, null::date, j.deleted_at is not null or j.stage <> 'done'
        into v_item_assignee, v_item_date, v_item_done
        from public.service_jobs j where j.id = p_item_id;
      v_found := found;
    end if;
    if not v_found or v_item_done
       or v_item_assignee is distinct from p_assignee_id
       or v_item_date is distinct from p_due_date then
      raise exception 'The follow-up does not match its item' using errcode = '42501';
    end if;
  end if;

  select * into v_s from public.crm_settings where id = 1;
  v_first := coalesce(case when p_kind = 'opportunity' then v_s.opportunity_first_days
                           else v_s.ticket_first_days end,
                      case when p_kind = 'opportunity' then 3 else 1 end);
  v_every := coalesce(case when p_kind = 'opportunity' then v_s.opportunity_every_days
                           else v_s.ticket_every_days end,
                      case when p_kind = 'opportunity' then 7 else 3 end);
  v_close := coalesce(v_s.opportunity_close_days, 30);
  v_due := case
    when p_due_date is not null then (p_due_date + time '12:00') at time zone 'UTC'
    else now() + make_interval(days => case when p_kind = 'opportunity' then v_close else v_first end)
  end;
  v_first_remind := case
    when p_kind = 'opportunity' then least(now() + make_interval(days => v_first), v_due)
    else greatest(v_due, now())
  end;

  select * into f from public.crm_followups
   where kind = p_kind and item_id = p_item_id and status = 'open'
   for update;
  v_has_open := found;

  perform set_config('jbk.followup_sync', 'on', true);
  if v_has_open and f.assignee_id = p_assignee_id then
    -- Same person: keep the timer; refresh what describes it, and the due date if it moved.
    if p_due_date is not null and f.due_at is distinct from v_due then
      v_date_moved := true;
      v_snooze_cleared := f.snoozed_until is not null and f.snoozed_until > now();
    end if;
    update public.crm_followups
       set title = p_title,
           account_id = p_account_id,
           url = p_url,
           due_at = case when v_date_moved then v_due else due_at end,
           next_remind_at = case
             when v_date_moved and (reminders_sent = 0 or v_snooze_cleared) then v_first_remind
             else next_remind_at end,
           snoozed_until = case when v_date_moved then null else snoozed_until end
     where id = f.id
       and (v_date_moved
            or title is distinct from p_title
            or account_id is distinct from p_account_id
            or url is distinct from p_url);
    v_id := f.id;
    v_action := 'unchanged';
  else
    if v_has_open then
      update public.crm_followups
         set status = 'closed', closed_at = now(), closed_reason = 'reassigned',
             closed_by_sync = true
       where id = f.id;
      v_action := 'reassigned';
    else
      v_action := 'started';
    end if;
    insert into public.crm_followups
      (kind, item_id, account_id, assignee_id, title, url, due_at, next_remind_at, every_days,
       created_by)
    values
      (p_kind, p_item_id, p_account_id, p_assignee_id, p_title, p_url, v_due, v_first_remind,
       v_every, case when v_system then p_created_by else auth.uid() end)
    returning id into v_id;
  end if;
  perform set_config('jbk.followup_sync', '', true);

  return jsonb_build_object(
    'action', v_action,
    'id', v_id,
    'due_at', v_due,
    'every_days', v_every,
    'snooze_cleared', v_snooze_cleared
  );
end $$;
revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) from public;
revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) from anon;
grant execute on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  to authenticated, service_role;

-- 1c. Close the item's follow-up (followups.server.ts syncFollowup): the item was finished,
-- deleted, unassigned or handed to someone else. Any other "close" is refused here exactly as
-- by the trigger. Returns false when there was nothing open to close.
create or replace function public.followup_sync_close(p_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  f public.crm_followups%rowtype;
  v_ok boolean := false;
  v_found boolean;
  v_assignee uuid;
  v_status text;
  v_deleted timestamptz;
begin
  select * into f from public.crm_followups where id = p_id for update;
  if not found or f.status <> 'open' then
    return false;
  end if;
  if not (public.followup_is_system() or public.is_admin() or public.is_manager()) then
    if not (public.has_access('customers') or public.has_access('service')
            or f.assignee_id = auth.uid()) then
      raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
    end if;
    if f.kind = 'opportunity' then
      select o.assignee_id, o.status, o.deleted_at into v_assignee, v_status, v_deleted
        from public.crm_opportunities o where o.id = f.item_id;
      v_found := found;
      v_ok := not v_found or v_deleted is not null
              or v_status in ('won', 'lost', 'no_response')
              or v_assignee is distinct from f.assignee_id;
    elsif f.kind = 'ticket' then
      select j.technician_id, j.stage, j.deleted_at into v_assignee, v_status, v_deleted
        from public.service_jobs j where j.id = f.item_id;
      v_found := found;
      v_ok := not v_found or v_deleted is not null
              or v_status in ('done', 'invoiced', 'closed')
              or v_assignee is distinct from f.assignee_id;
    else
      select j.stage, j.deleted_at into v_status, v_deleted
        from public.service_jobs j where j.id = f.item_id;
      v_found := found;
      -- Handed to another office user while the ticket sits at Done: never by its own assignee.
      v_ok := not v_found or v_deleted is not null or v_status <> 'done'
              or f.assignee_id is distinct from auth.uid();
    end if;
    if not v_ok then
      raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
    end if;
  end if;
  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups
     set status = 'closed', closed_at = now(),
         closed_reason = coalesce(nullif(btrim(p_reason), ''), 'closed by the app'),
         closed_by_sync = true
   where id = p_id;
  perform set_config('jbk.followup_sync', '', true);
  return true;
end $$;
revoke all on function public.followup_sync_close(uuid, text) from public;
revoke all on function public.followup_sync_close(uuid, text) from anon;
grant execute on function public.followup_sync_close(uuid, text) to authenticated, service_role;

-- 1d. The reminder pass's claim when it runs as a signed-in user (no service key: the preview):
-- move next_remind_at on by every_days and count the reminder, only where the follow-up is open,
-- due, and still holds the value the pass read (so two passes claim it once). Never by the
-- follow-up's own assignee (that would silence their own reminder): false, and the cron or
-- another user's pass sends it. Who may run a pass: Customers / Service / Estimate, as
-- stamp_dispatch().
create or replace function public.followup_claim_reminder(p_id uuid, p_expected timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_system boolean := public.followup_is_system();
  v_n integer;
begin
  if not (v_system or public.has_access('customers') or public.has_access('service')
          or public.has_access('estimate')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups
     set next_remind_at = now() + make_interval(days => every_days),
         reminders_sent = reminders_sent + 1,
         last_reminded_at = now()
   where id = p_id
     and status = 'open'
     and next_remind_at = p_expected
     and next_remind_at <= now()
     and (v_system or assignee_id is distinct from auth.uid());
  get diagnostics v_n = row_count;
  perform set_config('jbk.followup_sync', '', true);
  return v_n = 1;
end $$;
revoke all on function public.followup_claim_reminder(uuid, timestamptz) from public;
revoke all on function public.followup_claim_reminder(uuid, timestamptz) from anon;
grant execute on function public.followup_claim_reminder(uuid, timestamptz) to authenticated, service_role;

-- ============================================================================================
-- 2. Won / Lost / No response: an admin's or a manager's (owner decision, audit Oct 2). A rep
-- who set one ended the reminders management relies on. Moving out of them (a reopen) stays
-- open to whoever may edit the opportunity: it only restarts reminders.
create or replace function public.crm_opportunities_closing_rule()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('won', 'lost', 'no_response')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and not (public.followup_is_system() or public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager can mark an opportunity Won, Lost or No response'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.crm_opportunities_closing_rule() from public;

drop trigger if exists crm_opportunities_closing_rule on public.crm_opportunities;
create trigger crm_opportunities_closing_rule before insert or update of status
  on public.crm_opportunities
  for each row execute function public.crm_opportunities_closing_rule();

-- ============================================================================================
-- 3. Untouched-work escalation: "every admin" becomes every admin and manager (the managers
-- keep the reps responsible). Same signature and access as 20260928120000_untouched.sql.
create or replace function public.escalation_recipients()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
    from public.profiles p, public.crm_settings s
   where s.id = 1
     and ((s.escalate_to_admins and p.role in ('admin', 'manager')) or p.id = any(s.escalate_user_ids))
     and (auth.role() = 'service_role' or public.has_access('customers')
          or public.has_access('service') or public.has_access('estimate'));
$$;
revoke all on function public.escalation_recipients() from public;
grant execute on function public.escalation_recipients() to authenticated, service_role;

-- ============================================================================================
-- 4. Lead sources: one name whatever its case or outer spaces. Duplicates first (the live table
-- has none; this runs again harmlessly): opportunities carrying a duplicate's name take the
-- name of the group's lowest id, and the duplicates go. Then the index.
with ranked as (
  select id,
         lower(btrim(name)) as k,
         first_value(id) over w as keep_id,
         first_value(name) over w as keep_name
    from public.lead_sources
  window w as (partition by lower(btrim(name)) order by id)
)
update public.crm_opportunities o
   set lead_source = r.keep_name
  from ranked r
 where r.id <> r.keep_id
   and lower(btrim(o.lead_source)) = r.k
   and o.lead_source is distinct from r.keep_name;

with ranked as (
  select id, first_value(id) over (partition by lower(btrim(name)) order by id) as keep_id
    from public.lead_sources
)
delete from public.lead_sources l
 using ranked r
 where l.id = r.id and r.id <> r.keep_id;

create unique index if not exists lead_sources_name_ci_key
  on public.lead_sources (lower(btrim(name)));
