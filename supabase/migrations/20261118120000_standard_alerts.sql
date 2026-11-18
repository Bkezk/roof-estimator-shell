-- Standard alert lines for every kind of work (owner, Nov 18; src/lib/alert-rules.ts).
--
--   1. crm_settings: the new day boxes, and one list of people per line (alert_who).
--   2. unassigned_marks: when a ticket or an opportunity was left with nobody on it, and when
--      the last "nobody is on it" alert went. Kept by the two stamp_assigned triggers.
--   3. Opportunities and the review timer count working days, as tickets have since Nov 13:
--      followup_sync_upsert (the first reminder) and the claim trigger (every next one).
--   4. unassigned_limits(): the "nobody on it" day limits, for Work Overview's red flag.
--
-- Safe to run with the older site still published: every function keeps its name and its
-- answer, and nothing the older site reads is removed. Safe to run twice.

-- 1. Settings -------------------------------------------------------------------------------------
alter table public.crm_settings
  add column if not exists opportunity_before_every_days integer,
  add column if not exists opportunity_due_notice_days integer,
  add column if not exists ticket_review_every_days integer not null default 3,
  add column if not exists ticket_unassigned_every_days integer default 3,
  add column if not exists opportunity_unassigned_days integer not null default 1,
  add column if not exists opportunity_unassigned_every_days integer default 3,
  add column if not exists alert_who jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_settings_alert_days_check') then
    alter table public.crm_settings add constraint crm_settings_alert_days_check check (
      (opportunity_before_every_days is null or opportunity_before_every_days between 1 and 365)
      and (opportunity_due_notice_days is null or opportunity_due_notice_days between 1 and 365)
      and ticket_review_every_days between 1 and 365
      and (ticket_unassigned_every_days is null or ticket_unassigned_every_days between 1 and 365)
      and opportunity_unassigned_days between 0 and 365
      and (opportunity_unassigned_every_days is null
           or opportunity_unassigned_every_days between 1 and 365)
      and jsonb_typeof(alert_who) = 'object'
    );
  end if;
end $$;

-- Carry the old settings over, once (alert_who is still empty): opportunities keep their one
-- "every" number before the date, the review timer keeps the tickets' past-due number,
-- opportunities take the shared "needs assignment" number, and the two Not started lines start
-- as the old "Also tell" list.
update public.crm_settings s
   set opportunity_before_every_days = s.opportunity_every_days,
       ticket_review_every_days = greatest(coalesce(s.ticket_every_days, 3), 1),
       opportunity_unassigned_days = greatest(coalesce(s.unassigned_overdue_days, 1), 0),
       alert_who = jsonb_build_object(
         'ticket.not_started',
           (case when s.escalate_to_admins then '["admins","managers"]'::jsonb else '[]'::jsonb end)
             || to_jsonb(coalesce(s.escalate_user_ids, '{}')::text[]),
         'opportunity.not_started',
           (case when s.escalate_to_admins then '["admins","managers"]'::jsonb else '[]'::jsonb end)
             || to_jsonb(coalesce(s.escalate_user_ids, '{}')::text[]))
 where s.id = 1 and s.alert_who = '{}'::jsonb;

-- 2. Nobody on it ---------------------------------------------------------------------------------
create table if not exists public.unassigned_marks (
  kind text not null check (kind in ('ticket', 'opportunity')),
  item_id uuid not null,
  -- When it was left with nobody on it.
  since timestamptz not null default now(),
  -- When the last "nobody is on it" alert went (null: none yet).
  alerted_at timestamptz,
  primary key (kind, item_id)
);
alter table public.unassigned_marks enable row level security;
revoke all on public.unassigned_marks from anon;
grant select on public.unassigned_marks to authenticated;
revoke insert, update, delete, truncate on public.unassigned_marks from authenticated;
grant all on public.unassigned_marks to service_role;

-- Read by whoever reads the work itself on Work Overview. Written only by the triggers below
-- and by the scheduled reminder pass (the service role).
drop policy if exists unassigned_marks_read on public.unassigned_marks;
create policy unassigned_marks_read on public.unassigned_marks for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager())
         or (select public.has_access('service')) or (select public.has_access('customers')));

create or replace function public.service_jobs_stamp_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.technician_id is null then
    new.assigned_at := null;
    new.escalated_at := null;
    if tg_op = 'INSERT' or old.technician_id is not null then
      insert into public.unassigned_marks (kind, item_id) values ('ticket', new.id)
      on conflict (kind, item_id) do update set since = now(), alerted_at = null;
    end if;
  elsif tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id then
    new.assigned_at := now();
    new.escalated_at := null;
    delete from public.unassigned_marks where kind = 'ticket' and item_id = new.id;
  end if;
  return new;
end $function$;

create or replace function public.crm_opportunities_stamp_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.assignee_id is null then
    new.assigned_at := null;
    new.escalated_at := null;
    if tg_op = 'INSERT' or old.assignee_id is not null then
      insert into public.unassigned_marks (kind, item_id) values ('opportunity', new.id)
      on conflict (kind, item_id) do update set since = now(), alerted_at = null;
    end if;
  elsif tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    new.assigned_at := now();
    new.escalated_at := null;
    delete from public.unassigned_marks where kind = 'opportunity' and item_id = new.id;
  end if;
  return new;
end $function$;

-- What already has nobody on it: counted from its last change (the closest the row holds to
-- "when it lost its person"). Written here, not through the tickets, so no ticket is touched.
insert into public.unassigned_marks (kind, item_id, since)
select 'ticket', j.id, coalesce(j.updated_at, j.created_at)
  from public.service_jobs j
 where j.technician_id is null and j.deleted_at is null and j.stage in ('open', 'scheduled')
on conflict (kind, item_id) do nothing;
insert into public.unassigned_marks (kind, item_id, since)
select 'opportunity', o.id, coalesce(o.updated_at, o.created_at)
  from public.crm_opportunities o
 where o.assignee_id is null and o.deleted_at is null
   and o.status not in ('won', 'lost', 'no_response')
on conflict (kind, item_id) do nothing;

-- 3. Working days for opportunities and the review timer -------------------------------------------
-- Every next reminder, on each claim. A ticket: as since Nov 13. An opportunity: the same rule
-- with its own two "before the date" numbers. The review timer ("Authorize ticket", kind
-- invoice): every N working days at 8:00 in the office. The "after the date" number is read
-- from the settings as they are now, so a change on the page takes effect at the next reminder
-- of a timer that is already running.
create or replace function public.crm_followups_ticket_next()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s public.crm_settings%rowtype;
  v_from date;
begin
  if new.status = 'open' and new.reminders_sent = old.reminders_sent + 1
     and new.kind in ('ticket', 'opportunity', 'invoice') then
    select * into v_s from public.crm_settings where id = 1;
    v_from := public.office_day(coalesce(new.last_reminded_at, now()));
    if new.kind = 'ticket' then
      new.next_remind_at := public.ticket_next_remind_at(
        new.due_at, v_from, v_s.ticket_before_every_days, v_s.ticket_due_notice_days,
        greatest(coalesce(v_s.ticket_every_days, new.every_days), 1));
    elsif new.kind = 'opportunity' then
      new.next_remind_at := public.ticket_next_remind_at(
        new.due_at, v_from, v_s.opportunity_before_every_days, v_s.opportunity_due_notice_days,
        greatest(coalesce(v_s.opportunity_every_days, new.every_days), 1));
    else
      new.next_remind_at := public.reminder_morning(public.add_working_days(
        v_from, greatest(coalesce(v_s.ticket_review_every_days, new.every_days), 1)));
    end if;
  end if;
  return new;
end $function$;

-- The first reminder. Changed from 20261113120000: an opportunity whose expected close is still
-- ahead is planned by the working-day rule too (it was "N days after it is assigned"), and the
-- review timer repeats at its own number (it was the tickets' past-due number).
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
  v_due := case
    when p_due_date is not null then public.reminder_morning(p_due_date)
    else now() + make_interval(days => case when p_kind = 'opportunity' then v_close else v_first end)
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

-- 4. The "nobody on it" limits, for anyone who sees the lists ---------------------------------------
-- crm_settings is an admin's and a manager's to read; Work Overview needs these two numbers for
-- everyone who sees unassigned work (as unassigned_overdue_days() has given the one number).
-- A ticket's limit is the old shared number; tasks keep using it too.
create or replace function public.unassigned_limits()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'ticket', s.unassigned_overdue_days,
    'opportunity', s.opportunity_unassigned_days)
    from public.crm_settings s where s.id = 1;
$function$;
revoke all on function public.unassigned_limits() from public, anon;
grant execute on function public.unassigned_limits() to authenticated, service_role;
