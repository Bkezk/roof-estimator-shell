-- Roof Care plans, step 2 (owner, Nov 18; docs/roof-care-plans.md): a property's plan, its
-- inspections, and the rules around them.
--
--   roof_care_plans    one row per property and plan year: which plan, the price agreed, who
--                      signed the customer up (the credit is that name), when it renews.
--   roof_care_visits   the inspections the plan promises: visit 1, visit 2, and a storm
--                      inspection when one is asked for. Each has the days it is due between and
--                      what it bills (half the yearly price; a storm inspection bills nothing).
--   service_jobs.roof_care_visit_id   the inspection ticket the site made for a visit.
--
-- Nobody writes these tables by hand. Every change goes through a function below, so the rules
-- hold whoever calls: the price is the database's own sum, a property has one plan at a time, a
-- push-back of more than 30 days needs a manager and a reason.
--
-- The price: roof_care_price() works it out from roof_care_settings, which only an admin reads.
-- It hands back prices and never a cost, so a technician signing a customer up on a roof sees
-- what the customer pays and nothing else. It is the same sum as src/lib/roof-care-price.ts
-- (list price = base + per square foot; each trip of the year adds the hours and miles over
-- what the list price covers).
--
-- Safe to run twice.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.roof_care_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id),
  site_id uuid not null references public.crm_sites(id),
  plan text not null check (plan in ('watch', 'care', 'guard')),
  status text not null default 'active' check (status in ('active', 'ended')),
  signed_on date not null,
  renews_on date not null,
  roof_sqft numeric not null check (roof_sqft > 0),
  drive_hours numeric not null check (drive_hours >= 0),
  drive_miles numeric not null check (drive_miles >= 0),
  -- The drive was worked out to the town and not the building, or the roof was not measured.
  price_estimated boolean not null default false,
  list_price numeric not null,
  travel_price numeric not null default 0,
  price numeric not null,
  first_visit text not null check (first_visit in ('now', 'days', 'window')),
  agreed_by text not null,
  sold_by uuid references public.profiles(id) on delete set null,
  sold_by_name text not null default '',
  referred_by text,
  notes text not null default '',
  ended_on date,
  ended_reason text,
  ended_by_name text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists roof_care_plans_one_active
  on public.roof_care_plans (site_id) where status = 'active';
create index if not exists roof_care_plans_account on public.roof_care_plans (account_id);

create table if not exists public.roof_care_visits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.roof_care_plans(id) on delete cascade,
  kind text not null check (kind in ('visit1', 'visit2', 'storm')),
  due_from date not null,
  due_by date not null,
  -- As first planned: a push-back is counted from here.
  first_due_by date not null,
  amount numeric not null default 0,
  push_reason text,
  pushed_at timestamptz,
  pushed_by_name text,
  created_at timestamptz not null default now(),
  check (due_by >= due_from)
);
create unique index if not exists roof_care_visits_one_each
  on public.roof_care_visits (plan_id, kind) where kind <> 'storm';
create index if not exists roof_care_visits_plan on public.roof_care_visits (plan_id);

alter table public.service_jobs
  add column if not exists roof_care_visit_id uuid references public.roof_care_visits(id) on delete set null;
create index if not exists service_jobs_roof_care_visit
  on public.service_jobs (roof_care_visit_id) where roof_care_visit_id is not null;

alter table public.roof_care_plans enable row level security;
alter table public.roof_care_visits enable row level security;
revoke all on public.roof_care_plans from anon, authenticated;
revoke all on public.roof_care_visits from anon, authenticated;
grant select on public.roof_care_plans to authenticated;
grant select on public.roof_care_visits to authenticated;
grant all on public.roof_care_plans to service_role;
grant all on public.roof_care_visits to service_role;

-- Read by whoever reads the property (as its warranties are). No write policy: the functions.
drop policy if exists roof_care_plans_read on public.roof_care_plans;
create policy roof_care_plans_read on public.roof_care_plans
  for select to authenticated
  using (
    (select public.has_access('customers'))
    or (select public.has_access('estimate'))
    or ((select public.has_access('service')) and not (select public.is_technician()))
    or public.tech_sees_site(site_id)
  );
drop policy if exists roof_care_visits_read on public.roof_care_visits;
create policy roof_care_visits_read on public.roof_care_visits
  for select to authenticated
  using (exists (select 1 from public.roof_care_plans p where p.id = plan_id));

-- Not in History (audit_row knows its tables by name and these are not among them): the plan
-- row itself says who signed it and who ended it, and a push-back keeps its reason and its name.

-- ── The price ───────────────────────────────────────────────────────────────────────────────
-- Prices only. {"ready": false} while a number the price needs is still blank.
create or replace function public.roof_care_price(
  p_sqft numeric,
  p_hours numeric default null,
  p_miles numeric default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d jsonb;
  v_crew numeric; v_size numeric; v_bh numeric; v_bm numeric; v_mile numeric;
  v_leaks numeric; v_storms numeric; v_custom numeric;
  v_per_trip numeric;
  v_plans jsonb := '[]'::jsonb;
  k text;
  v_base numeric; v_per numeric; v_trips numeric;
  v_list numeric; v_travel numeric; v_price numeric; v_first numeric;
begin
  select data into d from public.roof_care_settings where id = 1;
  v_crew := (d->>'crew_cost_per_hour')::numeric;
  v_size := (d->>'crew_size')::numeric;
  v_bh := (d->>'baseline_drive_hours')::numeric;
  v_bm := (d->>'baseline_miles')::numeric;
  v_mile := (d->>'vehicle_cost_per_mile')::numeric;
  v_leaks := (d->>'guard_leak_calls')::numeric;
  v_storms := (d->>'guard_storm_inspections')::numeric;
  v_custom := coalesce((d->>'custom_quote_over_sqft')::numeric, 0);
  if d is null or p_sqft is null or p_sqft <= 0
     or v_crew is null or v_size is null or v_size <= 0 or v_bh is null or v_bm is null
     or v_mile is null or v_leaks is null or v_storms is null
     or coalesce(p_hours, 0) < 0 or coalesce(p_miles, 0) < 0
  then
    return jsonb_build_object('ready', false);
  end if;
  foreach k in array array['watch', 'care', 'guard'] loop
    if (d->'plans'->k->>'base') is null or (d->'plans'->k->>'per_sqft') is null then
      return jsonb_build_object('ready', false);
    end if;
  end loop;
  if v_custom > 0 and p_sqft > v_custom then
    return jsonb_build_object(
      'ready', true, 'custom_quote', true, 'custom_quote_over_sqft', v_custom,
      'plans', '[]'::jsonb);
  end if;
  -- What one trip adds: the hours over what the list price covers, at the whole crew's pay, and
  -- the miles over it. Each on its own, and never less than nothing.
  v_per_trip := round(
    greatest(0, coalesce(p_hours, v_bh) - v_bh) * v_crew * v_size
    + greatest(0, coalesce(p_miles, v_bm) - v_bm) * v_mile, 2);
  foreach k in array array['watch', 'care', 'guard'] loop
    v_base := (d->'plans'->k->>'base')::numeric;
    v_per := (d->'plans'->k->>'per_sqft')::numeric;
    v_trips := 2 + case when k = 'guard' then v_leaks + v_storms else 0 end;
    v_list := v_base + v_per * p_sqft;
    v_travel := v_per_trip * v_trips;
    v_price := round(v_list + v_travel);
    v_first := ceil(v_price / 2);
    v_plans := v_plans || jsonb_build_object(
      'plan', k, 'list', round(v_list), 'travel', round(v_travel), 'price', v_price,
      'visit1', v_first, 'visit2', v_price - v_first, 'trips', v_trips);
  end loop;
  return jsonb_build_object(
    'ready', true, 'custom_quote', false,
    'baseline_hours', v_bh, 'baseline_miles', v_bm,
    'beyond_baseline', v_per_trip > 0,
    'plans', v_plans);
end;
$$;
revoke all on function public.roof_care_price(numeric, numeric, numeric) from public, anon;
grant execute on function public.roof_care_price(numeric, numeric, numeric) to authenticated, service_role;

-- ── The two windows ─────────────────────────────────────────────────────────────────────────
-- Mid March to mid May, and mid October to the end of December (owner, Nov 18). Every window
-- that has not ended before p_from, soonest first.
create or replace function public.roof_care_windows(p_from date)
returns table (w_from date, w_to date)
language sql immutable set search_path = public
as $$
  select w.f, w.t
    from (
      select make_date(y, 3, 15) as f, make_date(y, 5, 15) as t
        from generate_series(extract(year from p_from)::int, extract(year from p_from)::int + 2) y
      union all
      select make_date(y, 10, 15), make_date(y, 12, 31)
        from generate_series(extract(year from p_from)::int, extract(year from p_from)::int + 2) y
    ) w
   where w.t >= p_from
   order by w.f;
$$;

-- ── The tickets ─────────────────────────────────────────────────────────────────────────────
-- Makes the inspection ticket of every visit that is due within two weeks and has none. Run at
-- sign-up for that plan, and every morning for all of them. It makes a ticket once: a visit
-- with a live ticket is left alone. Returns the tickets it made.
create or replace function public.roof_care_make_tickets(p_plan uuid default null)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  r record;
  v_job uuid;
  v_tech uuid;
  v_date date;
  v_name text;
  v_words text;
begin
  perform set_config('jbk.care_link', 'on', true);
  for r in
    select v.id as visit_id, v.kind, v.due_from, v.due_by,
           p.plan, p.site_id, p.account_id, p.first_visit, p.signed_on, p.sold_by, p.sold_by_name
      from public.roof_care_visits v
      join public.roof_care_plans p on p.id = v.plan_id
     where p.status = 'active'
       and (p_plan is null or p.id = p_plan)
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
      else 'Care plan storm inspection (' || v_name || ')' end;
    -- A set day is on the ticket. A window is not: the office picks the day inside it.
    v_date := case when r.due_from = r.due_by then r.due_from end;
    -- "Do it now" by a technician is theirs.
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
  -- The link is this function's to set and nobody else's, in this transaction too.
  perform set_config('jbk.care_link', 'off', true);
end;
$$;
revoke all on function public.roof_care_make_tickets(uuid) from public, anon;
grant execute on function public.roof_care_make_tickets(uuid) to authenticated, service_role;

-- ── Sign-up ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.roof_care_sign_up(
  p_site uuid,
  p_plan text,
  p_sqft numeric,
  p_hours numeric,
  p_miles numeric,
  p_estimated boolean,
  p_first text,
  p_days integer,
  p_agreed_by text,
  p_notes text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_site public.crm_sites%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_plan uuid;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_site from public.crm_sites where id = p_site and deleted_at is null;
  if not found or v_site.account_id is null then
    raise exception 'That property was not found';
  end if;
  if not (public.has_access('customers')
          or (public.has_access('service')
              and (not public.is_technician() or public.tech_sees_site(p_site))))
  then
    raise exception 'You can sign up a property you have a ticket at' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('watch', 'care', 'guard') then
    raise exception 'Pick the plan';
  end if;
  if exists (select 1 from public.roof_care_plans where site_id = p_site and status = 'active') then
    raise exception 'This property already has a Roof Care plan';
  end if;
  if coalesce(trim(p_agreed_by), '') = '' then
    raise exception 'Type the name of the person who agreed to the plan';
  end if;
  if p_first is null or p_first not in ('now', 'days', 'window') then
    raise exception 'Pick when the first inspection is';
  end if;
  if p_first = 'days' and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'Type how many days to push the first inspection back (1 to 365)';
  end if;
  if p_hours is null or p_miles is null then
    raise exception 'The drive to this address has not been worked out, so there is no price yet';
  end if;
  v_price := public.roof_care_price(p_sqft, p_hours, p_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote. Call the office.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p_plan;

  -- The first inspection: today, in so many days, or in the next window to open.
  if p_first = 'now' then
    v_from := v_today; v_by := v_today;
  elsif p_first = 'days' then
    v_from := v_today + p_days; v_by := v_from;
  else
    select w.w_from, w.w_to into v_from, v_by
      from public.roof_care_windows(v_today) w
     where w.w_from > v_today
     order by w.w_from limit 1;
  end if;
  -- The second: the first window still open four months after the first, and inside the plan
  -- year when it fits. When it cannot fit, the plan year runs on to it.
  v_renews := (v_today + interval '1 year')::date;
  select greatest(w.w_from, v_from + 120), w.w_to into v2_from, v2_by
    from public.roof_care_windows(v_from + 120) w
   order by w.w_from limit 1;
  if v2_from <= v_renews then
    v2_by := least(v2_by, v_renews);
  else
    v_renews := v2_by;
  end if;

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  insert into public.roof_care_plans (
    account_id, site_id, plan, signed_on, renews_on, roof_sqft, drive_hours, drive_miles,
    price_estimated, list_price, travel_price, price, first_visit, agreed_by,
    sold_by, sold_by_name, notes)
  values (
    v_site.account_id, p_site, p_plan, v_today, v_renews, p_sqft, p_hours, p_miles,
    coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, trim(p_agreed_by), auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''))
  returning id into v_plan;
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (v_plan, 'visit1', v_from, v_by, v_by, (v_row->>'visit1')::numeric),
         (v_plan, 'visit2', v2_from, v2_by, v2_by, (v_row->>'visit2')::numeric);
  perform public.roof_care_make_tickets(v_plan);
  return v_plan;
end;
$$;
revoke all on function public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text) from public, anon;
grant execute on function public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text) to authenticated;

-- ── Push back ───────────────────────────────────────────────────────────────────────────────
-- The office pushes an inspection back by so many days; the plan's later inspection moves back
-- with it. More than 30 days past its first date, in all, needs a manager and a reason. When
-- the last inspection lands after the plan year, the renewal date moves with it.
-- Returns the ticket whose date should move with it: {"job_id", "date_from", "date_to"}.
create or replace function public.roof_care_push_back(p_visit uuid, p_days integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.roof_care_visits%rowtype;
  p public.roof_care_plans%rowtype;
  j record;
  v_new_by date;
  v_total integer;
  v_last date;
  v_name text;
  v_set_day boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office pushes a care plan inspection back' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Type how many days to push it back (1 to 365)';
  end if;
  select * into v from public.roof_care_visits where id = p_visit for update;
  if not found then
    raise exception 'That inspection was not found';
  end if;
  select * into p from public.roof_care_plans where id = v.plan_id for update;
  if p.status <> 'active' then
    raise exception 'This plan has ended';
  end if;
  select sj.id, sj.stage, sj.scheduled_date into j
    from public.service_jobs sj
   where sj.roof_care_visit_id = v.id and sj.deleted_at is null
   order by sj.created_at desc limit 1;
  if found and j.stage not in ('open', 'scheduled') then
    raise exception 'This inspection is already done';
  end if;
  v_new_by := v.due_by + p_days;
  v_total := v_new_by - v.first_due_by;
  if v_total > 30 then
    if not (public.is_admin() or public.is_manager()) then
      raise exception 'That puts this inspection % days past its first date. More than 30 days needs a manager.', v_total
        using errcode = '42501';
    end if;
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'Type the reason. This inspection would be % days past its first date.', v_total;
    end if;
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  v_set_day := v.due_from = v.due_by;
  update public.roof_care_visits
     set due_by = v_new_by,
         due_from = case when v_set_day then v_new_by else due_from end,
         push_reason = nullif(trim(coalesce(p_reason, '')), ''),
         pushed_at = now(),
         pushed_by_name = v_name
   where id = v.id;
  -- The later inspection of the plan moves back with it, unless it is already done.
  update public.roof_care_visits x
     set due_from = x.due_from + p_days,
         due_by = x.due_by + p_days,
         first_due_by = x.first_due_by + p_days
   where x.plan_id = v.plan_id and x.id <> v.id and x.kind <> 'storm' and v.kind <> 'storm'
     and x.due_from > v.due_from
     and not exists (
       select 1 from public.service_jobs j2
        where j2.roof_care_visit_id = x.id and j2.deleted_at is null
          and j2.stage not in ('open', 'scheduled'));
  select max(x.due_by) into v_last
    from public.roof_care_visits x where x.plan_id = p.id and x.kind <> 'storm';
  update public.roof_care_plans
     set renews_on = greatest(renews_on, v_last), updated_at = now()
   where id = p.id;
  if j.id is not null then
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    values (j.id, 'note',
            'Care plan inspection pushed back ' || p_days || case when p_days = 1 then ' day' else ' days' end
              || '. Now due by ' || to_char(v_new_by, 'Mon FMDD, YYYY') || '.'
              || case when coalesce(trim(p_reason), '') <> '' then ' Reason: ' || trim(p_reason) else '' end,
            v_name);
  end if;
  return jsonb_build_object(
    'job_id', j.id,
    'date_from', j.scheduled_date,
    'date_to', case when j.scheduled_date is not null then j.scheduled_date + p_days end,
    'due_by', v_new_by,
    'days_past_first', v_total);
end;
$$;
revoke all on function public.roof_care_push_back(uuid, integer, text) from public, anon;
grant execute on function public.roof_care_push_back(uuid, integer, text) to authenticated;

-- ── A storm inspection ──────────────────────────────────────────────────────────────────────
-- Roof Guard includes storm inspections, asked for after a storm. The office adds one; past the
-- number the plan includes it takes a manager.
create or replace function public.roof_care_add_storm(p_plan uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_allowed numeric;
  v_used integer;
  v_visit uuid;
  v_job uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office adds a storm inspection' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found or p.status <> 'active' then
    raise exception 'That plan was not found, or it has ended';
  end if;
  if p.plan <> 'guard' then
    raise exception 'Only Roof Guard includes a storm inspection';
  end if;
  select coalesce((data->>'guard_storm_inspections')::numeric, 0) into v_allowed
    from public.roof_care_settings where id = 1;
  select count(*) into v_used from public.roof_care_visits where plan_id = p.id and kind = 'storm';
  if v_used >= coalesce(v_allowed, 0) and not (public.is_admin() or public.is_manager()) then
    raise exception 'This plan''s storm inspections for the year are used. A manager can add another.'
      using errcode = '42501';
  end if;
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (p.id, 'storm', v_today, v_today + 14, v_today + 14, 0)
  returning id into v_visit;
  perform public.roof_care_make_tickets(p.id);
  select sj.id into v_job from public.service_jobs sj
   where sj.roof_care_visit_id = v_visit and sj.deleted_at is null limit 1;
  return v_job;
end;
$$;
revoke all on function public.roof_care_add_storm(uuid) from public, anon;
grant execute on function public.roof_care_add_storm(uuid) to authenticated;

-- ── Ending a plan ───────────────────────────────────────────────────────────────────────────
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
end;
$$;
revoke all on function public.roof_care_end(uuid, text) from public, anon;
grant execute on function public.roof_care_end(uuid, text) to authenticated;

-- ── The ticket's side ───────────────────────────────────────────────────────────────────────
-- The link from a ticket to its visit is the site's to set. And a care plan inspection is not
-- scheduled past the day it is due by: that is a push-back, which has its own rule.
create or replace function public.service_jobs_care_plan_rule()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_by date;
  v_person boolean := auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role';
begin
  if v_person
     and coalesce(current_setting('jbk.care_link', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.roof_care_visit_id is not null)
          or (tg_op = 'UPDATE' and new.roof_care_visit_id is distinct from old.roof_care_visit_id))
  then
    raise exception 'A care plan inspection is linked to its plan by the site' using errcode = '42501';
  end if;
  if new.roof_care_visit_id is not null and new.scheduled_date is not null
     and (tg_op = 'INSERT' or new.scheduled_date is distinct from old.scheduled_date)
  then
    select due_by into v_by from public.roof_care_visits where id = new.roof_care_visit_id;
    if v_by is not null and new.scheduled_date > v_by then
      raise exception 'This Roof Care plan inspection is due by %. To move it later, press Push back on the ticket''s Roof Care line.',
        to_char(v_by, 'Mon FMDD, YYYY');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists service_jobs_care_plan_rule on public.service_jobs;
create trigger service_jobs_care_plan_rule
  before insert or update of scheduled_date, roof_care_visit_id on public.service_jobs
  for each row execute function public.service_jobs_care_plan_rule();

-- A care plan inspection is billed as a matter of course (half the plan at each visit), so its
-- first invoice is the office's to start, not only a manager's. Every other inspection is as it
-- was (20261116150000).
create or replace function public.invoices_inspection_rule()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_type text;
  v_care uuid;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_admin()
     or public.is_manager()
  then
    return new;
  end if;
  if new.status = 'void' then
    return new;
  end if;
  -- An edit that neither moves the invoice to another ticket nor brings a void one back.
  if tg_op = 'UPDATE'
     and new.service_job_id is not distinct from old.service_job_id
     and old.status <> 'void'
  then
    return new;
  end if;
  select j.service_type, j.roof_care_visit_id into v_type, v_care
    from public.service_jobs j where j.id = new.service_job_id;
  if v_type = 'inspection' and v_care is null and not exists (
       select 1 from public.invoices i
        where i.service_job_id = new.service_job_id
          and i.status <> 'void'
          and i.id <> new.id)
  then
    raise exception 'Only a manager can bill an inspection' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── Every morning ───────────────────────────────────────────────────────────────────────────
-- 11:40 UTC is 6:40 or 7:40 in the morning Eastern, before the day's reminders at 8.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'roof-care-tickets';
    perform cron.schedule('roof-care-tickets', '40 11 * * *', 'select public.roof_care_make_tickets()');
  end if;
end $$;
