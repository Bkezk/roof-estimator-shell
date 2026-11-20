-- Roof Care: "Skip this inspection", and a plan inspection's ticket is not deleted (break test
-- Nov 20, number 20).
--
-- Until now the only way to drop a plan's inspection was to delete its ticket, and the morning
-- run made the ticket again the next day. Now a manager or an admin skips the inspection, with
-- a reason:
--   * the inspection is marked as one we did not do (skipped_on, skip_reason, skipped_by_name),
--   * its ticket comes off the board, with a note in its Activity,
--   * the morning run does not make it again,
--   * it still counts as an inspection owed: roof_care_owed() counts every inspection with no
--     done ticket that is not lost, so a renewal credits or carries it, and a refund counts it
--     as not done (roof_care_refund_worked() counts done tickets only). Neither is changed.
-- An inspection carried into a renewed year gets its ticket again: the skip was last year's.
-- Putting the ticket back from Deleted undoes the skip.
--
-- Deleting the ticket of a plan's inspection any other way is refused, with words that point
-- to Skip. The site's own removals are let through: a plan that ended or was renewed or closed
-- out, an inspection that is lost or skipped, the storm inspection taken off, the morning run.

-- ── Skip ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.roof_care_skip_visit(p_visit uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v record;
  j record;
  v_name text;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin skips a Roof Care plan inspection'
      using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Type why this inspection is skipped';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters';
  end if;
  select vi.id, vi.kind, vi.lost_on, vi.skipped_on, p.status into v
    from public.roof_care_visits vi
    join public.roof_care_plans p on p.id = vi.plan_id
   where vi.id = p_visit
     for update of vi;
  if not found or v.status <> 'active' then
    raise exception 'That inspection was not found, or its plan is not in force';
  end if;
  if v.kind = 'storm' then
    raise exception 'A storm inspection is not skipped. Take it off the plan instead.';
  end if;
  if v.lost_on is not null then
    raise exception 'This inspection is already lost';
  end if;
  if v.skipped_on is not null then
    raise exception 'This inspection is already skipped';
  end if;
  select sj.id, sj.number, sj.stage, sj.invoice_id,
         (sj.stage not in ('open', 'scheduled') or sj.en_route_at is not null
          or sj.on_site_at is not null or sj.completed_at is not null) as started
    into j
    from public.service_jobs sj
   where sj.roof_care_visit_id = p_visit and sj.deleted_at is null
   order by sj.created_at
   limit 1
     for update;
  if found then
    if j.stage in ('done', 'authorized', 'invoiced', 'closed') then
      raise exception 'This inspection is already done (ticket #%)', j.number;
    end if;
    if j.started then
      raise exception 'Ticket #% of this inspection is already started. Finish it, or put it back to Open first.', j.number;
    end if;
    if j.invoice_id is not null then
      raise exception 'Ticket #% of this inspection has an invoice. Void or delete the invoice first.', j.number;
    end if;
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_visits
     set skipped_on = v_today, skip_reason = v_reason, skipped_by_name = coalesce(v_name, '')
   where id = p_visit;
  if j.id is not null then
    perform set_config('jbk.care_ticket_off', 'on', true);
    update public.service_jobs
       set deleted_at = now(), updated_by_name = coalesce(v_name, '')
     where id = j.id;
    perform set_config('jbk.care_ticket_off', 'off', true);
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    values (j.id, 'note',
            'Taken off the board: this Roof Care plan inspection was skipped. It still counts as an inspection owed to the customer. Reason: '
              || v_reason,
            coalesce(v_name, ''));
  end if;
  return jsonb_build_object('visit_id', p_visit, 'job_id', j.id, 'number', j.number);
end;
$function$;

revoke all on function public.roof_care_skip_visit(uuid, text) from public, anon;
grant execute on function public.roof_care_skip_visit(uuid, text) to authenticated;

-- ── An inspection carried into a renewed year is no longer skipped ──────────────────────────
-- roof_care_start() makes an owed inspection "carried" when a renewal charged in full is paid.
-- It then gets its ticket in the new year, so the old year's skip comes off it.
create or replace function public.roof_care_visits_carry_clears_skip()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.kind = 'carried' and old.kind is distinct from 'carried' then
    new.skipped_on := null;
    new.skip_reason := null;
    new.skipped_by_name := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.roof_care_visits_carry_clears_skip() from public, anon, authenticated;

drop trigger if exists roof_care_visits_carry_clears_skip on public.roof_care_visits;
create trigger roof_care_visits_carry_clears_skip
  before update of kind on public.roof_care_visits
  for each row execute function public.roof_care_visits_carry_clears_skip();

-- ── The morning run does not make a skipped inspection's ticket ─────────────────────────────
-- As 20261119990000 left it, with two changes: a skipped inspection is passed over, and the
-- carried inspections whose time is up are dropped as the site's own doing.
create or replace function public.roof_care_make_tickets(p_plan uuid default null)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  r record;
  v_job uuid;
  v_tech uuid;
  v_date date;
  v_name text;
  v_words text;
begin
  -- The morning run (no plan named) first drops the carried inspections whose time is up.
  if p_plan is null then
    perform public.roof_care_expire();
    perform set_config('jbk.care_ticket_off', 'on', true);
    perform public.roof_care_lapse_carried();
    perform set_config('jbk.care_ticket_off', 'off', true);
  end if;
  perform set_config('jbk.care_link', 'on', true);
  for r in
    select v.id as visit_id, v.kind, v.due_from, v.due_by,
           p.plan, p.site_id, p.account_id, p.first_visit, p.signed_on, p.sold_by, p.sold_by_name
      from public.roof_care_visits v
      join public.roof_care_plans p on p.id = v.plan_id
     where p.status = 'active'
       and (p_plan is null or p.id = p_plan)
       and v.lost_on is null
       and v.skipped_on is null
       and v.due_from - 14 <= v_today
       and not exists (
         select 1 from public.service_jobs j
          where j.roof_care_visit_id = v.id and j.deleted_at is null)
     order by v.due_from, v.kind
       for update of v
  loop
    v_name := case r.plan when 'watch' then 'Roof Watch' when 'care' then 'Roof Care' else 'Roof Guard' end;
    v_words := case r.kind
      when 'visit1' then 'Care plan inspection (' || v_name || '), visit 1 of 2'
      when 'visit2' then 'Care plan inspection (' || v_name || '), visit 2 of 2'
      when 'carried' then 'Care plan inspection (' || v_name || '), owed from last plan year'
      else 'Care plan storm inspection (' || v_name || ')' end;
    v_date := case when r.due_from = r.due_by then r.due_from end;
    v_tech := null;
    if r.kind = 'visit1' and r.first_visit = 'now' and r.due_from = r.signed_on then
      select pr.id into v_tech from public.profiles pr
       where pr.id = r.sold_by and coalesce(pr.technician, false);
    end if;
    insert into public.service_jobs (
      account_id, site_id, customer_name, site_name, site_address, site_city, site_state,
      description, service_type, scheduled_date, technician_id, stage, roof_care_visit_id,
      updated_by_name)
    select a.id, s.id, a.name, s.name,
           nullif(concat_ws(', ',
             nullif(concat_ws(', ', nullif(trim(s.address1), ''), nullif(trim(s.address2), '')), ''),
             nullif(concat_ws(', ', nullif(trim(s.city), ''),
               nullif(concat_ws(' ', nullif(trim(s.state), ''), nullif(trim(s.zip), '')), '')), '')), ''),
           s.city, s.state,
           v_words, 'inspection', v_date, v_tech,
           case when v_tech is not null and v_date is not null then 'scheduled' else 'open' end,
           r.visit_id,
           'Roof Care plans'
      from public.crm_sites s
      join public.crm_accounts a on a.id = r.account_id
     where s.id = r.site_id
    on conflict do nothing
    returning id into v_job;
    if v_job is null then
      continue;
    end if;
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    values (v_job, 'note',
            'Made by the site for this property''s ' || v_name || ' plan. '
              || case when r.due_from = r.due_by
                   then 'Due ' || to_char(r.due_by, 'Mon FMDD, YYYY') || '.'
                   else 'Due between ' || to_char(r.due_from, 'Mon FMDD') || ' and '
                        || to_char(r.due_by, 'Mon FMDD, YYYY') || '.' end,
            'Roof Care plans');
    return next v_job;
  end loop;
  perform set_config('jbk.care_link', 'off', true);
end;
$function$;

-- ── A plan inspection's ticket is not deleted by a person ───────────────────────────────────
-- A rule of its own on service_jobs (service_jobs_care_plan_rule, service_jobs_delete_guard and
-- service_jobs_care_ticket_stays are not touched). It looks at one thing: a live ticket of a
-- plan's inspection being deleted, the site's way (deleted_at is set) or outright.
create or replace function public.service_jobs_care_plan_delete_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v record;
  v_person boolean := auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role';
begin
  if tg_op = 'UPDATE' then
    if new.roof_care_visit_id is null then
      return new;
    end if;
    -- Put back from Deleted: an inspection that was skipped is no longer skipped.
    if old.deleted_at is not null and new.deleted_at is null then
      update public.roof_care_visits
         set skipped_on = null, skip_reason = null, skipped_by_name = null
       where id = new.roof_care_visit_id and skipped_on is not null;
      return new;
    end if;
    if not (old.deleted_at is null and new.deleted_at is not null) then
      return new;
    end if;
  elsif old.roof_care_visit_id is null or old.deleted_at is not null then
    return old;
  end if;
  -- The site's own doing, or nobody signed in (the morning run, the database's keeper).
  if not v_person or coalesce(current_setting('jbk.care_ticket_off', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select vi.kind, vi.lost_on, vi.skipped_on, p.status into v
    from public.roof_care_visits vi
    join public.roof_care_plans p on p.id = vi.plan_id
   where vi.id = old.roof_care_visit_id;
  -- Nothing would make it again: the plan is over, or the inspection is lost or skipped.
  if not found or v.status <> 'active' or v.lost_on is not null or v.skipped_on is not null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if v.kind = 'storm' then
    raise exception 'Ticket #% is a Roof Care plan storm inspection, so it is not deleted: the site would make it again. If it was added by mistake, open Care Plan at the property and press Take off beside the storm inspection (a manager or an admin).', old.number
      using errcode = '23514';
  end if;
  raise exception 'Ticket #% is a Roof Care plan inspection, so it is not deleted: the site would make it again. To drop it, open Care Plan at the property and press Skip this inspection (a manager or an admin). It then counts as an inspection still owed to the customer.', old.number
    using errcode = '23514';
end;
$function$;

revoke all on function public.service_jobs_care_plan_delete_rule() from public, anon, authenticated;

drop trigger if exists service_jobs_care_plan_delete_rule on public.service_jobs;
create trigger service_jobs_care_plan_delete_rule
  before delete or update of deleted_at on public.service_jobs
  for each row execute function public.service_jobs_care_plan_delete_rule();

notify pgrst, 'reload schema';
