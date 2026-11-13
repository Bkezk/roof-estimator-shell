-- Opportunity → inspection → repair ticket / bid: the joins (owner, Nov 13: "I like all the
-- steps", "go with the preselect office choices and show the whole chain").
--
-- 1. The opportunity is carried through. A ticket started from an opportunity already keeps it
--    (service_jobs.from_opportunity_id). Now a repair ticket made from that inspection takes it
--    too, and so does a bid started from the inspection (bids.opportunity_id, with the
--    opportunity's own bid pointer), so the bid drives the opportunity exactly as a bid started
--    from the opportunity does (sync_opportunity_from_bid, 20261012100000). Triggers, so every
--    path gets it. One bid drives an opportunity: when the opportunity already has a live bid, a
--    second bid from the same inspection (an option for the customer, usually a copy) is not
--    linked to it. Nothing is backfilled.
-- 2. A ticket moves its opportunity (move_opportunity_from_ticket): never backwards, never out
--    of Won / Lost / No response, never on a deleted opportunity.
--      inspection or warranty ticket  → Open becomes Contacted
--      repair (or other) ticket       → Won
--      asked for, on an inspection whose outcome is "No action needed" → Lost or No response
--    It runs with the function's own rights (the people who create tickets do not all have the
--    right to edit opportunities) after checking the caller is one of those people. The server
--    calls it after the ticket is made and then brings the follow-up reminders in line, as it
--    does for a bid (src/lib/opportunities.functions.ts); what the reminders need of the
--    opportunity comes back in the answer, so nothing is read with rights the caller lacks.
--    Deleting or restoring a ticket moves nothing back. ticket_opportunity answers the same
--    people the title and status of a ticket's opportunity, for the question the office is asked
--    after "No action needed".
-- 3. The status log says where a move came from: crm_opportunity_events.note ("from ticket
--    #6071"), written by the log trigger from a setting the function holds for that one update.

alter table public.crm_opportunity_events add column if not exists note text;

comment on column public.crm_opportunity_events.note is
  'Where a status change came from when it was not made by hand on the opportunity, e.g. "from ticket #6071". Null for a hand-made change.';

create or replace function public.crm_opportunities_log()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := public.event_actor_name(auth.uid());
  v_note text := nullif(current_setting('app.opportunity_move_note', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.crm_opportunity_events (opportunity_id, kind, status, assignee, by_user, by_name, at)
    values (new.id, 'created', new.status, new.assignee_id, v_uid, v_name, coalesce(new.created_at, now()));
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.crm_opportunity_events (opportunity_id, kind, status, by_user, by_name, note)
    values (new.id, 'status', new.status, v_uid, v_name, v_note);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.crm_opportunity_events (opportunity_id, kind, assignee, by_user, by_name)
    values (new.id, 'assign', new.assignee_id, v_uid, v_name);
  end if;
  return null;
end;
$function$;

-- ── 1a. A repair ticket takes its inspection's opportunity ──────────────────────────────────
create or replace function public.service_jobs_carry_opportunity()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.from_job_id is not null and new.from_opportunity_id is null then
    select j.from_opportunity_id into new.from_opportunity_id
      from public.service_jobs j
     where j.id = new.from_job_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists service_jobs_carry_opportunity on public.service_jobs;
create trigger service_jobs_carry_opportunity
  before insert on public.service_jobs
  for each row execute function public.service_jobs_carry_opportunity();

-- ── 1b. A bid started from an inspection takes the inspection's opportunity ──────────────────
-- Only when the bid has none and the opportunity is live and has no live bid of its own yet
-- (a pointer to a deleted bid does not count).
create or replace function public.bids_carry_opportunity()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_opp uuid;
begin
  if new.from_job_id is null or new.opportunity_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.from_job_id is not distinct from old.from_job_id then
    return new;
  end if;
  select o.id into v_opp
    from public.service_jobs j
    join public.crm_opportunities o on o.id = j.from_opportunity_id
   where j.id = new.from_job_id
     and o.deleted_at is null
     and (
       o.bid_id is null
       or o.bid_id = new.id
       or exists (select 1 from public.bids b where b.id = o.bid_id and b.deleted_at is not null)
     );
  if found then
    new.opportunity_id := v_opp;
  end if;
  return new;
end;
$function$;

drop trigger if exists bids_carry_opportunity on public.bids;
create trigger bids_carry_opportunity
  before insert or update of from_job_id on public.bids
  for each row execute function public.bids_carry_opportunity();

-- The opportunity's own pointer, once the bid row is there (the pointer is a foreign key).
create or replace function public.bids_carry_opportunity_link()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.opportunity_id is null or new.from_job_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.opportunity_id is not distinct from old.opportunity_id
     and new.from_job_id is not distinct from old.from_job_id then
    return null;
  end if;
  update public.crm_opportunities o
     set bid_id = new.id,
         updated_by_name = public.event_actor_name(auth.uid())
   where o.id = new.opportunity_id
     and o.deleted_at is null
     and o.bid_id is distinct from new.id
     and (
       o.bid_id is null
       or exists (select 1 from public.bids b where b.id = o.bid_id and b.deleted_at is not null)
     );
  return null;
end;
$function$;

drop trigger if exists bids_carry_opportunity_link on public.bids;
create trigger bids_carry_opportunity_link
  after insert or update of from_job_id, opportunity_id on public.bids
  for each row execute function public.bids_carry_opportunity_link();

-- ── 2. A ticket moves its opportunity ───────────────────────────────────────────────────────
create or replace function public.move_opportunity_from_ticket(p_job uuid, p_to text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.service_jobs%rowtype;
  v_opp public.crm_opportunities%rowtype;
  v_to text;
  v_note text;
begin
  -- The people who create tickets and decide what comes of an inspection: an admin, a manager,
  -- or the office with Service access (the rule of service_jobs_insert). Never a technician-only
  -- user, and never a signed-out caller.
  if not (
    public.followup_is_system()
    or (
      public.has_access('service')
      and (public.is_admin() or public.is_manager() or not public.is_technician())
    )
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into v_job from public.service_jobs j where j.id = p_job;
  if not found or v_job.deleted_at is not null or v_job.from_opportunity_id is null then
    return jsonb_build_object('action', 'none', 'reason', 'no opportunity');
  end if;
  select * into v_opp from public.crm_opportunities o
   where o.id = v_job.from_opportunity_id
   for update;
  if not found or v_opp.deleted_at is not null then
    return jsonb_build_object('action', 'none', 'reason', 'no opportunity');
  end if;
  if p_to is not null then
    if p_to not in ('lost', 'no_response') then
      raise exception 'An inspection closes its opportunity as Lost or No response only'
        using errcode = '22023';
    end if;
    if v_job.service_type <> 'inspection' or v_job.inspection_outcome is distinct from 'none' then
      raise exception 'Only an inspection marked "No action needed" closes its opportunity this way'
        using errcode = '22023';
    end if;
  end if;
  -- Closed is closed: Won, Lost and No response are never moved from here.
  if v_opp.status in ('won', 'lost', 'no_response') then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'title', v_opp.title, 'status', v_opp.status);
  end if;
  if p_to is not null then
    v_to := p_to;
    v_note := 'from ticket #' || v_job.number || ': no action needed';
  elsif v_job.service_type in ('inspection', 'warranty') then
    -- A visit, not a sale: the customer has been reached.
    v_to := case when v_opp.status = 'open' then 'contacted' else null end;
    v_note := 'from ticket #' || v_job.number;
  else
    v_to := 'won';
    v_note := 'from ticket #' || v_job.number;
  end if;
  if v_to is null or v_to = v_opp.status then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'title', v_opp.title, 'status', v_opp.status);
  end if;
  -- The log trigger reads this for the one update below, and it is cleared straight after.
  perform set_config('app.opportunity_move_note', v_note, true);
  update public.crm_opportunities
     set status = v_to,
         updated_by_name = public.event_actor_name(auth.uid())
   where id = v_opp.id;
  perform set_config('app.opportunity_move_note', '', true);
  return jsonb_build_object('action', 'updated', 'opportunity_id', v_opp.id,
                            'title', v_opp.title, 'from', v_opp.status, 'to', v_to,
                            'ticket', v_job.number,
                            -- for the follow-up reminders (the server's syncFollowup)
                            'account_id', v_opp.account_id, 'assignee_id', v_opp.assignee_id,
                            'expected_close', v_opp.expected_close);
end;
$function$;

-- The opportunity a ticket came from, as the question after "No action needed" names it: its
-- title and status, nothing else, for the people who answer (the same check as the move). Null
-- when the ticket has none, or either is deleted.
create or replace function public.ticket_opportunity(p_job uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  if not (
    public.followup_is_system()
    or (
      public.has_access('service')
      and (public.is_admin() or public.is_manager() or not public.is_technician())
    )
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object('id', o.id, 'title', o.title, 'status', o.status)
    into v_out
    from public.service_jobs j
    join public.crm_opportunities o on o.id = j.from_opportunity_id
   where j.id = p_job
     and j.deleted_at is null
     and o.deleted_at is null;
  return v_out;
end;
$function$;

-- Only what each needs: the two are for signed-in users (each checks who inside) and the server;
-- trigger functions are not anyone's to call.
revoke all on function public.move_opportunity_from_ticket(uuid, text) from public, anon;
grant execute on function public.move_opportunity_from_ticket(uuid, text) to authenticated, service_role;
revoke all on function public.ticket_opportunity(uuid) from public, anon;
grant execute on function public.ticket_opportunity(uuid) to authenticated, service_role;
revoke all on function public.service_jobs_carry_opportunity() from public, anon, authenticated;
revoke all on function public.bids_carry_opportunity() from public, anon, authenticated;
revoke all on function public.bids_carry_opportunity_link() from public, anon, authenticated;
