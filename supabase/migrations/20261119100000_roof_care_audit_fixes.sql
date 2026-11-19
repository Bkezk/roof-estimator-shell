-- Roof Care: the fixes the owner asked for after the Nov 18 audit (his numbers 2, 5 and 11).
--
--  11. "X plus Y for the drive" always adds up to the price. The list price and the drive's share
--      were each rounded to the dollar on their own, so the two could be a dollar off the price.
--      The drive's share is now the price less the list price.
--   2. One live ticket for an inspection, and no more. A deleted care plan ticket is made again by
--      the morning check; restoring the deleted one then left two, and each billed its half. A
--      unique index holds the rule, a restore is refused in words, and the morning check steps
--      over an inspection another run has just ticketed.
--   5. Ending a plan takes its untouched inspection tickets off the board.

-- ── 11 and the morning check: two small changes to functions that stay otherwise as they are ──
do $mig$
declare
  d text;
begin
  select pg_get_functiondef('public.roof_care_price(numeric, numeric, numeric)'::regprocedure) into d;
  if position($a$'travel', round(v_travel)$a$ in d) > 0 then
    execute replace(d, $a$'travel', round(v_travel)$a$, $a$'travel', v_price - round(v_list)$a$);
  elsif position($a$'travel', v_price - round(v_list)$a$ in d) = 0 then
    raise exception 'roof_care_price is not as this change expects';
  end if;

  select pg_get_functiondef('public.roof_care_make_tickets(uuid)'::regprocedure) into d;
  if position('on conflict do nothing' in d) = 0 then
    if position(E'     where s.id = r.site_id\n    returning id into v_job;' in d) = 0 then
      raise exception 'roof_care_make_tickets is not as this change expects';
    end if;
    execute replace(d,
      E'     where s.id = r.site_id\n    returning id into v_job;',
      E'     where s.id = r.site_id\n    on conflict do nothing\n    returning id into v_job;');
  end if;
end $mig$;

-- ── 2. One live ticket for an inspection ────────────────────────────────────────────────────
create unique index if not exists service_jobs_one_per_care_visit
  on public.service_jobs (roof_care_visit_id)
  where roof_care_visit_id is not null and deleted_at is null;

create or replace function public.service_jobs_care_plan_rule()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_by date;
  v_other integer;
  v_person boolean := auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role';
begin
  if v_person
     and coalesce(current_setting('jbk.care_link', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.roof_care_visit_id is not null)
          or (tg_op = 'UPDATE' and new.roof_care_visit_id is distinct from old.roof_care_visit_id))
  then
    raise exception 'A care plan inspection is linked to its plan by the site' using errcode = '42501';
  end if;
  -- A deleted ticket is not brought back beside the one made in its place.
  if tg_op = 'UPDATE' and new.roof_care_visit_id is not null
     and old.deleted_at is not null and new.deleted_at is null
  then
    select j.number into v_other from public.service_jobs j
     where j.roof_care_visit_id = new.roof_care_visit_id and j.deleted_at is null and j.id <> new.id
     limit 1;
    if v_other is not null then
      raise exception 'This care plan inspection already has ticket #%. This one stays deleted.', v_other;
    end if;
  end if;
  if new.roof_care_visit_id is not null and new.scheduled_date is not null
     and (tg_op = 'INSERT' or new.scheduled_date is distinct from old.scheduled_date)
  then
    select due_by into v_by from public.roof_care_visits where id = new.roof_care_visit_id;
    if v_by is not null and new.scheduled_date > v_by then
      raise exception 'This Roof Care plan inspection is due by %. To move it later, press Care Plan on the ticket and push it back.',
        to_char(v_by, 'Mon FMDD, YYYY');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.service_jobs_care_plan_rule() from public, anon, authenticated;

drop trigger if exists service_jobs_care_plan_rule on public.service_jobs;
create trigger service_jobs_care_plan_rule
  before insert or update of scheduled_date, roof_care_visit_id, deleted_at on public.service_jobs
  for each row execute function public.service_jobs_care_plan_rule();

-- ── 5. Ending a plan takes its untouched inspection tickets off the board ───────────────────
-- Untouched: Open or Scheduled, nobody on the way or on site, not done, no invoice. A ticket the
-- crew has started stays: the work was done and the office decides what to bill.
create or replace function public.roof_care_end(p_plan uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager ends a Roof Care plan' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Type why the plan is ending';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_plans
     set status = 'ended',
         ended_on = (now() at time zone 'America/New_York')::date,
         ended_reason = trim(p_reason),
         ended_by_name = v_name,
         updated_at = now()
   where id = p_plan and status = 'active';
  if not found then
    raise exception 'That plan was not found, or it has already ended';
  end if;
  with gone as (
    update public.service_jobs sj
       set deleted_at = now(), updated_by_name = v_name
     where sj.roof_care_visit_id in (select v.id from public.roof_care_visits v where v.plan_id = p_plan)
       and sj.deleted_at is null
       and sj.stage in ('open', 'scheduled')
       and sj.en_route_at is null and sj.on_site_at is null and sj.completed_at is null
       and sj.invoice_id is null
    returning sj.id
  )
  insert into public.service_job_events (service_job_id, kind, note, by_name)
  select g.id, 'note', 'Taken off the board: the Roof Care plan was ended. Reason: ' || trim(p_reason), v_name
    from gone g;
end;
$$;
revoke all on function public.roof_care_end(uuid, text) from public, anon;
grant execute on function public.roof_care_end(uuid, text) to authenticated;
