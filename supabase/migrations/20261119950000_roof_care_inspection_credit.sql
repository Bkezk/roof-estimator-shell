-- Roof Care: three rules the owner agreed on Nov 19, after the numbers showed where the plans
-- lost money ("we need some rules so the worst case on roof guard … doesnt happen").
--
--   1. An inspection we did not get to takes THE PRICE OF ONE INSPECTION off the renewal, not
--      half the plan ("go for 1"). One inspection is half of what Roof Watch costs for that
--      roof and drive: Roof Watch is two inspections and nothing else. Half of a larger plan
--      gave back far more than the inspection was worth, because most of that plan's price pays
--      for repairs, leak calls and a storm inspection the customer still had.
--   2. A refund also takes off the leak call travel that was not charged, and a storm inspection
--      counts as an inspection done ("2. go for this").
--   3. A manager can close out an expired plan that will not be renewed ("do we ever have the
--      ability to dismiss that? say its owed and been 6 months and they just dont seem
--      interested"): what is still owed is dropped, its tickets come off the board, and the plan
--      leaves the Needs attention list.

-- 1. The price of one inspection off the renewal -------------------------------------------------
do $mig$
declare
  d text;
  wrong constant text := 'A Roof Care function is not as this change expects: ';
  -- both functions read the plan's own price on this line
  a1 text := '  v_amount := (v_row->>''price'')::numeric;';
  b1 text := '  v_amount := (v_row->>''price'')::numeric;
  -- One inspection: half of Roof Watch (two inspections and nothing else) for this roof and drive.
  select (e->>''price'')::numeric into v_watch
    from jsonb_array_elements(v_price->''plans'') e where e->>''plan'' = ''watch'';';
  -- renewing
  a2 text := '  v_credit numeric := 0;';
  b2 text := '  v_credit numeric := 0;
  v_watch numeric;';
  a3 text := '      v_credit := round(v_amount * least(v_n, 2) / 2.0, 2);';
  b3 text := '      v_credit := least(v_amount, round(v_watch * least(v_n, 2) / 2.0, 2));';
  -- the Renew box
  a4 text := '  v_late boolean;';
  b4 text := '  v_late boolean;
  v_watch numeric;';
  a5 text := '    ''credit_if_half_off'', round(v_amount * least(v_n, 2) / 2.0, 2),';
  b5 text := '    ''credit_if_half_off'', least(v_amount, round(v_watch * least(v_n, 2) / 2.0, 2)),';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_renew';
  if position('v_watch' in d) = 0 then
    if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
      raise exception '%roof_care_renew', wrong;
    end if;
    execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_renewal_offer';
  if position('v_watch' in d) = 0 then
    if position(a1 in d) = 0 or position(a4 in d) = 0 or position(a5 in d) = 0 then
      raise exception '%roof_care_renewal_offer', wrong;
    end if;
    execute replace(replace(replace(d, a1, b1), a4, b4), a5, b5);
  end if;
end $mig$;

-- 2. The refund ----------------------------------------------------------------------------------
create or replace function public.roof_care_refund_worked(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_paid numeric;
  v_done integer;
  v_storm integer;
  v_repairs numeric;
  v_travel numeric;
  v_share numeric;
begin
  if not exists (select 1 from public.roof_care_plans where id = p_plan) then
    raise exception 'That plan was not found';
  end if;
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void';
  -- The year's two inspections that are done, and the storm inspections that are: a storm
  -- inspection counts as an inspection done. Two at most.
  select count(*) filter (where v.kind in ('visit1', 'visit2')),
         count(*) filter (where v.kind = 'storm')
    into v_done, v_storm
    from public.roof_care_visits v
   where v.plan_id = p_plan and v.kind in ('visit1', 'visit2', 'storm')
     and exists (
       select 1 from public.service_jobs j
        where j.roof_care_visit_id = v.id and j.deleted_at is null
          and j.stage in ('done', 'authorized', 'invoiced', 'closed'));
  v_storm := least(v_storm, greatest(2 - v_done, 0));
  v_done := least(v_done + v_storm, 2);
  select coalesce(sum(-l.total), 0) into v_repairs
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-allowance:' || p_plan::text and i.status <> 'void';
  v_repairs := greatest(v_repairs, 0);
  -- The travel of the plan's leak calls that was not charged.
  select coalesce(sum(-l.total), 0) into v_travel
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-travel:' || p_plan::text and i.status <> 'void';
  v_travel := greatest(v_travel, 0);
  v_share := round(v_paid * (2 - v_done) / 2.0, 2);
  return jsonb_build_object(
    'paid', v_paid,
    'inspections_done', v_done,
    'storm_counted', v_storm,
    'share', v_share,
    'repairs', v_repairs,
    'travel', v_travel,
    'refund', greatest(v_share - v_repairs - v_travel, 0));
end;
$function$;

revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;

-- 3. Closing out an expired plan ---------------------------------------------------------------
alter table public.roof_care_plans
  add column if not exists closed_out_on date,
  add column if not exists closed_out_reason text,
  add column if not exists closed_out_by_name text;

comment on column public.roof_care_plans.closed_out_on is
  'An expired plan a manager closed out: it will not be renewed, and what was owed is dropped.';

create or replace function public.roof_care_close_out(p_plan uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_name text;
  v_n integer;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager closes out a Roof Care plan' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Type why it is closed out';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_plans
     set closed_out_on = v_today, closed_out_reason = trim(p_reason),
         closed_out_by_name = v_name, updated_at = now()
   where id = p_plan and status = 'ended' and ended_reason = 'Expired' and closed_out_on is null;
  if not found then
    raise exception 'Only an expired plan that is not closed out yet can be closed out';
  end if;
  if exists (select 1 from public.roof_care_plans r
              where r.renewed_from = p_plan and r.status = 'awaiting_payment') then
    raise exception 'This plan has a renewal waiting to be paid. Cancel the renewal first.';
  end if;
  -- What was still owed is dropped: not one that is done, or that somebody has started.
  with lost as (
    update public.roof_care_visits v
       set lost_on = v_today
     where v.plan_id = p_plan and v.lost_on is null
       and not exists (
         select 1 from public.service_jobs j
          where j.roof_care_visit_id = v.id and j.deleted_at is null
            and (j.stage not in ('open', 'scheduled')
                 or j.en_route_at is not null or j.on_site_at is not null
                 or j.completed_at is not null))
    returning v.id
  ), gone as (
    update public.service_jobs sj
       set deleted_at = now(), updated_by_name = v_name
     where sj.roof_care_visit_id in (select id from lost)
       and sj.deleted_at is null and sj.invoice_id is null
    returning sj.id
  ), said as (
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    select g.id, 'note',
           'Taken off the board: the Roof Care plan expired and was closed out. Reason: ' || trim(p_reason),
           v_name
      from gone g
    returning 1
  )
  select count(*) into v_n from lost;
  return v_n;
end;
$function$;

revoke all on function public.roof_care_close_out(uuid, text) from public, anon;
grant execute on function public.roof_care_close_out(uuid, text) to authenticated;
