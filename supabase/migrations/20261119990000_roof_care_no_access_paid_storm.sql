-- Roof Care: a visit we could not do because we could not get on the roof, and a storm inspection
-- beyond the one the plan includes (owner, Nov 19: "10. Go." and "11. Second inspection billed at
-- inspection price and their repair allocation contributes to the price if they have any left").
--
--   1. roof_care_no_access: one row for each time the crew arrived for one of the plan's
--      inspections and could not get on the roof. Written by roof_care_no_access() only. The
--      first one in a plan year is free; each one after that is charged the return trip, at the
--      travel rates a service invoice uses (the Service rates page) for the plan's own drive.
--      The charge goes on that inspection's invoice as its own line, once.
--   2. roof_care_add_storm(): the storm inspections the plan includes stay free. A further one in
--      the same plan year is billed at the price of one inspection (half of Roof Watch for that
--      roof and drive, as the renewal credit is), and only after the screen has said so.
--      What is left of the plan's minor repairs goes toward it first, on its invoice, through
--      the allowance line every repair invoice uses.
--   3. The refund sum counts a storm inspection as an inspection done only when it was one the
--      plan included: one the customer paid for is not taken off their refund.
--   4. invoice_lines_care_rule(): a return trip is billed once.

-- 1. A visit we could not do --------------------------------------------------------------------
create table if not exists public.roof_care_no_access (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.roof_care_plans (id) on delete cascade,
  visit_id uuid not null references public.roof_care_visits (id) on delete cascade,
  job_id uuid references public.service_jobs (id) on delete set null,
  on_date date not null,
  note text not null,
  -- The return trip is charged: every one after the free ones of the plan year.
  charged boolean not null default false,
  -- What it is charged. Null for a free one, and for a charged one that could not be worked out.
  amount numeric,
  -- Kept by name if the person is later removed.
  by_user uuid references public.profiles (id) on delete set null,
  by_name text not null default '',
  at timestamptz not null default now()
);

create index if not exists roof_care_no_access_plan on public.roof_care_no_access (plan_id);
create index if not exists roof_care_no_access_visit on public.roof_care_no_access (visit_id);

alter table public.roof_care_no_access enable row level security;

-- Read by the office, and by the person who recorded it. No write policy: the functions.
drop policy if exists roof_care_no_access_read on public.roof_care_no_access;
create policy roof_care_no_access_read on public.roof_care_no_access
  for select to authenticated
  using (
    by_user = (select auth.uid())
    or (not (select public.is_technician())
        and ((select public.has_access('service')) or (select public.has_access('customers'))))
  );

revoke all on public.roof_care_no_access from anon, authenticated;
grant select on public.roof_care_no_access to authenticated;

-- The return trip of a plan, worked as travel is on a service invoice: the hours on the road
-- there and back, at the standard travel rate of the technician and of each helper of the crew.
-- Null when it cannot be worked out (a rate is blank, or the plan has no drive): never zero.
create or replace function public.roof_care_trip_charge(p_plan uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  d jsonb;
  v_hours numeric;
  v_size numeric;
  v_tech numeric;
  v_helper numeric;
begin
  select s.data into d from public.roof_care_settings s where s.id = 1;
  -- The plan's own drive; one priced on the baseline drive is charged that drive.
  select coalesce(p.drive_hours, nullif(d->>'baseline_drive_hours', '')::numeric) into v_hours
    from public.roof_care_plans p where p.id = p_plan;
  v_size := greatest(coalesce(nullif(d->>'crew_size', '')::numeric, 1), 1);
  select r.bill_rate into v_tech from public.service_rates r
   where r.rate_kind = 'standard' and r.role = 'tech' and r.time_kind = 'travel';
  select r.bill_rate into v_helper from public.service_rates r
   where r.rate_kind = 'standard' and r.role = 'helper' and r.time_kind = 'travel';
  if coalesce(v_hours, 0) <= 0 or coalesce(v_tech, 0) <= 0
     or (v_size > 1 and coalesce(v_helper, 0) <= 0) then
    return null;
  end if;
  return round(v_hours * (v_tech + (v_size - 1) * coalesce(v_helper, 0)), 2);
end;
$function$;

revoke all on function public.roof_care_trip_charge(uuid) from public, anon, authenticated;

-- Where a ticket stands: whose inspection it is, how many times this plan year we could not get
-- on the roof, and whether the next one is charged. Refuses anyone who may not work the ticket.
create or replace function public.roof_care_no_access_state(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  -- How many times in a plan year the return trip is free (owner, Nov 19; the agreement's term
  -- 7 says "the first"). 0 here charges every one.
  c_free constant integer := 1;
  j record;
  v_count integer;
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
  select count(*) into v_count from public.roof_care_no_access n where n.plan_id = j.plan_id;
  v_charged := v_count >= c_free;
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

revoke all on function public.roof_care_no_access_state(uuid) from public, anon, authenticated;

-- What the screen says before No access is pressed. The amount is the office's to read.
create or replace function public.roof_care_no_access_preview(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  s jsonb := public.roof_care_no_access_state(p_job);
  v_known boolean := (s->>'amount') is not null;
begin
  if public.is_technician() then
    s := s || jsonb_build_object('amount', null);
  end if;
  return s || jsonb_build_object('amount_known', v_known);
end;
$function$;

revoke all on function public.roof_care_no_access_preview(uuid) from public, anon;
grant execute on function public.roof_care_no_access_preview(uuid) to authenticated;

-- The crew arrived and could not get on the roof. Kept with what happened; the inspection is
-- marked as kept off by the customer, so a renewal treats it as theirs and not ours.
create or replace function public.roof_care_no_access(p_job uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_plan uuid;
  s jsonb;
  v_known boolean;
  v_name text;
  v_id uuid;
begin
  if v_note is null then
    raise exception 'Type what happened';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep what happened under 500 characters';
  end if;
  -- One at a time for a plan, so two presses are counted in turn.
  select vi.plan_id into v_plan
    from public.service_jobs sj
    join public.roof_care_visits vi on vi.id = sj.roof_care_visit_id
   where sj.id = p_job;
  perform 1 from public.roof_care_plans p where p.id = v_plan for update;
  s := public.roof_care_no_access_state(p_job);
  if exists (select 1 from public.roof_care_no_access n
              where n.job_id = p_job and n.on_date = v_today) then
    raise exception 'No access is already recorded on this ticket today';
  end if;
  v_known := (s->>'amount') is not null;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  insert into public.roof_care_no_access
    (plan_id, visit_id, job_id, on_date, note, charged, amount, by_user, by_name)
  values ((s->>'plan_id')::uuid, (s->>'visit_id')::uuid, p_job, v_today, v_note,
          (s->>'charged')::boolean, (s->>'amount')::numeric, auth.uid(), coalesce(v_name, ''))
  returning id into v_id;
  update public.roof_care_visits set customer_asked = true where id = (s->>'visit_id')::uuid;
  insert into public.service_job_events (service_job_id, kind, note, by_name)
  values (p_job, 'note',
          'No access: we could not get on the roof. ' || rtrim(v_note, '. ') || '.'
            || case when (s->>'charged')::boolean
                 then ' The return trip is charged.'
                 else ' The return trip is at no charge.' end,
          coalesce(v_name, ''));
  if public.is_technician() then
    s := s || jsonb_build_object('amount', null);
  end if;
  return s || jsonb_build_object('id', v_id, 'amount_known', v_known);
end;
$function$;

revoke all on function public.roof_care_no_access(uuid, text) from public, anon;
grant execute on function public.roof_care_no_access(uuid, text) to authenticated;

-- A manager takes one off: it was recorded by mistake, or its charge is let go. Not while its
-- charge is on an invoice.
create or replace function public.roof_care_no_access_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_other text;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager takes a no access record off' using errcode = '42501';
  end if;
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
end;
$function$;

revoke all on function public.roof_care_no_access_remove(uuid) from public, anon;
grant execute on function public.roof_care_no_access_remove(uuid) to authenticated;

-- 2. A storm inspection beyond the ones the plan includes --------------------------------------
-- Where a plan stands: is the next storm inspection one it includes, or a billed one, and what
-- the billed one costs after what is left of the minor repairs.
create or replace function public.roof_care_storm_state(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_allowed integer;
  v_included integer;
  v_billed integer;
  v_price jsonb;
  v_watch numeric;
  v_one numeric;
  v_used numeric;
  v_left numeric;
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
  if v_included < coalesce(v_allowed, 0) then
    return jsonb_build_object(
      'billed', false, 'included', coalesce(v_allowed, 0), 'used', v_included,
      'billed_so_far', v_billed);
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
    'customer_pays', greatest(v_one - v_left, 0));
end;
$function$;

revoke all on function public.roof_care_storm_state(uuid) from public, anon, authenticated;

-- What the screen says before Storm inspection is pressed. The office's.
create or replace function public.roof_care_storm_offer(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office adds a storm inspection' using errcode = '42501';
  end if;
  return public.roof_care_storm_state(p_plan);
end;
$function$;

revoke all on function public.roof_care_storm_offer(uuid) from public, anon;
grant execute on function public.roof_care_storm_offer(uuid) to authenticated;

-- The office adds one. A billed one only with p_billed_ok, which the screen sends after it has
-- said that this one is billed and what it costs.
drop function if exists public.roof_care_add_storm(uuid);
create or replace function public.roof_care_add_storm(p_plan uuid, p_billed_ok boolean default false)
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
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office adds a storm inspection' using errcode = '42501';
  end if;
  perform 1 from public.roof_care_plans p where p.id = p_plan for update;
  s := public.roof_care_storm_state(p_plan);
  if (s->>'billed')::boolean then
    if not coalesce(p_billed_ok, false) then
      raise exception 'This plan''s storm inspections for the year are used. A further one is billed at the price of one inspection. Open the plan and confirm it there.';
    end if;
    v_amount := (s->>'price')::numeric;
    if v_amount is null or v_amount <= 0 then
      raise exception 'The price of one inspection could not be worked out for this roof. Ask an admin.';
    end if;
  end if;
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (p_plan, 'storm', v_today, v_today + 14, v_today + 14, v_amount)
  returning id into v_visit;
  perform public.roof_care_make_tickets(p_plan);
  select sj.id into v_job from public.service_jobs sj
   where sj.roof_care_visit_id = v_visit and sj.deleted_at is null limit 1;
  return v_job;
end;
$function$;

revoke all on function public.roof_care_add_storm(uuid, boolean) from public, anon;
grant execute on function public.roof_care_add_storm(uuid, boolean) to authenticated;

-- 3. The refund: a storm inspection the customer paid for is not an inspection of the plan -------
create or replace function public.roof_care_refund_worked(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_paid numeric;
  v_done integer;
  v_storm integer;
  v_repairs numeric;
  v_travel numeric;
  v_share numeric;
  v_before numeric;
  v_card boolean;
  v_pct numeric;
  v_flat numeric;
  v_fee numeric := 0;
begin
  select * into p from public.roof_care_plans where id = p_plan;
  if not found then
    raise exception 'That plan was not found';
  end if;
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void';
  -- A card payment taken online before its invoice was marked paid.
  if v_paid = 0 and p.card_paid_amount is not null then
    v_paid := p.card_paid_amount;
  end if;
  -- The year's two inspections that are done, and the storm inspections the plan included that
  -- are: such a storm inspection counts as an inspection done. Two at most. A further storm
  -- inspection was billed by itself (amount above 0) and is not counted.
  select count(*) filter (where v.kind in ('visit1', 'visit2')),
         count(*) filter (where v.kind = 'storm' and v.amount = 0)
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
  v_before := greatest(v_share - v_repairs - v_travel, 0);
  -- Paid by card: online, or an invoice marked paid by card, or said at the sign-up with no
  -- invoice saying otherwise. The card company keeps its fee on what is sent back.
  v_card := p.card_paid_on is not null
    or exists (select 1 from public.invoices i
                where i.roof_care_plan_id = p_plan and i.status <> 'void'
                  and lower(coalesce(i.paid_method, '')) like '%card%')
    or (p.pay_method = 'card'
        and not exists (select 1 from public.invoices i
                         where i.roof_care_plan_id = p_plan and i.status <> 'void'
                           and coalesce(trim(i.paid_method), '') <> ''));
  if v_card and v_before > 0 then
    select greatest(coalesce(nullif(s.data->>'card_fee_pct', '')::numeric, 0), 0),
           greatest(coalesce(nullif(s.data->>'card_fee_flat', '')::numeric, 0), 0)
      into v_pct, v_flat
      from public.roof_care_settings s
     order by s.updated_at desc nulls last limit 1;
    v_fee := least(v_before, round(v_before * coalesce(v_pct, 0) / 100.0 + coalesce(v_flat, 0), 2));
  end if;
  return jsonb_build_object(
    'paid', v_paid,
    'inspections_done', v_done,
    'storm_counted', v_storm,
    'share', v_share,
    'repairs', v_repairs,
    'travel', v_travel,
    'card_fee', v_fee,
    'refund', v_before - v_fee);
end;
$function$;

revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;

-- 4. A plan's lines on invoices: the return trip joins the three that were there ---------------
create or replace function public.invoice_lines_care_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_other text;
  v_plan uuid;
  v_allow numeric;
  v_used numeric;
  v_calls integer;
  v_n integer;
begin
  if new.source is null or new.source not like 'roof-care%' then
    return new;
  end if;
  if new.source like 'roof-care:%' then
    select coalesce(i.display_number, '') into v_other
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and l.invoice_id <> new.invoice_id and i.status <> 'void'
     limit 1;
    if found then
      raise exception 'This inspection''s share of the plan is already on invoice #%. It is billed once.', v_other;
    end if;
    return new;
  end if;
  -- The return trip after a visit we could not do: on one invoice, and never taking money off.
  if new.source like 'roof-care-trip:%' then
    select coalesce(i.display_number, '') into v_other
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and l.invoice_id <> new.invoice_id and i.status <> 'void'
     limit 1;
    if found then
      raise exception 'This return trip is already on invoice #%. It is billed once.', v_other;
    end if;
    if new.total < 0 then
      raise exception 'A return trip line charges the trip. It cannot take money off.';
    end if;
    return new;
  end if;
  if new.source like 'roof-care-allowance:%' then
    begin
      v_plan := substring(new.source from 21)::uuid;
    exception when others then
      raise exception 'This allowance line does not name a Roof Care plan';
    end;
    select p.repair_allowance into v_allow
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this allowance line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A plan allowance line takes money off the invoice. It cannot add to it.';
    end if;
    select coalesce(sum(-l.total), 0) into v_used
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and i.status <> 'void' and l.id is distinct from new.id;
    if v_used - new.total > v_allow + 0.005 then
      raise exception 'Only $% of this plan''s minor repairs allowance is left.',
        trim(to_char(greatest(v_allow - v_used, 0), '999,999,990.00'));
    end if;
  end if;
  -- A leak call with no travel charge: no more invoices carry the line than the plan has calls.
  if new.source like 'roof-care-travel:%' then
    begin
      v_plan := substring(new.source from 18)::uuid;
    exception when others then
      raise exception 'This leak call line does not name a Roof Care plan';
    end;
    select p.free_travel_calls into v_calls
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this leak call line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A leak call line takes the travel off the invoice. It cannot add to it.';
    end if;
    select count(distinct l.invoice_id) into v_n
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and i.status <> 'void' and l.invoice_id <> new.invoice_id;
    if v_n >= coalesce(v_calls, 0) then
      raise exception 'This plan''s leak calls with no travel charge are used: % of %.',
        v_n, coalesce(v_calls, 0);
    end if;
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
