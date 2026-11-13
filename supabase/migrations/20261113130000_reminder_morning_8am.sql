-- The morning is 8:00 in the office, all year (owner, Nov 13: "lets do 8AM est instead of 7 am
-- plz").
--
-- A follow-up's due instant and a ticket's reminder instant were written at 12:00 UTC of their
-- day: 8 AM Eastern in summer, 7 AM in winter. They are now 8:00 on the office's clock
-- (America/New_York, src/lib/tasks.ts TASK_TZ) whatever the season: 13:00 UTC in winter, 12:00
-- UTC in summer. A hold already ended at that hour (hold_followup, 20261009150000).
--
-- 1. reminder_morning(day): that instant. The twin of src/lib/working-days.ts reminderMorning.
-- 2. ticket_next_remind_at and followup_sync_upsert as they stood in
--    20261113120000_ticket_reminders_working_days.sql, each with its one "12:00 UTC" line now
--    calling the helper. followup_sync_upsert writes due_at for opportunities too, so an
--    opportunity's due instant is 8:00 as well; its first reminder and its repeat are untouched.
-- 3. The open follow-ups: a due_at that sits exactly at 12:00:00 UTC of its day becomes that
--    day's reminder_morning, so the next save of the item does not read as "date moved" (which
--    would clear a hold and restart the reminders). A next_remind_at exactly at 12:00:00 UTC
--    that is still ahead moves the same way; one that is due now and not yet sent stays due.
--    In summer the two instants are the same and nothing changes.
--
-- Idempotent: functions replaced; step 3 only touches a row whose instant would change.

-- ── 1. The morning ────────────────────────────────────────────────────────────────────────────
-- Stable, not immutable: the answer depends on the zone's rules.
create or replace function public.reminder_morning(p_day date)
returns timestamptz language sql stable set search_path = public as $$
  select (p_day + time '08:00') at time zone 'America/New_York';
$$;
-- Only the database's own functions call it.
revoke all on function public.reminder_morning(date) from public, anon, authenticated;
grant execute on function public.reminder_morning(date) to service_role;

-- ── 2. The two functions that wrote 12:00 UTC ─────────────────────────────────────────────────
-- A ticket's next reminder: the due instant itself when the rule lands on the date, the day's
-- morning otherwise.
create or replace function public.ticket_next_remind_at(
  p_due_at timestamptz, p_from date, p_before integer, p_notice integer, p_after integer
)
returns timestamptz language sql stable set search_path = public as $$
  select case when x.d = public.office_day(p_due_at) then p_due_at
              else public.reminder_morning(x.d) end
    from (select public.ticket_next_remind_day(
                   public.office_day(p_due_at), p_from, p_before, p_notice, p_after) as d) x;
$$;
revoke all on function public.ticket_next_remind_at(timestamptz, date, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ticket_next_remind_at(timestamptz, date, integer, integer, integer)
  to service_role;

-- A dated item's due instant: the morning of its date (every kind that has a date).
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
revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  from public, anon;
grant execute on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  to authenticated, service_role;

-- ── 3. The open follow-ups ────────────────────────────────────────────────────────────────────
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
