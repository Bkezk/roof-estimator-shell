-- Roof Care: the plan is paid for the year before it starts (owner, Nov 19: "i think we are going
-- to do payment up front rather than at time of service … so we dont have to fight apathy", and
-- "they can pay up front by check").
--
-- Until now a plan was active the moment it was signed, and each inspection billed half the
-- yearly price. Now:
--
--   1. Sign-up makes the plan "awaiting payment". No inspections yet.
--   2. One invoice for the year belongs to the plan itself (invoices.roof_care_plan_id), numbered
--      RC-<plan number>. The office sends it.
--   3. The day that invoice is marked paid in full, the plan starts: the plan year runs from the
--      payment, the two inspections are dated from the day it is recorded, and their tickets are
--      made as before. An inspection of such a plan bills nothing.
--
-- A plan signed the old way (roof_care_sign_up, still called by a page published before this)
-- keeps working as it did: active at once, half billed at each inspection.

-- 1. The plan --------------------------------------------------------------------------------
alter table public.roof_care_plans
  drop constraint if exists roof_care_plans_status_check;
alter table public.roof_care_plans
  add constraint roof_care_plans_status_check
  check (status in ('awaiting_payment', 'active', 'ended'));

alter table public.roof_care_plans
  add column if not exists pay_first boolean not null default false,
  add column if not exists plan_number integer,
  add column if not exists first_days integer,
  add column if not exists paid_on date,
  add column if not exists starts_on date;

comment on column public.roof_care_plans.pay_first is
  'Paid for the year before it starts. False: an older plan, billed half at each inspection.';
comment on column public.roof_care_plans.first_days is
  'With first_visit ''days'': how many days after the payment the first inspection is.';
comment on column public.roof_care_plans.starts_on is
  'The first day of the plan year: the day the payment was received.';

create sequence if not exists public.roof_care_plan_number_seq start 1001;
create unique index if not exists roof_care_plans_number_key
  on public.roof_care_plans (plan_number) where plan_number is not null;

-- One plan in force or waiting to be paid for a property.
drop index if exists public.roof_care_plans_one_active;
create unique index if not exists roof_care_plans_one_live
  on public.roof_care_plans (site_id) where status in ('active', 'awaiting_payment');

-- The older sign-up says its own words when the property has a plan waiting to be paid.
do $mig$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_sign_up';
  if d is null or position('status in (''active'', ''awaiting_payment'')' in d) > 0 then
    return;
  end if;
  if position('where site_id = p_site and status = ''active'')' in d) = 0 then
    raise exception 'roof_care_sign_up is not as this change expects';
  end if;
  execute replace(d,
    'where site_id = p_site and status = ''active'')',
    'where site_id = p_site and status in (''active'', ''awaiting_payment''))');
end $mig$;

-- 2. The plan's invoice ------------------------------------------------------------------------
alter table public.invoices
  add column if not exists roof_care_plan_id uuid
    references public.roof_care_plans (id) on delete cascade;

alter table public.invoices
  drop constraint if exists invoices_one_parent;
alter table public.invoices
  add constraint invoices_one_parent
  check (num_nonnulls(service_job_id, bid_id, roof_care_plan_id) = 1);

create index if not exists invoices_roof_care_plan_idx
  on public.invoices (roof_care_plan_id) where roof_care_plan_id is not null;
-- A plan year is billed once: one invoice of it that is not void.
create unique index if not exists invoices_one_live_per_plan
  on public.invoices (roof_care_plan_id)
  where roof_care_plan_id is not null and status <> 'void';

-- 3. The sign-up ---------------------------------------------------------------------------------
create or replace function public.roof_care_sign_up_await_payment(
  p_site uuid, p_plan text, p_sqft numeric, p_hours numeric, p_miles numeric,
  p_estimated boolean, p_first text, p_days integer, p_agreed_by text, p_notes text, p_terms text)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_site public.crm_sites%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_plan uuid;
  v_name text;
  v_allowance numeric;
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
  if exists (select 1 from public.roof_care_plans
              where site_id = p_site and status = 'active') then
    raise exception 'This property already has a Roof Care plan';
  end if;
  if exists (select 1 from public.roof_care_plans
              where site_id = p_site and status = 'awaiting_payment') then
    raise exception 'This property already has a Roof Care plan waiting to be paid';
  end if;
  if coalesce(trim(p_agreed_by), '') = '' then
    raise exception 'Type the name of the person who agreed to the plan';
  end if;
  if coalesce(trim(p_terms), '') = '' then
    raise exception 'The customer has to agree to the plan''s terms';
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

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  select coalesce(nullif(s.data->'plans'->p_plan->>'allowance', '')::numeric, 0) into v_allowance
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  -- renews_on is a placeholder until the payment: the plan year starts on that day.
  insert into public.roof_care_plans (
    account_id, site_id, plan, status, pay_first, plan_number, signed_on, renews_on,
    roof_sqft, drive_hours, drive_miles, price_estimated, list_price, travel_price, price,
    first_visit, first_days, agreed_by, sold_by, sold_by_name, notes, terms_version,
    repair_allowance)
  values (
    v_site.account_id, p_site, p_plan, 'awaiting_payment', true,
    nextval('public.roof_care_plan_number_seq')::integer, v_today,
    (v_today + interval '1 year')::date,
    p_sqft, p_hours, p_miles, coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, case when p_first = 'days' then p_days end, trim(p_agreed_by),
    auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''), trim(p_terms),
    greatest(coalesce(v_allowance, 0), 0))
  returning id into v_plan;
  return v_plan;
end;
$function$;

revoke all on function public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) from public, anon;
grant execute on function public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) to authenticated;

-- 4. The payment starts the plan -----------------------------------------------------------------
-- Not called by people: the invoice's own rule below calls it.
create or replace function public.roof_care_start(p_plan uuid, p_paid date)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_p public.roof_care_plans%rowtype;
  v_start date;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
begin
  select * into v_p from public.roof_care_plans where id = p_plan for update;
  if not found or v_p.status <> 'awaiting_payment' then
    return;
  end if;
  -- The plan year starts the day the payment was received, never a day still to come. The
  -- inspections are dated from the day it is recorded, so none starts out already late.
  v_start := least(coalesce(p_paid, v_today), v_today);
  if v_p.first_visit = 'now' then
    v_from := v_today; v_by := v_today;
  elsif v_p.first_visit = 'days' then
    v_from := v_today + coalesce(v_p.first_days, 1); v_by := v_from;
  else
    select w.w_from, w.w_to into v_from, v_by
      from public.roof_care_windows(v_today) w
     where w.w_from > v_today
     order by w.w_from limit 1;
  end if;
  v_renews := (v_start + interval '1 year')::date;
  -- The second inspection, by the sign-up's own rule (20261119200000).
  select x.f, x.t into v2_from, v2_by
    from (select greatest(w.w_from, v_from + 120) as f, w.w_to as t
            from public.roof_care_windows(v_from + 120) w) x
   where x.t - x.f >= 13
   order by x.f limit 1;
  if v2_from <= v_renews then
    v2_by := least(v2_by, greatest(v_renews, v2_from + 13));
  end if;
  v_renews := greatest(v_renews, v2_by);

  update public.roof_care_plans
     set status = 'active', paid_on = v_start, starts_on = v_start, renews_on = v_renews,
         updated_at = now()
   where id = p_plan;
  -- Paid for already: an inspection of this plan bills nothing.
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (p_plan, 'visit1', v_from, v_by, v_by, 0),
         (p_plan, 'visit2', v2_from, v2_by, v2_by, 0);
  perform public.roof_care_make_tickets(p_plan);
end;
$function$;

revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;

create or replace function public.invoices_plan_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.roof_care_plan_id is not null and new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid')
  then
    perform public.roof_care_start(new.roof_care_plan_id, new.paid_on);
  end if;
  return null;
end;
$function$;

drop trigger if exists invoices_plan_paid on public.invoices;
create trigger invoices_plan_paid
  after insert or update of status on public.invoices
  for each row execute function public.invoices_plan_paid();

-- 5. Ending a plan that was never paid ------------------------------------------------------------
-- A manager ends a plan that is waiting to be paid as one in force. Its unpaid invoice goes with
-- it: a draft is removed, a final one with nothing paid on it is voided. An invoice with money
-- on it is left for the office.
create or replace function public.roof_care_end(p_plan uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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
   where id = p_plan and status in ('active', 'awaiting_payment');
  if not found then
    raise exception 'That plan was not found, or it has already ended';
  end if;
  delete from public.invoices
   where roof_care_plan_id = p_plan and status = 'draft';
  update public.invoices
     set status = 'void', updated_by_name = v_name
   where roof_care_plan_id = p_plan and status = 'final' and coalesce(paid_amount, 0) = 0;
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
$function$;
