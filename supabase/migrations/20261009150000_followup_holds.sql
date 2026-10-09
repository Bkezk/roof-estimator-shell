-- Follow-up holds (owner, Oct 9). A snooze now has a date and a reason, logging a contact can
-- hold the follow-up until the day the customer asked for, the hold is remembered on the row
-- (who, why, how, how often), and the reminder pass says "Back from hold" when it ends.
-- Idempotent: every statement can run again.
--
-- One write path: hold_followup(p_followup, p_until, p_reason, p_via). The manager-only trigger
-- (20261001030000 / 20261002140000 crm_followups_manager_only) is unchanged: it still refuses a
-- non-manager who sets snoozed_until or next_remind_at directly. This function is SECURITY
-- DEFINER and writes under the trigger's transaction-local flag (jbk.followup_sync), after its
-- own check:
--   p_via 'snooze'   the bare Snooze on Work Overview / the opportunity page: an admin's or a
--                    manager's (owner, Oct 1), as before.
--   p_via 'contact'  a logged contact with "They asked to try again on": the follow-up's
--                    ASSIGNEE as well as an admin or a manager (owner, Oct 9: "a logged contact
--                    with a date is a recorded reason").
--   p_until null     clears the hold's record (hold_reason, hold_via, held_by, held_by_name,
--                    held_at) — a contact logged without a new date after a hold ended; same
--                    callers. snoozed_until / next_remind_at are left alone.
-- The hold ends at 08:00 Eastern on p_until (the office's morning: src/lib/tasks.ts
-- ALL_DAY_HOUR / TASK_TZ, the all-day convention), which is both snoozed_until and
-- next_remind_at, so the first reminder after the hold fires that morning.

-- 1. The hold's record on the follow-up.
alter table public.crm_followups add column if not exists hold_reason text;
alter table public.crm_followups add column if not exists hold_via text
  check (hold_via in ('snooze','contact'));
alter table public.crm_followups add column if not exists held_by uuid
  references public.profiles(id) on delete set null;
alter table public.crm_followups add column if not exists held_by_name text;
alter table public.crm_followups add column if not exists held_at timestamptz;
alter table public.crm_followups add column if not exists hold_count integer not null default 0;

comment on column public.crm_followups.hold_reason is
  'Why the follow-up is (or was last) on hold, 1..200 chars (owner, Oct 9). Set by hold_followup; cleared when a contact is logged without a new date after the hold ended. While set and snoozed_until has passed, Work Overview shows "Back from hold" and the first reminder reads "Back from hold: …".';
comment on column public.crm_followups.hold_via is
  'How the hold was set: snooze (a manager''s Snooze) or contact (a logged contact with "They asked to try again on").';
comment on column public.crm_followups.held_by is 'Who set the hold (auth.uid() in hold_followup).';
comment on column public.crm_followups.held_by_name is 'The holder''s name at the time, for the row ("held by …").';
comment on column public.crm_followups.held_at is 'When the hold was set.';
comment on column public.crm_followups.hold_count is
  'How many times this follow-up has been put on hold (Work Overview: "held 3 times" when > 1).';

-- 2. The write path.
create or replace function public.hold_followup(
  p_followup uuid,
  p_until date,
  p_reason text,
  p_via text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f public.crm_followups%rowtype;
  v_system boolean := public.followup_is_system();
  v_manager boolean := public.is_admin() or public.is_manager();
  v_today date := (now() at time zone 'America/New_York')::date;
  v_at timestamptz;
  v_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_via is null or p_via not in ('snooze', 'contact') then
    raise exception 'Unknown hold source %', p_via;
  end if;
  select * into f from public.crm_followups where id = p_followup for update;
  if not found or f.status <> 'open' then
    raise exception 'That follow-up is not open' using errcode = 'P0002';
  end if;
  -- Who: the system, an admin or a manager; a logged contact also the follow-up's own assignee.
  if not (v_system or v_manager or f.assignee_id = auth.uid()) then
    raise exception 'Only the assignee or a manager can put a follow-up on hold'
      using errcode = '42501';
  end if;
  -- The bare Snooze stays a manager's (owner, Oct 1).
  if p_via = 'snooze' and not (v_system or v_manager) then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;

  if p_until is null then
    -- Clear the hold's record (the "Back from hold" state ends); the dates stay as they are.
    perform set_config('jbk.followup_sync', 'on', true);
    update public.crm_followups
       set hold_reason = null, hold_via = null, held_by = null, held_by_name = null, held_at = null
     where id = f.id;
    perform set_config('jbk.followup_sync', '', true);
    return jsonb_build_object('id', f.id, 'cleared', true, 'hold_count', f.hold_count);
  end if;

  -- The date: tomorrow (Eastern) through 180 days out; the reason: 1..200 characters.
  if p_until <= v_today then
    raise exception 'The hold date must be tomorrow or later';
  end if;
  if p_until > v_today + 180 then
    raise exception 'The hold date can be at most 180 days out';
  end if;
  if v_reason = '' or length(v_reason) > 200 then
    raise exception 'A hold needs a reason (1 to 200 characters)';
  end if;
  -- 08:00 Eastern on that day (the office's morning; src/lib/tasks.ts ALL_DAY_HOUR).
  v_at := (p_until + time '08:00') at time zone 'America/New_York';
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name
    from public.profiles p where p.id = auth.uid();

  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups
     set snoozed_until = v_at,
         next_remind_at = v_at,
         hold_reason = v_reason,
         hold_via = p_via,
         held_by = auth.uid(),
         held_by_name = v_name,
         held_at = now(),
         hold_count = hold_count + 1
   where id = f.id;
  perform set_config('jbk.followup_sync', '', true);

  return jsonb_build_object(
    'id', f.id,
    'cleared', false,
    'until', p_until,
    'next_remind_at', v_at,
    'hold_count', f.hold_count + 1,
    'held_by_name', v_name
  );
end $$;
revoke all on function public.hold_followup(uuid, date, text, text) from public;
revoke all on function public.hold_followup(uuid, date, text, text) from anon;
grant execute on function public.hold_followup(uuid, date, text, text) to authenticated, service_role;

comment on function public.hold_followup(uuid, date, text, text) is
  'Put an open follow-up on hold until p_until (08:00 Eastern) with a reason, via ''snooze'' (admins / managers) or ''contact'' (also the assignee); p_until null clears the hold''s record. Writes under jbk.followup_sync so crm_followups_manager_only lets it through (owner, Oct 9).';
