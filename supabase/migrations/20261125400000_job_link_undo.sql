-- One row per job, the audit's findings 21, 22 and 24 (owner, Nov 25: "go on ... 21, 22, 23,
-- 24"; his fear: "i also dont want to miss things").
--
-- 1. undo_opportunity_from_ticket(ticket, opportunity)   NEW
--    "Link an existing ticket" moves the opportunity as a started ticket does
--    (move_opportunity_from_ticket, 20261113100000): an inspection makes an Open one Contacted,
--    a repair marks it Won. Unlink only cleared the link, so the opportunity stayed Won: off
--    Work Overview, off the overdue tile, no reminder, and it could not be linked again. This
--    puts the status back, under three conditions, the way undo_opportunity_from_bid
--    (20261113150000) does for a bid:
--      - the ticket is no longer linked to that opportunity (the caller unlinked it first);
--      - the opportunity's LAST status step is the one that ticket made (its log line says
--        "from ticket #N"), and the opportunity still stands there;
--      - there is a status to go back to (the step before, or Open for a move to Contacted).
--    Anything else is somebody's later decision and is left: the answer says where it stands.
--    The log line of the step back says "ticket #N unlinked". Same people as the move: whoever
--    creates tickets. The server then reopens the follow-up from what this answers.
--
-- 2. opportunity_from_care_request(opportunity)   NEW
--    An opportunity made from a public Roof Care request turns Won the day its plan is paid
--    (roof_care_plan_wins_opportunity, 20261123300000). A linked repair marked it Won before
--    that. The people who link tickets cannot all read the requests (public_requests is for
--    Customers access), so the site asks this before a link would mark one Won, and then does
--    not move it. The link itself is still made.
--
-- 3. step_late_marks   NEW TABLE
--    When the last "a step this opportunity waits on is late" notice went, one row for an
--    opportunity. The reminder run claims it before it sends (an update that only matches the
--    value it read, or the first insert), so two runs at once send one notice, a missed morning
--    is caught up, and the notice is said again every third working day while the step is still
--    late (src/lib/job-steps.ts lateTellDue). A table of its own, not a column on the
--    opportunity: a stamp there would move the opportunity's "updated" day and write a line in
--    its history on every notice (touch_updated_at_unless_escalation, audit_row). The server's
--    alone, like the writes of unassigned_marks.
--
-- Nothing existing is replaced. Safe to run twice.
-- Applied on the live database by hand (AGENTS.md).

-- ── 1. Unlink takes the opportunity back ────────────────────────────────────────────────────
create or replace function public.undo_opportunity_from_ticket(p_job uuid, p_opp uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.service_jobs%rowtype;
  v_opp public.crm_opportunities%rowtype;
  v_last public.crm_opportunity_events%rowtype;
  v_note text;
  v_prev text;
  v_by_ticket boolean;
begin
  -- The people who create tickets, as move_opportunity_from_ticket: an admin, a manager, or
  -- the office with Service access. Never a technician-only user or a signed-out caller.
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
  if not found then
    return jsonb_build_object('action', 'none', 'reason', 'no ticket');
  end if;
  -- Only once the ticket is off this opportunity.
  if v_job.from_opportunity_id is not distinct from p_opp then
    return jsonb_build_object('action', 'none', 'reason', 'still linked');
  end if;
  select * into v_opp from public.crm_opportunities o
   where o.id = p_opp
   for update;
  if not found or v_opp.deleted_at is not null then
    return jsonb_build_object('action', 'none', 'reason', 'no opportunity');
  end if;
  v_note := 'from ticket #' || v_job.number;
  -- Did this ticket ever move it? For the words: "The opportunity is still Won."
  v_by_ticket := exists (
    select 1 from public.crm_opportunity_events e
     where e.opportunity_id = v_opp.id and e.kind = 'status' and e.note = v_note
  );
  -- The opportunity's last status step: this ticket's own, and still where it stands.
  select * into v_last from public.crm_opportunity_events e
   where e.opportunity_id = v_opp.id and e.kind = 'status'
   order by e.at desc, e.id desc
   limit 1;
  if not found
     or v_last.status is distinct from v_opp.status
     or v_last.note is distinct from v_note then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'title', v_opp.title, 'status', v_opp.status,
                              'by_ticket', v_by_ticket);
  end if;
  -- Where it stood before that step: the step before it, or how it was created.
  select e.status into v_prev from public.crm_opportunity_events e
   where e.opportunity_id = v_opp.id and e.kind in ('status', 'created')
     and (e.at, e.id) < (v_last.at, v_last.id)
   order by e.at desc, e.id desc
   limit 1;
  -- An opportunity from before the log kept the status it started at: a ticket makes only an
  -- Open one Contacted, so that step is known anyway.
  if v_prev is null and v_last.status = 'contacted' then
    v_prev := 'open';
  end if;
  if v_prev is null or v_prev = v_opp.status or v_prev in ('won', 'lost', 'no_response') then
    return jsonb_build_object('action', 'unchanged', 'opportunity_id', v_opp.id,
                              'title', v_opp.title, 'status', v_opp.status,
                              'by_ticket', v_by_ticket);
  end if;
  -- The log trigger reads this for the one update below, and it is cleared straight after.
  perform set_config('app.opportunity_move_note', 'ticket #' || v_job.number || ' unlinked', true);
  update public.crm_opportunities
     set status = v_prev,
         updated_by_name = public.event_actor_name(auth.uid())
   where id = v_opp.id;
  perform set_config('app.opportunity_move_note', '', true);
  return jsonb_build_object('action', 'updated', 'opportunity_id', v_opp.id,
                            'title', v_opp.title, 'from', v_opp.status, 'to', v_prev,
                            'ticket', v_job.number,
                            -- for the follow-up reminders (the server's syncFollowup)
                            'account_id', v_opp.account_id, 'assignee_id', v_opp.assignee_id,
                            'expected_close', v_opp.expected_close);
end;
$function$;

revoke all on function public.undo_opportunity_from_ticket(uuid, uuid) from public, anon;
grant execute on function public.undo_opportunity_from_ticket(uuid, uuid) to authenticated, service_role;

-- ── 2. Did this opportunity come from a public Roof Care request? ───────────────────────────
create or replace function public.opportunity_from_care_request(p_opp uuid)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
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
  return exists (
    select 1 from public.public_requests q
     where q.opportunity_id = p_opp and q.kind = 'care'
  );
end;
$function$;

revoke all on function public.opportunity_from_care_request(uuid) from public, anon;
grant execute on function public.opportunity_from_care_request(uuid) to authenticated, service_role;

-- ── 3. When the last "a step is late" notice went ───────────────────────────────────────────
create table if not exists public.step_late_marks (
  opportunity_id uuid primary key references public.crm_opportunities(id) on delete cascade,
  -- When the last late-step notice went for this opportunity.
  told_at timestamptz not null default now()
);
comment on table public.step_late_marks is
  'When the last "a step this opportunity waits on is late" notice went. Written and read by the reminder run alone (the service role); src/lib/job-steps.server.ts tellLateSteps.';
alter table public.step_late_marks enable row level security;
revoke all on public.step_late_marks from public, anon, authenticated;
grant all on public.step_late_marks to service_role;

notify pgrst, 'reload schema';
