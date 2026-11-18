-- Every reminder at 8:00 in the office on a working day (owner, Nov 18, of the audit's finding
-- "not everything goes at 8 AM on a working day": "can you fix those?").
--
--   1. followup_sync_upsert: work with no date gets a due day that is a working day, at 8:00.
--      The only change from 20261118120000 is how v_due is worked out when p_due_date is null.
--   2. Open timers that still carry a clock time from the older rule are moved, once, to 8:00
--      on their own day (the next working day when that day is a Saturday or a Sunday).
--
-- The reminder pass itself now sends nothing before 8:00 (src/lib/notify.server.ts), so a
-- reminder held over a weekend goes at 8:00 on Monday, not on the day's first run at 7.
--
-- Safe with the older site still published (same name, same answer). Safe to run twice.

create or replace function public.followup_sync_upsert(
  p_kind text, p_item_id uuid, p_assignee_id uuid, p_account_id uuid, p_title text, p_url text,
  p_due_date date, p_created_by uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_today_due boolean := false;
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
  v_first := coalesce(v_s.ticket_first_days, 1);
  v_every := greatest(coalesce(
    case p_kind when 'opportunity' then v_s.opportunity_every_days
                when 'invoice' then v_s.ticket_review_every_days
                else v_s.ticket_every_days end,
    case when p_kind = 'opportunity' then 7 else 3 end), 1);
  v_close := coalesce(v_s.opportunity_close_days, 30);
  -- Work with no date of its own (Nov 18, the audit): its due day is a working day and its
  -- reminders go at 8:00 in the office, as every dated item's do. It was "now plus N calendar
  -- days" at the clock time of the assignment, so a ticket given out on a Friday afternoon was
  -- reminded on Saturday afternoon. A ticket and the review timer: N working days from today.
  -- An opportunity: its N calendar days, moved on to Monday when they end on a weekend.
  v_due := case
    when p_due_date is not null then public.reminder_morning(p_due_date)
    when p_kind = 'opportunity' then
      public.reminder_morning(public.add_working_days(v_today + v_close, 0))
    else public.reminder_morning(public.add_working_days(v_today, v_first))
  end;
  -- A ticket or an opportunity whose date is still ahead is reminded before it, on working days
  -- (ticket_next_remind_at: the cadence, the notice, the date). A date that is today or past,
  -- and the review timer: on the date, or now.
  v_ahead := p_kind in ('ticket', 'opportunity') and public.office_day(v_due) > v_today;
  -- Nov 13 (audit, finding 5): a ticket moved to TODAY takes today's reminder as well.
  v_today_due := p_kind = 'ticket' and public.office_day(v_due) = v_today;
  v_first_remind := case
    when v_ahead and p_kind = 'opportunity' then public.ticket_next_remind_at(
      v_due, v_today, v_s.opportunity_before_every_days, v_s.opportunity_due_notice_days, v_every)
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
             when v_date_moved
                  and (reminders_sent = 0 or v_snooze_cleared or v_ahead or v_today_due)
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
end $function$;

-- 2. The timers already running at an odd clock time. A timer on hold keeps its hold; only the
-- time of the next reminder moves. The sync flag lets the write past the follow-up guard.
do $$
begin
  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups f
     set next_remind_at = public.reminder_morning(
           public.add_working_days(public.office_day(f.next_remind_at), 0))
   where f.status = 'open'
     and f.next_remind_at is not null
     and f.next_remind_at <> public.reminder_morning(public.office_day(f.next_remind_at))
     -- A dated item's reminder on its own date stays on that date, weekend or not (its due
     -- instant is that day's 8:00; an undated one's is not, and moves with the rest).
     and not (public.office_day(f.next_remind_at) = public.office_day(f.due_at)
              and f.due_at = public.reminder_morning(public.office_day(f.due_at)));
  perform set_config('jbk.followup_sync', '', true);
end $$;
