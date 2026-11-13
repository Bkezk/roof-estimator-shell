-- Task #99: the morning is 8:00 AM Eastern all year. NOT APPLIED: the database connection was
-- down when this was written (Nov 13, 13:30 UTC). Run each block below as ONE statement, in
-- order (the same text as supabase/migrations/20261113130000_reminder_morning_8am.sql).
-- Checked beforehand on a throwaway PostgreSQL 16 with the applied migration loaded:
-- (the output is summarised in docs/qa/ticket-reminders-working-days-2026-11-13.md)
-- What it replaces is saved as the applied migration 20261113120000_ticket_reminders_working_days.sql
-- (the text of the applied migration, which
-- matched the live database by hash this morning).

-- ── 0a. BEFORE: the two functions still match the applied migration ──────────────────────────
-- Expect ticket_next_remind_at 5cc495f20428972387e0af500f448198 and
-- followup_sync_upsert bc37e062c91b9daa77c3112a1e83eab6 (if not, stop: something else changed).
select p.proname, md5(p.prosrc) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('ticket_next_remind_at', 'followup_sync_upsert')
 order by 1;

-- ── 0b. BEFORE: the open ticket timers (dates and times only) and how many rows will move ────
select to_char(f.due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as due_utc,
       to_char(f.next_remind_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as next_utc,
       f.reminders_sent as sent,
       to_char(f.last_reminded_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as last_sent_utc
  from public.crm_followups f
 where f.status = 'open' and f.kind = 'ticket'
 order by f.due_at;

select count(*) filter (where f.due_at = ((f.due_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC') as due_at_noon_utc,
       count(*) filter (where f.next_remind_at > now() and f.next_remind_at = ((f.next_remind_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC') as next_ahead_at_noon_utc,
       count(*) filter (where f.next_remind_at <= now()) as due_right_now,
       count(*) as open_rows, now() as now
  from public.crm_followups f where f.status = 'open';

-- ── 1. The helper ────────────────────────────────────────────────────────────────────────────
create or replace function public.reminder_morning(p_day date)
returns timestamptz language sql stable set search_path = public as $$
  select (p_day + time '08:00') at time zone 'America/New_York';
$$;

-- ── 2. Its rights ────────────────────────────────────────────────────────────────────────────
do $$
begin
  revoke all on function public.reminder_morning(date) from public, anon, authenticated;
  grant execute on function public.reminder_morning(date) to service_role;
end $$;

-- ── 3. ticket_next_remind_at ─────────────────────────────────────────────────────────────────
create or replace function public.ticket_next_remind_at(
  p_due_at timestamptz, p_from date, p_before integer, p_notice integer, p_after integer
)
returns timestamptz language sql stable set search_path = public as $$
  select case when x.d = public.office_day(p_due_at) then p_due_at
              else public.reminder_morning(x.d) end
    from (select public.ticket_next_remind_day(
                   public.office_day(p_due_at), p_from, p_before, p_notice, p_after) as d) x;
$$;

-- ── 4. followup_sync_upsert ──────────────────────────────────────────────────────────────────
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
  v_today date := public.office_day(now());
  v_ahead boolean := false;
begin
  if p_kind is null or p_kind not in ('ticket', 'opportunity', 'invoice') then
    raise exception 'Unknown follow-up kind %', p_kind;
  end if;
  if p_assignee_id is null then
    raise exception 'A follow-up needs an assignee';
  end if;
  if not v_system then
    if not (public.has_access('customers') or public.has_access('service')
            or p_assignee_id = auth.uid()) then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
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
      if not (public.is_admin() or public.is_manager()) then
        raise exception 'Only the office starts or closes a review timer' using errcode = '42501';
      end if;
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
    when p_due_date is not null then public.reminder_morning(p_due_date)
    else now() + make_interval(days => case when p_kind = 'opportunity' then v_close else v_first end)
  end;
  -- Nov 13: a ticket whose date is still ahead is reminded before it, on working days
  -- (ticket_next_remind_at: the cadence, the notice, the date). A date that is today or past,
  -- an opportunity and the review timer: as before.
  v_ahead := p_kind = 'ticket' and public.office_day(v_due) > v_today;
  v_first_remind := case
    when p_kind = 'opportunity' then least(now() + make_interval(days => v_first), v_due)
    when v_ahead then public.ticket_next_remind_at(
      v_due, v_today, v_s.ticket_before_every_days, v_s.ticket_due_notice_days, v_every)
    else greatest(v_due, now())
  end;
  select * into f from public.crm_followups
   where kind = p_kind and item_id = p_item_id and status = 'open'
   for update;
  v_has_open := found;
  perform set_config('jbk.followup_sync', 'on', true);
  if v_has_open and f.assignee_id = p_assignee_id then
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
             when v_date_moved and (reminders_sent = 0 or v_snooze_cleared or v_ahead)
               then v_first_remind
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
    'snooze_cleared', v_snooze_cleared,
    'first_remind_at', v_first_remind
  );
end $$;

-- ── 5. Rights of the two (unchanged by a replace; stated again as the migration file does) ───
do $$
begin
  revoke all on function public.ticket_next_remind_at(timestamptz, date, integer, integer, integer) from public, anon, authenticated;
  grant execute on function public.ticket_next_remind_at(timestamptz, date, integer, integer, integer) to service_role;
  revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) from public, anon;
  grant execute on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) to authenticated, service_role;
end $$;

-- ── 6. The open follow-ups move to 8:00 AM Eastern ───────────────────────────────────────────
do $$
begin
  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups f
     set due_at = c.new_due,
         next_remind_at = c.new_next
    from (
      select t.id,
             case when t.due_at = ((t.due_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC'
                  then public.reminder_morning((t.due_at at time zone 'UTC')::date)
                  else t.due_at end as new_due,
             case when t.next_remind_at > now()
                   and t.next_remind_at
                       = ((t.next_remind_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC'
                  then public.reminder_morning((t.next_remind_at at time zone 'UTC')::date)
                  else t.next_remind_at end as new_next
        from public.crm_followups t
       where t.status = 'open'
    ) c
   where f.id = c.id
     and (f.due_at is distinct from c.new_due or f.next_remind_at is distinct from c.new_next);
  perform set_config('jbk.followup_sync', '', true);
end $$;

-- ── V1. AFTER: the three functions match the file ────────────────────────────────────────────
-- Expect reminder_morning 6ed1420ddddef362abb85f23c8472f38,
-- ticket_next_remind_at fc8ceb3ac7c61c1d4050131d73e09464,
-- followup_sync_upsert 86fba33f20740b1edb0145371ba08a45.
select p.proname, md5(p.prosrc) as md5, p.provolatile as volatility,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('reminder_morning', 'ticket_next_remind_at', 'followup_sync_upsert')
 order by 1;
-- reminder_morning: volatility s, anon f, authenticated f, service_role t.
-- ticket_next_remind_at: s, f, f, t. followup_sync_upsert: v, f, t, t.

-- ── V2. AFTER: the helper's days ─────────────────────────────────────────────────────────────
-- Expect 13:00 for 2026-11-13, 2026-11-01, 2027-03-13; 12:00 for 2026-07-15, 2026-10-31, 2027-03-14.
select d as day, to_char(public.reminder_morning(d::date) at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as utc
  from unnest(array['2026-11-13', '2026-07-15', '2026-10-31', '2026-11-01', '2027-03-13', '2027-03-14']) d;

-- ── V3. AFTER: the open ticket timers ────────────────────────────────────────────────────────
-- Expect every winter due_utc and every next_utc that is still ahead at 13:00:00. If the two
-- timers that were due at 12:00 UTC on Nov 13 were sent that morning, expected:
--   date Sun Nov 15: due 2026-11-15 13:00:00, next 2026-11-15 13:00:00
--   date Wed Nov 18: due 2026-11-18 13:00:00, next 2026-11-17 13:00:00
--   date Tue Nov 24: due 2026-11-24 13:00:00, next 2026-11-17 13:00:00
-- A reminder that was due and not yet sent keeps its next_utc as it was (it stays due).
select to_char(f.due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as due_utc,
       to_char(f.next_remind_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as next_utc,
       f.reminders_sent as sent,
       to_char(f.last_reminded_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as last_sent_utc
  from public.crm_followups f
 where f.status = 'open' and f.kind = 'ticket'
 order by f.due_at;

-- ── V4. AFTER: nothing open is left at 12:00 UTC that should have moved ──────────────────────
-- Expect due_left 0; next_left counts only reminders that are due right now (not yet sent).
select count(*) filter (where f.due_at = ((f.due_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC'
                          and f.due_at <> public.reminder_morning((f.due_at at time zone 'UTC')::date)) as due_left,
       count(*) filter (where f.next_remind_at = ((f.next_remind_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC'
                          and f.next_remind_at <> public.reminder_morning((f.next_remind_at at time zone 'UTC')::date)) as next_left,
       count(*) filter (where f.next_remind_at <= now()) as due_right_now
  from public.crm_followups f where f.status = 'open';
