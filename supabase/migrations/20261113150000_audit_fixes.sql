-- Fixes from the Nov 13 audit (owner: "fix this plz" for findings 3, 4 and 5).
--
-- 1. followup_sync_upsert: a ticket whose date is moved to today takes today's reminder even
--    when a reminder has already gone out. As 20261113130000 otherwise, word for word.
-- 2. undo_opportunity_from_bid(bid): the Undo on a bid's status puts the opportunity back too.
--    Changing a bid to Submitted / Won / Lost moves its opportunity (sync_opportunity_from_bid);
--    going back to Draft moves nothing, by the Oct 12 rule. An Undo is not a decision to reopen,
--    it takes back a slip, so it reverts the opportunity's last status step, and only when that
--    step is the caller's own, minutes old, still in place, and the bid is Draft again.
-- 3. push_subscription_claim(...): a browser belongs to whoever is signed in on it now. Since
--    20261113140000 a second person turning notifications on at a device another person had
--    registered was refused by the row rules (the endpoint is unique and the row was the first
--    person's). The function writes the row for the caller, whoever held it. Nothing else can
--    move a device row to another person.
--
-- Idempotent: create or replace throughout.

-- ── 1. A ticket moved to today ────────────────────────────────────────────────────────────────
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
  -- Nov 13 (audit, finding 5): a ticket moved to TODAY takes today's reminder as well, whatever
  -- has been sent. Reminders now go out before the date, so a ticket moved back to today had
  -- usually had one already and kept its old cadence day: no "due today" reminder came.
  v_today_due := p_kind = 'ticket' and public.office_day(v_due) = v_today;
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
end $$;
revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  from public, anon;
grant execute on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)
  to authenticated, service_role;

-- ── 2. Undo takes the opportunity back ────────────────────────────────────────────────────────
create or replace function public.undo_opportunity_from_bid(p_bid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bid public.bids%rowtype;
  v_opp public.crm_opportunities%rowtype;
  v_last public.crm_opportunity_events%rowtype;
  v_prev text;
begin
  -- Whoever may edit the bid, as sync_opportunity_from_bid.
  if not (public.followup_is_system() or public.has_access('estimate')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into v_bid from public.bids b where b.id = p_bid;
  if not found then
    return jsonb_build_object('action', 'none', 'reason', 'no bid');
  end if;
  -- Only once the bid itself is back to Draft.
  if v_bid.status is distinct from 'draft' then
    return jsonb_build_object('action', 'unchanged', 'reason', 'bid not draft');
  end if;
  select * into v_opp from public.crm_opportunities o
   where o.deleted_at is null
     and (o.bid_id = p_bid or o.id = v_bid.opportunity_id)
   order by (o.bid_id is not distinct from p_bid) desc, o.updated_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('action', 'none', 'reason', 'no opportunity');
  end if;
  -- The opportunity's last status step: the caller's own, a bid's kind of step, minutes old,
  -- and still where the opportunity stands. Anything else is somebody's later decision.
  select * into v_last from public.crm_opportunity_events e
   where e.opportunity_id = v_opp.id and e.kind = 'status'
   order by e.at desc, e.id desc
   limit 1;
  if not found
     or v_last.status is distinct from v_opp.status
     or v_last.status not in ('quoted', 'won', 'lost')
     or v_last.by_user is distinct from auth.uid()
     or v_last.at < now() - interval '15 minutes' then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'status', v_opp.status);
  end if;
  -- Where it stood before that step: the step before it, or how it was created.
  select e.status into v_prev from public.crm_opportunity_events e
   where e.opportunity_id = v_opp.id and e.kind in ('status', 'created')
     and (e.at, e.id) < (v_last.at, v_last.id)
   order by e.at desc, e.id desc
   limit 1;
  if v_prev is null or v_prev = v_opp.status then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'status', v_opp.status);
  end if;
  perform set_config('app.opportunity_move_note', 'bid status undone', true);
  update public.crm_opportunities
     set status = v_prev,
         updated_by_name = public.event_actor_name(auth.uid())
   where id = v_opp.id;
  perform set_config('app.opportunity_move_note', '', true);
  return jsonb_build_object('action', 'updated', 'opportunity_id', v_opp.id,
                            'from', v_opp.status, 'to', v_prev);
end $$;
revoke all on function public.undo_opportunity_from_bid(uuid) from public, anon;
grant execute on function public.undo_opportunity_from_bid(uuid) to authenticated, service_role;

-- ── 3. This browser's notifications are the signed-in person's ────────────────────────────────
create or replace function public.push_subscription_claim(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'The device details are missing' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, failed_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent, null)
  on conflict (endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         failed_at = null;
end $$;
revoke all on function public.push_subscription_claim(text, text, text, text) from public, anon;
grant execute on function public.push_subscription_claim(text, text, text, text)
  to authenticated, service_role;
