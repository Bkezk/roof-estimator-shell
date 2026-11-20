-- Roof Care: the "no access" records are worked again when one is taken off, and a storm
-- inspection is added once a day and can be taken off (break test Nov 20, numbers 8 and 7).
--
-- Number 8. Until now taking off the free record left the next one charged, and the one after
-- it charged too: the customer never got the free return trip the agreement's term 7 gives.
-- Now, when a record is taken off, the ones left for that plan year are worked again in date
-- order: the first is free, each one after it is charged at the plan's trip rate. One whose
-- charge is already on an invoice stays as billed, and the answer says so; the free one then
-- goes to the next record that is not billed. What the next visit would be is counted from the
-- free ones used, so one return trip a plan year is free whatever was taken off.
--
-- Number 7. Until now Storm inspection could be pressed three times in a day and made three,
-- two of them billed; one added by mistake could not be taken off, and its deleted ticket came
-- back each morning. Now a second one the same day has to be confirmed in the box, which says
-- who added the first and when; and a manager or an admin takes one off while its ticket is not
-- started and nothing of it is invoiced: the inspection and its ticket go, the plan's count
-- goes back, and the morning run has nothing to make again.

-- ── How many return trips a plan year are free ──────────────────────────────────────────────
-- One number, read by the count and by the re-working (owner, Nov 19; the agreement's term 7
-- says "the first"). 0 here charges every one.
create or replace function public.roof_care_no_access_free()
returns integer
language sql
immutable
set search_path = public
as $function$
  select 1;
$function$;

revoke all on function public.roof_care_no_access_free() from public, anon, authenticated;

-- As 20261119990000 left it, with one change: the next visit is charged once the free ones are
-- used, counted from the records that were free, not from how many records there are.
create or replace function public.roof_care_no_access_state(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  c_free constant integer := public.roof_care_no_access_free();
  j record;
  v_count integer;
  v_free_used integer;
  v_charged boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select sj.id, sj.stage, sj.site_id, sj.roof_care_visit_id as visit_id, vi.plan_id
    into j
    from public.service_jobs sj
    join public.roof_care_visits vi on vi.id = sj.roof_care_visit_id
   where sj.id = p_job and sj.deleted_at is null;
  if not found then
    raise exception 'That ticket is not a Roof Care plan inspection';
  end if;
  -- Whoever may work the ticket: the office, or a technician with a ticket at the property.
  if not (public.has_access('customers')
          or (public.has_access('service')
              and (not public.is_technician() or public.tech_sees_site(j.site_id))))
  then
    raise exception 'That inspection is not yours to record' using errcode = '42501';
  end if;
  if j.stage in ('done', 'authorized', 'invoiced', 'closed') then
    raise exception 'This inspection is already done';
  end if;
  select count(*), count(*) filter (where not coalesce(n.charged, false))
    into v_count, v_free_used
    from public.roof_care_no_access n where n.plan_id = j.plan_id;
  v_charged := v_free_used >= c_free;
  return jsonb_build_object(
    'plan_id', j.plan_id,
    'visit_id', j.visit_id,
    'site_id', j.site_id,
    'count', v_count,
    'free', c_free,
    'charged', v_charged,
    'amount', case when v_charged then public.roof_care_trip_charge(j.plan_id) end);
end;
$function$;

-- ── Work a plan year's records again, in date order ─────────────────────────────────────────
-- Returns what changed and what stayed as billed:
--   changed      [{ id, on_date, charged }]  records that turned free or charged
--   kept_billed  [{ id, on_date, invoice }]  records that would be free now, and are on an
--                                            invoice: left as billed
create or replace function public.roof_care_no_access_rework(p_plan uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  c_free constant integer := public.roof_care_no_access_free();
  r record;
  v_free integer := 0;
  v_changed jsonb := '[]'::jsonb;
  v_kept jsonb := '[]'::jsonb;
begin
  for r in
    select n.id, n.on_date, n.job_id, coalesce(n.charged, false) as charged, n.amount,
           (select coalesce(i.display_number, '')
              from public.invoice_lines l
              join public.invoices i on i.id = l.invoice_id
             where l.source = 'roof-care-trip:' || n.id::text and i.status <> 'void'
             limit 1) as invoice
      from public.roof_care_no_access n
     where n.plan_id = p_plan
     order by n.at, n.id
  loop
    if r.invoice is not null then
      -- On an invoice: it stays as billed. Said when it stands where a free one would.
      if v_free < c_free then
        v_kept := v_kept || jsonb_build_object('id', r.id, 'on_date', r.on_date, 'invoice', r.invoice);
      end if;
      continue;
    end if;
    if v_free < c_free then
      v_free := v_free + 1;
      if r.charged then
        update public.roof_care_no_access set charged = false, amount = null where id = r.id;
        v_changed := v_changed || jsonb_build_object('id', r.id, 'on_date', r.on_date, 'charged', false);
        if r.job_id is not null then
          insert into public.service_job_events (service_job_id, kind, note, by_name)
          values (r.job_id, 'note',
                  'The return trip after the visit with no access on '
                    || to_char(r.on_date, 'Mon FMDD, YYYY')
                    || ' is now at no charge: an earlier no access record was taken off, so this is the first of the plan year.',
                  'Roof Care plans');
        end if;
      end if;
    elsif not r.charged then
      update public.roof_care_no_access
         set charged = true, amount = public.roof_care_trip_charge(p_plan)
       where id = r.id;
      v_changed := v_changed || jsonb_build_object('id', r.id, 'on_date', r.on_date, 'charged', true);
    end if;
  end loop;
  return jsonb_build_object('changed', v_changed, 'kept_billed', v_kept);
end;
$function$;

revoke all on function public.roof_care_no_access_rework(uuid) from public, anon, authenticated;

-- ── Take a record off, and work the rest again ──────────────────────────────────────────────
create or replace function public.roof_care_no_access_take_off(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_other text;
  v_plan uuid;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager takes a no access record off' using errcode = '42501';
  end if;
  select n.plan_id into v_plan from public.roof_care_no_access n where n.id = p_id;
  if not found then
    raise exception 'That record was not found';
  end if;
  -- One at a time for a plan, as recording one is.
  perform 1 from public.roof_care_plans p where p.id = v_plan for update;
  select coalesce(i.display_number, '') into v_other
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-trip:' || p_id::text and i.status <> 'void'
   limit 1;
  if found then
    raise exception 'Its return trip is on invoice #%. Take it off that invoice first.', v_other;
  end if;
  delete from public.roof_care_no_access where id = p_id;
  if not found then
    raise exception 'That record was not found';
  end if;
  return public.roof_care_no_access_rework(v_plan);
end;
$function$;

revoke all on function public.roof_care_no_access_take_off(uuid) from public, anon;
grant execute on function public.roof_care_no_access_take_off(uuid) to authenticated;

-- The older name, for a page published before this: the same thing, with no answer.
create or replace function public.roof_care_no_access_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.roof_care_no_access_take_off(p_id);
end;
$function$;

-- ── Storm inspection: where the plan stands, with one added today ───────────────────────────
-- As 20261119990000 left it, with `added_today`: who added a storm inspection to this plan
-- today and when, or null.
create or replace function public.roof_care_storm_state(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_allowed integer;
  v_included integer;
  v_billed integer;
  v_price jsonb;
  v_watch numeric;
  v_one numeric;
  v_used numeric;
  v_left numeric;
  v_added jsonb;
begin
  select * into p from public.roof_care_plans where id = p_plan;
  if not found or p.status <> 'active' then
    raise exception 'That plan was not found, or it has ended';
  end if;
  if p.plan <> 'guard' then
    raise exception 'Only Roof Guard includes a storm inspection';
  end if;
  select greatest(round(coalesce(nullif(s.data->>'guard_storm_inspections', '')::numeric, 0))::integer, 0)
    into v_allowed
    from public.roof_care_settings s where s.id = 1;
  select count(*) filter (where v.amount = 0), count(*) filter (where v.amount > 0)
    into v_included, v_billed
    from public.roof_care_visits v where v.plan_id = p.id and v.kind = 'storm';
  select jsonb_build_object('by_name', nullif(trim(coalesce(v.added_by_name, '')), ''),
                            'at', v.created_at)
    into v_added
    from public.roof_care_visits v
   where v.plan_id = p.id and v.kind = 'storm'
     and (v.created_at at time zone 'America/New_York')::date = v_today
   order by v.created_at desc
   limit 1;
  if v_included < coalesce(v_allowed, 0) then
    return jsonb_build_object(
      'billed', false, 'included', coalesce(v_allowed, 0), 'used', v_included,
      'billed_so_far', v_billed, 'added_today', v_added);
  end if;
  -- One inspection: half of Roof Watch (two inspections and nothing else) for this roof and drive.
  v_price := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);
  select (e->>'price')::numeric into v_watch
    from jsonb_array_elements(coalesce(v_price->'plans', '[]'::jsonb)) e
   where e->>'plan' = 'watch';
  v_one := round(v_watch / 2.0, 2);
  select coalesce(sum(-l.total), 0) into v_used
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-allowance:' || p.id::text and i.status <> 'void';
  v_left := greatest(coalesce(p.repair_allowance, 0) - greatest(v_used, 0), 0);
  return jsonb_build_object(
    'billed', true, 'included', coalesce(v_allowed, 0), 'used', v_included,
    'billed_so_far', v_billed,
    'price', v_one,
    'allowance_left', v_left,
    'plan_pays', least(v_left, v_one),
    'customer_pays', greatest(v_one - v_left, 0),
    'added_today', v_added);
end;
$function$;

-- ── Add one: a second the same day has to be confirmed ──────────────────────────────────────
-- One more argument than before (p_again_ok), so the older two-argument function goes: a page
-- published before this still calls it by its two names, and gets the new rule.
drop function if exists public.roof_care_add_storm(uuid, boolean);

create or replace function public.roof_care_add_storm(
  p_plan uuid, p_billed_ok boolean default false, p_again_ok boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  s jsonb;
  v_amount numeric := 0;
  v_visit uuid;
  v_job uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office adds a storm inspection' using errcode = '42501';
  end if;
  perform 1 from public.roof_care_plans p where p.id = p_plan for update;
  s := public.roof_care_storm_state(p_plan);
  if jsonb_typeof(s->'added_today') = 'object' and not coalesce(p_again_ok, false) then
    raise exception 'A storm inspection was already added to this plan today%. To add a second one the same day, open the plan, press Storm inspection and confirm it there.',
      coalesce(' by ' || nullif(s->'added_today'->>'by_name', ''), '')
        || ' at ' || trim(to_char((s->'added_today'->>'at')::timestamptz at time zone 'America/New_York', 'FMHH12:MI AM'));
  end if;
  if (s->>'billed')::boolean then
    if not coalesce(p_billed_ok, false) then
      raise exception 'This plan''s storm inspections for the year are used. A further one is billed at the price of one inspection. Open the plan and confirm it there.';
    end if;
    v_amount := (s->>'price')::numeric;
    if v_amount is null or v_amount <= 0 then
      raise exception 'The price of one inspection could not be worked out for this roof. Ask an admin.';
    end if;
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  insert into public.roof_care_visits
    (plan_id, kind, due_from, due_by, first_due_by, amount, added_by_name)
  values (p_plan, 'storm', v_today, v_today + 14, v_today + 14, v_amount, coalesce(v_name, ''))
  returning id into v_visit;
  perform public.roof_care_make_tickets(p_plan);
  select sj.id into v_job from public.service_jobs sj
   where sj.roof_care_visit_id = v_visit and sj.deleted_at is null limit 1;
  return v_job;
end;
$function$;

revoke all on function public.roof_care_add_storm(uuid, boolean, boolean) from public, anon;
grant execute on function public.roof_care_add_storm(uuid, boolean, boolean) to authenticated;

-- ── Take one off that was added by mistake ──────────────────────────────────────────────────
-- A manager's or an admin's, while its ticket is not started and nothing of it is invoiced.
-- The inspection and its ticket go; the plan's count goes back. When the one taken off was one
-- the plan includes and a billed one is still to do and on no invoice, that one becomes the
-- included one (`made_included`, with its ticket's number when it has one).
create or replace function public.roof_care_remove_storm(p_visit uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v record;
  j record;
  n record;
  v_name text;
  v_other text;
  v_promoted integer;
  v_made boolean := false;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin takes a storm inspection off' using errcode = '42501';
  end if;
  select vi.id, vi.kind, vi.amount, vi.plan_id, p.status into v
    from public.roof_care_visits vi
    join public.roof_care_plans p on p.id = vi.plan_id
   where vi.id = p_visit;
  if not found or v.kind <> 'storm' then
    raise exception 'That storm inspection was not found';
  end if;
  if v.status <> 'active' then
    raise exception 'Its plan is not in force';
  end if;
  -- One at a time for a plan, as adding one is.
  perform 1 from public.roof_care_plans p where p.id = v.plan_id for update;
  select sj.id, sj.number, sj.stage, sj.invoice_id,
         (sj.stage not in ('open', 'scheduled') or sj.en_route_at is not null
          or sj.on_site_at is not null or sj.completed_at is not null) as started
    into j
    from public.service_jobs sj
   where sj.roof_care_visit_id = p_visit and sj.deleted_at is null
   order by sj.created_at
   limit 1
     for update;
  if j.id is not null then
    if j.stage in ('done', 'authorized', 'invoiced', 'closed') then
      raise exception 'This storm inspection is already done (ticket #%). It is not taken off.', j.number;
    end if;
    if j.started then
      raise exception 'Ticket #% of this storm inspection is already started. It is not taken off.', j.number;
    end if;
    if j.invoice_id is not null then
      raise exception 'Ticket #% of this storm inspection has an invoice. Void or delete the invoice first.', j.number;
    end if;
  end if;
  select coalesce(i.display_number, '') into v_other
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care:' || p_visit::text and i.status <> 'void'
   limit 1;
  if found then
    raise exception 'This storm inspection is on invoice #%. Take it off that invoice first.', v_other;
  end if;
  if exists (select 1 from public.roof_care_no_access x where x.visit_id = p_visit) then
    raise exception 'A visit with no access is recorded on this storm inspection, so the crew went. It is not taken off.';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  if j.id is not null then
    perform set_config('jbk.care_ticket_off', 'on', true);
    update public.service_jobs
       set deleted_at = now(), updated_by_name = coalesce(v_name, '')
     where id = j.id;
    perform set_config('jbk.care_ticket_off', 'off', true);
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    values (j.id, 'note',
            'Taken off the board: this storm inspection was added by mistake and taken off the Roof Care plan.',
            coalesce(v_name, ''));
  end if;
  -- The inspection goes; its deleted ticket lets go of it (the link is the site's to change).
  perform set_config('jbk.care_link', 'on', true);
  delete from public.roof_care_visits where id = p_visit;
  perform set_config('jbk.care_link', 'off', true);
  -- An included one taken off: the next billed one still to do, on no invoice, is included now.
  if coalesce(v.amount, 0) = 0 then
    select x.id, sj.id as job_id, sj.number into n
      from public.roof_care_visits x
      left join public.service_jobs sj on sj.roof_care_visit_id = x.id and sj.deleted_at is null
     where x.plan_id = v.plan_id and x.kind = 'storm' and x.amount > 0
       and (sj.id is null or (sj.stage in ('open', 'scheduled') and sj.invoice_id is null))
       and not exists (
         select 1 from public.invoice_lines l
           join public.invoices i on i.id = l.invoice_id
          where l.source = 'roof-care:' || x.id::text and i.status <> 'void')
     order by x.created_at
     limit 1;
    if n.id is not null then
      update public.roof_care_visits set amount = 0 where id = n.id;
      v_made := true;
      v_promoted := n.number;
      if n.job_id is not null then
        insert into public.service_job_events (service_job_id, kind, note, by_name)
        values (n.job_id, 'note',
                'This storm inspection is now the one the Roof Care plan includes, so it is not billed: the earlier one was taken off.',
                coalesce(v_name, ''));
      end if;
    end if;
  end if;
  return jsonb_build_object('number', j.number, 'made_included', v_made,
                            'made_included_number', v_promoted);
end;
$function$;

revoke all on function public.roof_care_remove_storm(uuid) from public, anon;
grant execute on function public.roof_care_remove_storm(uuid) to authenticated;

notify pgrst, 'reload schema';
