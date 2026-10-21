-- A review timer (kind 'invoice', "Authorize ticket #…") is started, handed over and closed by
-- the office only (the seventh audit, Oct 21; owner approved item 5). followup_sync_upsert
-- (20261002140000_followup_guard.sql) checks a signed-in caller's item before writing — the
-- assignee and the date must be the item's own — but for kind 'invoice' it read the assignee
-- as `v_item_assignee := p_assignee_id` (the ticket has no column for who reviews it), so that
-- check could never fail: any token with has_access('service'), a technician-only user's
-- included, could start or hand over the review follow-up of any Done ticket to any user.
-- followup_sync_close's invoice branch let any Service caller who was not the follow-up's own
-- assignee close one while the ticket sat at Done. Both proved live as the technician-only test
-- login (upsert answered "reassigned"; rolled back).
--
-- The app never calls either function with a user's token: followups.server.ts syncFollowup is
-- the only caller (`grep -rn followup_sync_ src/`), through the admin client (service role →
-- followup_is_system()), and the review timer's one starter is ticket-events.server.ts
-- afterTicketStage with that same client. So for kind 'invoice' the caller must be the system,
-- an admin or a manager; anyone else is refused with 42501 "Only the office starts or closes a
-- review timer". The 'ticket' and 'opportunity' branches are exactly as on Oct 2 (the item
-- vouches for those: its technician / assignee and its date). Note for the preview (no service
-- key: notify.server.ts serverClient falls back to the signed-in user's client): a technician
-- marking a ticket Done there now has the review timer refused — the published app has the key.
--
-- Both bodies are the Oct 2 text with only the invoice branch changed. Idempotent: `create or
-- replace` with the same signatures, and the same revoke / grant lines. Pinned by
-- src/lib/work-overview-oct21-audit7-data.test.ts (the untouched branches are compared to the
-- Oct 2 migration's text).

-- 1. Start, refresh or hand over the item's open follow-up (followups.server.ts syncFollowup).
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
      -- picked by the app from the office (ticket-events.server.ts); undated. Oct 21: the ticket
      -- cannot vouch for that assignee, so a signed-in caller must be an admin or a manager —
      -- the app itself arrives here as the system.
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

-- 2. Close the item's follow-up (followups.server.ts syncFollowup): the item was finished,
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
      -- A review timer (Oct 21): the system's, an admin's or a manager's — all of whom the
      -- check above already let through. Until now any other Service caller could close it
      -- while the ticket sat at Done.
      raise exception 'Only the office starts or closes a review timer' using errcode = '42501';
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
