-- Roof Care: renewal (owner, Nov 19: "go with the first 3 not built yet").
--
-- A plan is one plan year. Until now nothing started the next one. Now:
--
--   1. In the last 60 days of its year the office renews a plan. The renewal is the next year's
--      plan: priced again today from the roof size and the drive the plan was sold on, signed
--      and waiting for its payment, with its own invoice, as a new plan is.
--   2. An inspection still owed when the renewal is made is the office's call, with the
--      push-back reasons in front of it (owner, Nov 19):
--        "half_off": we did not get there. Half of the renewal is taken off for each one, and
--                    the inspection is dropped.
--        "full":     the customer kept us off the roof. The renewal is charged in full and the
--                    inspection stays owed until 60 days into the new year. Then it is lost.
--      Push back keeps a "the customer asked" mark so the office can tell the two apart.
--   3. The day the renewal's invoice is paid, the old year ends as "Renewed" and the new one
--      starts: on the old renewal date, or on the payment when that is later.

-- 1. The plan and its inspections --------------------------------------------------------------
alter table public.roof_care_plans
  add column if not exists renewed_from uuid references public.roof_care_plans (id) on delete set null,
  add column if not exists renewal_choice text,
  add column if not exists renewal_credit numeric not null default 0,
  add column if not exists renewal_owed integer not null default 0;

comment on column public.roof_care_plans.renewed_from is
  'The plan year this one renews. Null for a plan that was signed up new.';
comment on column public.roof_care_plans.renewal_choice is
  'With an inspection owed when the renewal was made: half_off (we did not get there) or full (the customer kept us off the roof; it stays owed 60 days into the new year).';
comment on column public.roof_care_plans.renewal_credit is
  'What is taken off the renewal for inspections we did not get to.';

alter table public.roof_care_plans
  drop constraint if exists roof_care_plans_renewal_choice_check;
alter table public.roof_care_plans
  add constraint roof_care_plans_renewal_choice_check
  check (renewal_choice is null or renewal_choice in ('half_off', 'full'));
alter table public.roof_care_plans
  drop constraint if exists roof_care_plans_renewal_credit_check;
alter table public.roof_care_plans
  add constraint roof_care_plans_renewal_credit_check
  check (renewal_credit >= 0 and renewal_credit <= price);

-- A property has one plan in force, and one waiting to be paid: a new sign-up, or the renewal
-- of the plan in force. The sign-up still refuses a property that has either.
drop index if exists public.roof_care_plans_one_live;
create unique index if not exists roof_care_plans_one_in_force
  on public.roof_care_plans (site_id) where status = 'active';
create unique index if not exists roof_care_plans_one_awaiting
  on public.roof_care_plans (site_id) where status = 'awaiting_payment';
-- A plan year is renewed once.
create unique index if not exists roof_care_plans_one_renewal
  on public.roof_care_plans (renewed_from) where renewed_from is not null and status <> 'ended';

alter table public.roof_care_visits
  add column if not exists customer_asked boolean not null default false,
  add column if not exists carried_from uuid references public.roof_care_plans (id) on delete set null,
  add column if not exists lost_on date;

comment on column public.roof_care_visits.customer_asked is
  'A push-back of this inspection was at the customer''s asking.';
comment on column public.roof_care_visits.carried_from is
  'The plan year this inspection was owed from, when it was carried into the renewal.';
comment on column public.roof_care_visits.lost_on is
  'A carried inspection not done in its 60 days: the day it was lost.';

alter table public.roof_care_visits
  drop constraint if exists roof_care_visits_kind_check;
alter table public.roof_care_visits
  add constraint roof_care_visits_kind_check
  check (kind in ('visit1', 'visit2', 'storm', 'carried'));

drop index if exists public.roof_care_visits_one_each;
create unique index if not exists roof_care_visits_one_each
  on public.roof_care_visits (plan_id, kind) where kind in ('visit1', 'visit2');

-- 2. Which inspections of a plan year are still owed -------------------------------------------
-- The two inspections of the year that are not done: no ticket at Done or further. Internal.
create or replace function public.roof_care_owed(p_plan uuid)
returns setof public.roof_care_visits
language sql
stable
security definer
set search_path = public
as $function$
  select v.*
    from public.roof_care_visits v
   where v.plan_id = p_plan and v.kind in ('visit1', 'visit2') and v.lost_on is null
     and not exists (
       select 1 from public.service_jobs j
        where j.roof_care_visit_id = v.id and j.deleted_at is null
          and j.stage in ('done', 'authorized', 'invoiced', 'closed'))
   order by v.kind;
$function$;

revoke all on function public.roof_care_owed(uuid) from public, anon, authenticated;

-- 3. Push back keeps "the customer asked" -------------------------------------------------------
-- The fourth argument has a default, so a page published before this still finds the function.
drop function if exists public.roof_care_push_back(uuid, integer, text);

create or replace function public.roof_care_push_back(
  p_visit uuid, p_days integer, p_reason text, p_customer boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.roof_care_visits%rowtype;
  p public.roof_care_plans%rowtype;
  j record;
  v_new_by date;
  v_total integer;
  v_last date;
  v_name text;
  v_set_day boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
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
  if v.kind = 'carried' then
    raise exception 'This inspection is owed from last plan year. It cannot be pushed past %.',
      to_char(v.due_by, 'Mon FMDD, YYYY');
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
    if v_reason is null then
      raise exception 'Type the reason. This inspection would be % days past its first date.', v_total;
    end if;
  end if;
  -- "The customer asked" is kept in the reason's own words too, so it reads on the plan.
  if coalesce(p_customer, false) then
    v_reason := 'The customer asked' || case when v_reason is null then '' else ': ' || v_reason end;
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  v_set_day := v.due_from = v.due_by;
  update public.roof_care_visits
     set due_by = v_new_by,
         due_from = case when v_set_day then v_new_by else due_from end,
         push_reason = case
           when v_reason is null then push_reason
           else concat_ws('; ', nullif(push_reason, ''),
                  to_char((now() at time zone 'America/New_York')::date, 'Mon FMDD') || ': '
                    || v_reason || case when v_name <> '' then ' (' || v_name || ')' else '' end)
         end,
         customer_asked = customer_asked or coalesce(p_customer, false),
         pushed_at = now(),
         pushed_by_name = v_name
   where id = v.id;
  update public.roof_care_visits x
     set due_from = x.due_from + p_days,
         due_by = x.due_by + p_days
   where x.plan_id = v.plan_id and x.id <> v.id
     and x.kind in ('visit1', 'visit2') and v.kind in ('visit1', 'visit2')
     and x.due_from > v.due_from
     and not exists (
       select 1 from public.service_jobs j2
        where j2.roof_care_visit_id = x.id and j2.deleted_at is null
          and j2.stage not in ('open', 'scheduled'));
  select max(x.due_by) into v_last
    from public.roof_care_visits x where x.plan_id = p.id and x.kind in ('visit1', 'visit2');
  update public.roof_care_plans
     set renews_on = greatest(renews_on, v_last), updated_at = now()
   where id = p.id;
  if j.id is not null then
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    values (j.id, 'note',
            'Care plan inspection pushed back ' || p_days || case when p_days = 1 then ' day' else ' days' end
              || '. Now due by ' || to_char(v_new_by, 'Mon FMDD, YYYY') || '.'
              || case when v_reason is not null then ' Reason: ' || v_reason else '' end,
            v_name);
  end if;
  return jsonb_build_object(
    'job_id', j.id,
    'date_from', j.scheduled_date,
    'date_to', case when j.scheduled_date is not null then j.scheduled_date + p_days end,
    'due_by', v_new_by,
    'days_past_first', v_total);
end;
$function$;

revoke all on function public.roof_care_push_back(uuid, integer, text, boolean) from public, anon;
grant execute on function public.roof_care_push_back(uuid, integer, text, boolean) to authenticated;

-- 4. What renewing a plan today would be --------------------------------------------------------
-- For the Renew box: the price today, the inspections still owed with their push-back reasons,
-- and which way the rule leans. The office's alone; it saves nothing.
create or replace function public.roof_care_renewal_offer(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_owed jsonb;
  v_n integer;
  v_asked boolean;
  v_amount numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office renews a Roof Care plan' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan;
  if not found or p.status <> 'active' then
    raise exception 'That plan was not found, or it is not in force';
  end if;
  v_price := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote. Call the office.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p.plan;
  v_amount := (v_row->>'price')::numeric;
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', o.kind, 'due_by', o.due_by, 'push_reason', o.push_reason,
           'customer_asked', o.customer_asked) order by o.kind), '[]'::jsonb),
         count(*), coalesce(bool_or(o.customer_asked), false)
    into v_owed, v_n, v_asked
    from public.roof_care_owed(p.id) o;
  return jsonb_build_object(
    'plan', p.plan,
    'renews_on', p.renews_on,
    'opens_on', p.renews_on - 60,
    'open', v_today >= p.renews_on - 60,
    'price', v_amount,
    'price_was', p.price,
    'owed', v_owed,
    'owed_count', v_n,
    -- Half off unless a push-back says the customer asked (owner, Nov 19).
    'default_choice', case when v_n = 0 then null when v_asked then 'full' else 'half_off' end,
    'credit_if_half_off', round(v_amount * least(v_n, 2) / 2.0, 2),
    'carried_until', greatest(p.renews_on, v_today) + 60,
    'pay_method', p.pay_method,
    'has_renewal', exists (
      select 1 from public.roof_care_plans r
       where r.renewed_from = p.id and r.status <> 'ended'));
end;
$function$;

revoke all on function public.roof_care_renewal_offer(uuid) from public, anon;
grant execute on function public.roof_care_renewal_offer(uuid) to authenticated;

-- 5. Renewing ------------------------------------------------------------------------------------
create or replace function public.roof_care_renew(
  p_plan uuid, p_choice text default null, p_pay_method text default null,
  p_pay_note text default null, p_shown_price numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_amount numeric;
  v_n integer;
  v_credit numeric := 0;
  v_allowance numeric;
  v_calls integer;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office renews a Roof Care plan' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found or p.status <> 'active' then
    raise exception 'That plan was not found, or it is not in force';
  end if;
  if v_today < p.renews_on - 60 then
    raise exception 'A plan is renewed in the last 60 days of its year. This one can be renewed from %.',
      to_char(p.renews_on - 60, 'Mon FMDD, YYYY');
  end if;
  if exists (select 1 from public.roof_care_plans r
              where r.renewed_from = p.id and r.status <> 'ended') then
    raise exception 'This plan already has a renewal';
  end if;
  if exists (select 1 from public.roof_care_plans r
              where r.site_id = p.site_id and r.status = 'awaiting_payment') then
    raise exception 'This property already has a Roof Care plan waiting to be paid';
  end if;
  if p_pay_method is not null and p_pay_method not in ('check', 'card') then
    raise exception 'Pick how they are paying: by check or by card';
  end if;
  v_price := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote. Call the office.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p.plan;
  v_amount := (v_row->>'price')::numeric;
  -- The renewal is saved at the price the box showed, or not at all.
  if p_shown_price is not null and round(p_shown_price) <> round(v_amount) then
    raise exception 'The price changed: this plan is now $%, not the $% shown. The prices have been read again. Check them with the customer and press again.',
      trim(to_char(round(v_amount), '999,999,990')), trim(to_char(round(p_shown_price), '999,999,990'));
  end if;
  select count(*) into v_n from public.roof_care_owed(p.id);
  if v_n > 0 then
    if p_choice is null or p_choice not in ('half_off', 'full') then
      raise exception 'Pick what happens with the inspection that is still owed';
    end if;
    if p_choice = 'half_off' then
      v_credit := round(v_amount * least(v_n, 2) / 2.0, 2);
    end if;
  end if;
  -- Both inspections not done and ours to make good: the year is at no charge. A manager's.
  if v_credit >= v_amount and not (public.is_admin() or public.is_manager()) then
    raise exception 'Neither inspection was done, so this renewal is at no charge. A manager makes it.'
      using errcode = '42501';
  end if;
  select coalesce(nullif(s.data->'plans'->p.plan->>'allowance', '')::numeric, 0),
         case when p.plan = 'guard'
              then least(greatest(round(coalesce(
                     nullif(s.data->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 24)
              else 0 end
    into v_allowance, v_calls
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  -- renews_on is a placeholder until the payment, as at a sign-up.
  insert into public.roof_care_plans (
    account_id, site_id, plan, status, pay_first, plan_number, signed_on, renews_on,
    roof_sqft, drive_hours, drive_miles, price_estimated, list_price, travel_price, price,
    first_visit, first_days, agreed_by, sold_by, sold_by_name, notes, terms_version,
    repair_allowance, free_travel_calls, pay_method, pay_note, referred_by,
    renewed_from, renewal_choice, renewal_credit, renewal_owed)
  values (
    p.account_id, p.site_id, p.plan, 'awaiting_payment', true,
    nextval('public.roof_care_plan_number_seq')::integer, v_today,
    (greatest(p.renews_on, v_today) + interval '1 year')::date,
    p.roof_sqft, p.drive_hours, p.drive_miles, p.price_estimated,
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, v_amount,
    'window', null, p.agreed_by, p.sold_by, p.sold_by_name, '', p.terms_version,
    greatest(coalesce(v_allowance, 0), 0), coalesce(v_calls, 0),
    coalesce(p_pay_method, p.pay_method), nullif(trim(coalesce(p_pay_note, '')), ''),
    p.referred_by,
    p.id, case when v_n > 0 then p_choice end, v_credit, v_n)
  returning id into v_new;
  -- Nothing to pay: the new year starts by itself, with no invoice.
  if v_credit >= v_amount then
    perform public.roof_care_start(v_new, v_today);
  end if;
  return v_new;
end;
$function$;

revoke all on function public.roof_care_renew(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.roof_care_renew(uuid, text, text, text, numeric) to authenticated;

-- 6. The payment starts the plan; for a renewal it also closes the old year --------------------
create or replace function public.roof_care_start(p_plan uuid, p_paid date)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_p public.roof_care_plans%rowtype;
  v_old public.roof_care_plans%rowtype;
  v_renewal boolean := false;
  v_paid date;
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
  v_paid := least(coalesce(p_paid, v_today), v_today);
  v_start := v_paid;
  if v_p.renewed_from is not null then
    select * into v_old from public.roof_care_plans where id = v_p.renewed_from for update;
    v_renewal := found and v_old.status = 'active';
  end if;
  if v_renewal then
    -- A renewal paid ahead starts when the old year is over; paid late, on the payment.
    v_start := greatest(v_paid, v_old.renews_on);
    if v_p.renewal_choice = 'full' then
      -- The customer kept us off the roof: the inspection comes along, owed for 60 more days.
      update public.roof_care_visits v
         set plan_id = p_plan, kind = 'carried', carried_from = v_old.id,
             due_from = least(v.due_from, v_start + 60), due_by = v_start + 60
       where v.id in (select o.id from public.roof_care_owed(v_old.id) o);
    end if;
    -- The old year is over. An inspection of it that was not carried is dropped: its ticket
    -- nobody had started is taken off the board. A storm inspection asked for stays.
    update public.roof_care_plans
       set status = 'ended', ended_on = v_today, ended_reason = 'Renewed',
           ended_by_name = 'Roof Care plans', updated_at = now()
     where id = v_old.id;
    with gone as (
      update public.service_jobs sj
         set deleted_at = now(), updated_by_name = 'Roof Care plans'
       where sj.roof_care_visit_id in (
               select v.id from public.roof_care_visits v
                where v.plan_id = v_old.id and v.kind in ('visit1', 'visit2'))
         and sj.deleted_at is null
         and sj.stage in ('open', 'scheduled')
         and sj.en_route_at is null and sj.on_site_at is null and sj.completed_at is null
         and sj.invoice_id is null
      returning sj.id
    )
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    select g.id, 'note',
           'Taken off the board: the plan was renewed with this inspection not done, and the renewal was reduced for it.',
           'Roof Care plans'
      from gone g;
  end if;

  if v_p.first_visit = 'now' then
    v_from := v_today; v_by := v_today;
  elsif v_p.first_visit = 'days' then
    v_from := v_today + coalesce(v_p.first_days, 1); v_by := v_from;
  else
    select w.w_from, w.w_to into v_from, v_by
      from public.roof_care_windows(greatest(v_today, v_start)) w
     where w.w_from > greatest(v_today, v_start)
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
     set status = 'active', paid_on = v_paid, starts_on = v_start, renews_on = v_renews,
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

-- 7. A plan with a renewal waiting is not ended from under it -----------------------------------
do $mig$
declare
  d text;
  v_at text := '  select coalesce(nullif(trim(pr.full_name), ''''), pr.email, '''') into v_name';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_end';
  if d is null or position('has a renewal waiting' in d) > 0 then
    return;
  end if;
  if position(v_at in d) = 0 then
    raise exception 'roof_care_end is not as this change expects';
  end if;
  execute replace(d, v_at,
    '  if exists (select 1 from public.roof_care_plans r
              where r.renewed_from = p_plan and r.status = ''awaiting_payment'') then
    raise exception ''This plan has a renewal waiting to be paid. End the renewal first.'';
  end if;
' || v_at);
end $mig$;

-- 8. The morning run: a carried inspection is lost after its 60 days ----------------------------
create or replace function public.roof_care_lapse_carried()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_n integer;
begin
  with lost as (
    update public.roof_care_visits v
       set lost_on = v_today
     where v.kind = 'carried' and v.lost_on is null and v.due_by < v_today
       -- Not one that is done, or that somebody has started.
       and not exists (
         select 1 from public.service_jobs j
          where j.roof_care_visit_id = v.id and j.deleted_at is null
            and (j.stage not in ('open', 'scheduled')
                 or j.en_route_at is not null or j.on_site_at is not null
                 or j.completed_at is not null))
    returning v.id
  ), gone as (
    update public.service_jobs sj
       set deleted_at = now(), updated_by_name = 'Roof Care plans'
     where sj.roof_care_visit_id in (select id from lost)
       and sj.deleted_at is null and sj.invoice_id is null
    returning sj.id
  ), said as (
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    select g.id, 'note',
           'Taken off the board: this inspection was owed from last plan year, and its 60 days are over.',
           'Roof Care plans'
      from gone g
    returning 1
  )
  select count(*) into v_n from lost;
  return v_n;
end;
$function$;

revoke all on function public.roof_care_lapse_carried() from public, anon, authenticated;

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
    perform public.roof_care_lapse_carried();
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
