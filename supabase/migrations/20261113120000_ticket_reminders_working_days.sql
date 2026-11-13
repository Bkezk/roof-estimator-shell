-- Ticket reminders before the date, on working days (owner, Nov 13).
--
--   "add the day before notice for tickets, also i think they would want some cadence of
--    reminders as well, if a ticket is set to do a month out and is assigned then it starts
--    reminding that person every 3 days or so and that can also be edited in settings."
--   "give it the new meaning for untouched tickets. also dont count weekend days, that should
--    slow the cadence a bit."
--   "yes skip weekends on the after date reminders too"
--
-- Tickets only; opportunity and bid reminders are as they were.
--
-- 1. Two settings on crm_settings: ticket_before_every_days (3; null = no reminders before the
--    date) and ticket_due_notice_days (1; null = no notice).
-- 2. Working days in SQL, the twin of src/lib/working-days.ts: office_day (the office's
--    calendar day, America/New_York, the zone hold_followup already uses), add_working_days,
--    working_days_before, working_days_between. Saturdays and Sundays are not counted.
-- 3. The rule, the twin of src/lib/ticket-reminders.ts: ticket_next_remind_day /
--    ticket_next_remind_at. Before the date the earliest of the cadence step, the notice day
--    and the date itself (also on a weekend); on or after the date every_days WORKING days on.
-- 4. A trigger on crm_followups (crm_followups_ticket_next): whenever a ticket's reminder is
--    claimed (reminders_sent goes up by one) the next reminder is set by the rule, whoever
--    claimed it — the scheduled job, an office user's pass through followup_claim_reminder, and
--    the code that is live before the next publish. An unclaim (the count goes back down), a
--    hold and a date move do not go through it.
-- 5. followup_sync_upsert: a ticket whose date is still ahead gets its first reminder by the
--    rule, and again whenever its date moves to a day still ahead; it also answers with
--    first_remind_at so the assignment notice can name the day.
-- 6. crm_untouched(): the ticket half has a new meaning — the date has passed, the ticket is
--    still assigned and nobody has started it (still Open or Scheduled, no field status, no
--    time clocked, no contact logged on or after its date), ticket_untouched_days WORKING days
--    after the date (or after the day it was assigned, when that is later). Only tickets past
--    the limit are returned. The opportunity half is unchanged, character for character.
-- 7. The open ticket timers whose date is still ahead get their next reminder by the rule.
--
-- Idempotent: columns and constraints only when missing, functions replaced, the trigger
-- dropped and made again, and step 7 only touches a timer that still waits on its date with no
-- reminder sent.

-- ── 1. Settings ───────────────────────────────────────────────────────────────────────────────
alter table public.crm_settings
  add column if not exists ticket_before_every_days integer default 3,
  add column if not exists ticket_due_notice_days integer default 1;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'crm_settings_ticket_before_every_days_check') then
    alter table public.crm_settings
      add constraint crm_settings_ticket_before_every_days_check
      check (ticket_before_every_days is null or ticket_before_every_days between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'crm_settings_ticket_due_notice_days_check') then
    alter table public.crm_settings
      add constraint crm_settings_ticket_due_notice_days_check
      check (ticket_due_notice_days is null or ticket_due_notice_days between 1 and 30);
  end if;
end $$;

-- ── 2. Working days ───────────────────────────────────────────────────────────────────────────
-- The office's calendar day of an instant (src/lib/tasks.ts TASK_TZ).
create or replace function public.office_day(p_at timestamptz default now())
returns date language sql stable set search_path = public as $$
  select (p_at at time zone 'America/New_York')::date;
$$;

-- The n-th working day after a day (Friday + 1 = Monday). n = 0: the day itself, or the Monday
-- after a Saturday or Sunday.
create or replace function public.add_working_days(p_day date, p_n integer)
returns date language plpgsql immutable set search_path = public as $$
declare
  v_day date := p_day;
  v_left integer := greatest(coalesce(p_n, 0), 0);
begin
  if p_day is null then
    return null;
  end if;
  if v_left = 0 then
    while extract(isodow from v_day) > 5 loop
      v_day := v_day + 1;
    end loop;
    return v_day;
  end if;
  while v_left > 0 loop
    v_day := v_day + 1;
    if extract(isodow from v_day) < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_day;
end $$;

-- The n-th working day before a day (one before a Monday, a Saturday or a Sunday is the
-- Friday). n = 0: the day itself, or the Friday before a Saturday or Sunday.
create or replace function public.working_days_before(p_day date, p_n integer)
returns date language plpgsql immutable set search_path = public as $$
declare
  v_day date := p_day;
  v_left integer := greatest(coalesce(p_n, 0), 0);
begin
  if p_day is null then
    return null;
  end if;
  if v_left = 0 then
    while extract(isodow from v_day) > 5 loop
      v_day := v_day - 1;
    end loop;
    return v_day;
  end if;
  while v_left > 0 loop
    v_day := v_day - 1;
    if extract(isodow from v_day) < 6 then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_day;
end $$;

-- Working days after p_from up to and including p_to (Friday → Monday is 1); 0 when p_to is
-- not after p_from.
create or replace function public.working_days_between(p_from date, p_to date)
returns integer language sql immutable set search_path = public as $$
  select count(*)::integer
    from generate_series(1, p_to - p_from) as i
   where extract(isodow from p_from + i) < 6;
$$;

-- ── 3. The rule ───────────────────────────────────────────────────────────────────────────────
-- The next reminder day after p_from (the office's day a reminder went, or the day the
-- technician was assigned) for a ticket dated p_due. p_before / p_notice: null (or under 1) =
-- off. p_after: the timer's every_days.
create or replace function public.ticket_next_remind_day(
  p_due date, p_from date, p_before integer, p_notice integer, p_after integer
)
returns date language plpgsql immutable set search_path = public as $$
declare
  v_next date;
  v_day date;
begin
  if p_due is null or p_from is null then
    return null;
  end if;
  if p_from < p_due then
    v_next := p_due;
    if p_notice >= 1 then
      v_day := public.working_days_before(p_due, p_notice);
      if v_day > p_from and v_day < v_next then
        v_next := v_day;
      end if;
    end if;
    if p_before >= 1 then
      v_day := public.add_working_days(p_from, p_before);
      if v_day < v_next then
        v_next := v_day;
      end if;
    end if;
    return v_next;
  end if;
  return public.add_working_days(p_from, greatest(coalesce(p_after, 1), 1));
end $$;

-- The same as an instant: the due instant itself when the rule lands on the date, 12:00 UTC of
-- the day otherwise (the morning in the office, as a dated ticket's due_at is).
create or replace function public.ticket_next_remind_at(
  p_due_at timestamptz, p_from date, p_before integer, p_notice integer, p_after integer
)
returns timestamptz language sql stable set search_path = public as $$
  select case when x.d = public.office_day(p_due_at) then p_due_at
              else (x.d + time '12:00') at time zone 'UTC' end
    from (select public.ticket_next_remind_day(
                   public.office_day(p_due_at), p_from, p_before, p_notice, p_after) as d) x;
$$;

-- Nothing outside the database calls these six: the trigger and the two functions below run
-- them as their owner.
revoke all on function public.office_day(timestamptz) from public, anon, authenticated;
revoke all on function public.add_working_days(date, integer) from public, anon, authenticated;
revoke all on function public.working_days_before(date, integer) from public, anon, authenticated;
revoke all on function public.working_days_between(date, date) from public, anon, authenticated;
revoke all on function public.ticket_next_remind_day(date, date, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.ticket_next_remind_at(timestamptz, date, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.office_day(timestamptz) to service_role;
grant execute on function public.add_working_days(date, integer) to service_role;
grant execute on function public.working_days_before(date, integer) to service_role;
grant execute on function public.working_days_between(date, date) to service_role;
grant execute on function public.ticket_next_remind_day(date, date, integer, integer, integer)
  to service_role;
grant execute on function public.ticket_next_remind_at(timestamptz, date, integer, integer, integer)
  to service_role;

-- ── 4. Every claim of a ticket's reminder sets the next one by the rule ───────────────────────
-- A claim is the one write that takes reminders_sent up by one (notify.server.ts claimReminder,
-- followup_claim_reminder). Whatever next_remind_at the claimer wrote (the code live before the
-- next publish writes now + every_days calendar days) is replaced. The day counted from is the
-- claim's own last_reminded_at.
create or replace function public.crm_followups_ticket_next()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_before integer;
  v_notice integer;
begin
  if new.kind = 'ticket' and new.status = 'open'
     and new.reminders_sent = old.reminders_sent + 1 then
    select s.ticket_before_every_days, s.ticket_due_notice_days
      into v_before, v_notice
      from public.crm_settings s where s.id = 1;
    new.next_remind_at := public.ticket_next_remind_at(
      new.due_at, public.office_day(coalesce(new.last_reminded_at, now())),
      v_before, v_notice, new.every_days);
  end if;
  return new;
end $$;
revoke all on function public.crm_followups_ticket_next() from public, anon, authenticated;

-- After crm_followups_manager_only (the guard reads what the caller wrote) and before
-- crm_followups_updated_at: triggers fire in name order.
drop trigger if exists crm_followups_ticket_next on public.crm_followups;
create trigger crm_followups_ticket_next
  before update on public.crm_followups
  for each row execute function public.crm_followups_ticket_next();

-- ── 5. The first reminder, and a moved date ───────────────────────────────────────────────────
-- followup_sync_upsert as it stood (20261021101000_followup_sync_invoice_caller.sql) with three
-- changes: v_first_remind for a ticket whose date is ahead; a ticket's date moved to a day
-- still ahead always takes it (it used to keep the old reminder once one had been sent); and
-- first_remind_at in the answer.
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
    when p_due_date is not null then (p_due_date + time '12:00') at time zone 'UTC'
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
revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  from public, anon;
grant execute on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  to authenticated, service_role;

-- ── 6. Untouched tickets: the date has passed and nobody has started it ───────────────────────
-- The ticket half only; the opportunity half is the text of 20260928120000_untouched.sql.
create or replace function public.crm_untouched()
returns table (
  kind text, item_id uuid, title text, url text, account_name text,
  assignee_id uuid, assignee_name text, assigned_at timestamptz, limit_days integer
)
language sql stable security definer set search_path = public as $$
  with s as (
    select ticket_untouched_days as t, opportunity_untouched_days as o from public.crm_settings where id = 1
  ),
  who as (
    select auth.role() = 'service_role' as svc,
           public.has_access('customers') as cust,
           public.has_access('service') as serv,
           public.has_access('estimate') as est,
           public.is_technician() as tech,
           public.is_admin() as adm
  )
  select 'ticket', j.id,
         '#' || j.number || ' ' || j.customer_name || coalesce(' — ' || nullif(j.description, ''), ''),
         '/service?id=' || j.id, j.customer_name,
         j.technician_id, coalesce(nullif(trim(p.full_name), ''), p.email), j.assigned_at, s.t
    from public.service_jobs j
    cross join s cross join who
    left join public.profiles p on p.id = j.technician_id
   where j.deleted_at is null
     and j.technician_id is not null
     and j.stage in ('open', 'scheduled') and j.field_status is null
     and j.scheduled_date < public.office_day(now())
     and not exists (select 1 from public.service_time_entries e where e.service_job_id = j.id)
     and (j.contacted_at is null or public.office_day(j.contacted_at) < j.scheduled_date)
     and public.working_days_between(
           greatest(j.scheduled_date, public.office_day(j.assigned_at)),
           public.office_day(now())) >= s.t
     and (who.svc or who.cust
          or (who.serv and (not who.tech or who.adm or j.technician_id = auth.uid())))
  union all
  select 'opportunity', o.id, o.title, '/opportunities?id=' || o.id, a.name,
         o.assignee_id, coalesce(nullif(trim(p.full_name), ''), p.email), o.assigned_at, s.o
    from public.crm_opportunities o
    cross join s cross join who
    left join public.profiles p on p.id = o.assignee_id
    left join public.crm_accounts a on a.id = o.account_id
   where o.deleted_at is null
     and o.assignee_id is not null
     and o.status = 'open' and o.contacted_at is null
     and (who.svc or who.cust or who.est or o.assignee_id = auth.uid());
$$;
revoke all on function public.crm_untouched() from public, anon;
grant execute on function public.crm_untouched() to authenticated, service_role;

-- ── 7. The open ticket timers whose date is still ahead ───────────────────────────────────────
-- Each one that still waits on its date with no reminder sent (the old rule: the first reminder
-- on the date) gets its next reminder by the rule, counted from the day it was assigned. No
-- burst: where that day is already past, the next working morning, never later than the date.
-- A timer on hold keeps its hold.
do $$
declare
  v_today date := public.office_day(now());
  v_morning timestamptz;
begin
  v_morning := (public.add_working_days(v_today, 0) + time '12:00') at time zone 'UTC';
  if v_morning <= now() then
    v_morning := (public.add_working_days(v_today, 1) + time '12:00') at time zone 'UTC';
  end if;
  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups f
     set next_remind_at = c.next_at
    from (
      select t.id,
             case when r.by_rule > now() then r.by_rule else least(t.due_at, v_morning) end
               as next_at
        from public.crm_followups t
        cross join (select ticket_before_every_days as b, ticket_due_notice_days as n
                      from public.crm_settings where id = 1) s
        cross join lateral (
          select public.ticket_next_remind_at(
                   t.due_at, public.office_day(t.created_at), s.b, s.n, t.every_days) as by_rule
        ) r
       where t.kind = 'ticket' and t.status = 'open'
         and t.reminders_sent = 0
         and (t.snoozed_until is null or t.snoozed_until <= now())
         and public.office_day(t.due_at) > v_today
         and t.next_remind_at >= t.due_at
    ) c
   where f.id = c.id
     and f.next_remind_at is distinct from c.next_at;
  perform set_config('jbk.followup_sync', '', true);
end $$;
