-- Roof Care: a first inspection cannot be pushed so far that the second falls after the plan
-- ends (break test Nov 20, number 14; owner, Nov 20: "go with ... 14").
--
-- The second inspection is at least four months after the first, in an inspection window with
-- two weeks left. With "first inspection in 250 days" it landed after the plan's last day: its
-- ticket was never made and the customer never got it.
--
--   roof_care_second_fits(first, last)   would the second inspection of a plan whose first is on
--                                        `first` start on or before the plan's last day `last`?
--   roof_care_max_first_days(day)        the largest number of days that still fits, for a plan
--                                        signed and paid on `day`: the words of the refusal.
--   roof_care_sign_up_await_payment      refuses a number of days that does not fit, and says
--                                        the largest that does.
--   roof_care_start                      the days are counted from the payment, which can come
--                                        after the signing. If the number no longer fits then,
--                                        the payment is not refused: the first inspection is
--                                        brought forward to the last day that fits, and the
--                                        plan keeps that number.
--
-- "Today" and "in the inspection window" always fit, and so does a renewal (it is always "in
-- the inspection window"): the windows are never more than five months apart.

create or replace function public.roof_care_second_fits(p_first date, p_last date)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select x.f <= p_last
      from (select greatest(w.w_from, p_first + 120) as f, w.w_to as t
              from public.roof_care_windows(p_first + 120) w) x
     where x.t - x.f >= 13
     order by x.f
     limit 1), false);
$function$;

create or replace function public.roof_care_max_first_days(p_day date)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(max(n), 0)::integer
    from generate_series(1, 365) n
   where public.roof_care_second_fits(p_day + n, (p_day + interval '1 year')::date);
$function$;

revoke all on function public.roof_care_second_fits(date, date) from public, anon, authenticated;
revoke all on function public.roof_care_max_first_days(date) from public, anon, authenticated;
grant execute on function public.roof_care_second_fits(date, date) to service_role;
grant execute on function public.roof_care_max_first_days(date) to service_role;

create or replace function public.roof_care_sign_up_await_payment(
  p_site uuid, p_plan text, p_sqft numeric, p_hours numeric, p_miles numeric,
  p_estimated boolean, p_first text, p_days integer, p_agreed_by text, p_notes text,
  p_terms text, p_pay_method text default null, p_pay_note text default null,
  p_size_ok boolean default false, p_shown_price numeric default null)
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
  v_calls integer;
  v_storms integer;
  v_map numeric;
  v_boss boolean;
  v_confirmed boolean := false;
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
  -- The terms are kept by their version ("2026-11-20.1", and "2026-11-18" for the first):
  -- the agreement is written from it. Anything else could not be turned back into what the
  -- customer agreed to.
  if trim(p_terms) !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$' then
    raise exception 'The plan''s terms could not be read, so nothing was signed. Reload the page and sign the plan up again.';
  end if;
  if p_first is null or p_first not in ('now', 'days', 'window') then
    raise exception 'Pick when the first inspection is';
  end if;
  if p_first = 'days' and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'Type how many days to push the first inspection back (1 to 365)';
  end if;
  -- The second inspection is four months after the first, in an inspection window. Pushed too
  -- far, it would fall after the plan's last day and never be done (Nov 20).
  if p_first = 'days'
     and not public.roof_care_second_fits(v_today + p_days, (v_today + interval '1 year')::date)
  then
    raise exception 'The second inspection would fall after the plan ends. Choose % days or fewer, or pick the inspection window.',
      public.roof_care_max_first_days(v_today);
  end if;
  -- A plan is paid for the year before it starts: how is asked at the sign-up.
  if p_pay_method is null or p_pay_method not in ('check', 'card') then
    raise exception 'Pick how they are paying: by check or by card';
  end if;
  if p_sqft is null or p_sqft <= 0 then
    raise exception 'Type the roof''s size in square feet: a number above 0';
  end if;
  if p_hours is null or p_miles is null then
    raise exception 'The drive to this address has not been worked out, so there is no price yet';
  end if;
  if p_hours < 0 or p_miles < 0 then
    raise exception 'The drive to this property came out below zero, which cannot be right. Ask an admin to check where the property is on the map.';
  end if;
  if p_hours = 'NaN'::numeric or p_miles = 'NaN'::numeric or p_hours > 24 or p_miles > 2000 then
    raise exception 'The drive to this property did not come out as a real round trip (at most 24 hours and 2,000 miles), so there is no price. Ask an admin to check where the property is on the map.';
  end if;
  if p_sqft = 'NaN'::numeric or p_sqft > 100000000 then
    raise exception 'Type the roof''s size in square feet: a number above 0';
  end if;
  -- The typed size against the map's. An outline under 500 sq ft is a shed, not the roof.
  v_map := case when v_site.map_roof_sqft >= 500 then v_site.map_roof_sqft end;
  if v_map is not null and p_sqft < v_map * 0.8 then
    v_boss := public.is_admin() or public.is_manager();
    if not v_boss then
      raise exception 'The map shows about % sq ft of roof at this property, and % sq ft was typed: more than 20%% smaller. Check the size and type the whole roof. If the typed size is right, a manager or an admin signs this plan up: they can confirm it.',
        trim(to_char(round(v_map, -2), '999,999,999,990')), trim(to_char(p_sqft, '999,999,999,990'));
    end if;
    if not coalesce(p_size_ok, false) then
      raise exception 'The map shows about % sq ft of roof at this property, and % sq ft was typed: more than 20%% smaller. Tick "The typed size is right" to sign the plan up at the typed size. Your name is kept with it.',
        trim(to_char(round(v_map, -2), '999,999,999,990')), trim(to_char(p_sqft, '999,999,999,990'));
    end if;
    v_confirmed := true;
  end if;
  v_price := public.roof_care_price(p_sqft, p_hours, p_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote. Call the office.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p_plan;
  -- The plan is saved at the price the customer was shown, or not at all. The price is always
  -- the one worked out here; `p_shown_price` is what the screen showed.
  if p_shown_price is not null and round(p_shown_price) <> round((v_row->>'price')::numeric) then
    raise exception 'The price changed: this plan is now $%, not the $% shown. The prices have been read again. Check them with the customer and press again.',
      trim(to_char(round((v_row->>'price')::numeric), '999,999,990')),
      trim(to_char(round(p_shown_price), '999,999,990'));
  end if;

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  select coalesce(nullif(s.data->'plans'->p_plan->>'allowance', '')::numeric, 0),
         case when p_plan = 'guard'
              then least(greatest(round(coalesce(
                     nullif(s.data->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 24)
              else 0 end,
         case when p_plan = 'guard'
              then least(greatest(round(coalesce(
                     nullif(s.data->>'guard_storm_inspections', '')::numeric, 0))::integer, 0), 24)
              else 0 end
    into v_allowance, v_calls, v_storms
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  insert into public.roof_care_plans (
    account_id, site_id, plan, status, pay_first, plan_number, signed_on, renews_on,
    roof_sqft, drive_hours, drive_miles, price_estimated, list_price, travel_price, price,
    first_visit, first_days, agreed_by, sold_by, sold_by_name, notes, terms_version,
    repair_allowance, free_travel_calls, storm_included, pay_method, pay_note,
    size_map_sqft, size_unchecked, size_confirmed_on, size_confirmed_by_name)
  values (
    v_site.account_id, p_site, p_plan, 'awaiting_payment', true,
    nextval('public.roof_care_plan_number_seq')::integer, v_today,
    (v_today + interval '1 year')::date,
    p_sqft, p_hours, p_miles, coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, case when p_first = 'days' then p_days end, trim(p_agreed_by),
    auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''), trim(p_terms),
    greatest(coalesce(v_allowance, 0), 0), coalesce(v_calls, 0), coalesce(v_storms, 0),
    p_pay_method, nullif(trim(coalesce(p_pay_note, '')), ''),
    v_map, v_map is null,
    case when v_confirmed then v_today end,
    case when v_confirmed then coalesce(v_name, '') end)
  returning id into v_plan;
  return v_plan;
end;
$function$;

revoke all on function public.roof_care_sign_up_await_payment(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text, boolean, numeric) from public, anon;
grant execute on function public.roof_care_sign_up_await_payment(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text, boolean, numeric) to authenticated, service_role;

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
  v_day date;
  v_days integer;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
begin
  select * into v_p from public.roof_care_plans where id = p_plan for update;
  if not found or v_p.status <> 'awaiting_payment' then
    return;
  end if;
  -- The plan year starts the day the payment was received: never a day still to come, and
  -- never before the day the plan was signed. The inspections are dated from the day it is
  -- recorded, so none starts out already late.
  v_paid := greatest(least(coalesce(p_paid, v_today), v_today), coalesce(v_p.signed_on, v_today));
  v_start := v_paid;
  if v_p.renewed_from is not null then
    select * into v_old from public.roof_care_plans where id = v_p.renewed_from for update;
    v_renewal := found and (v_old.status = 'active'
                            or (v_old.status = 'ended' and v_old.ended_reason = 'Expired'));
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
       set status = 'ended', ended_on = coalesce(ended_on, v_today), ended_reason = 'Renewed',
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
           'Taken off the board: the plan was renewed with this inspection not done'
             || case when coalesce(v_p.renewal_credit, 0) > 0
                     then ', and the renewal was reduced for it.' else '.' end,
           'Roof Care plans'
      from gone g;
  end if;

  if v_p.first_visit = 'now' then
    v_from := v_today; v_by := v_today;
  elsif v_p.first_visit = 'days' then
    -- The sign-up refuses a number of days whose second inspection would fall after the plan's
    -- last day. The days are counted from the payment, which can come later than the signing,
    -- so the same number can stop fitting. The payment is not refused for that: the first
    -- inspection is brought forward to the last day that still leaves room for the second.
    v_days := least(greatest(coalesce(v_p.first_days, 1), 1), 365);
    while v_days > 1
          and not public.roof_care_second_fits(v_today + v_days, (v_start + interval '1 year')::date)
    loop
      v_days := v_days - 1;
    end loop;
    v_from := v_today + v_days; v_by := v_from;
  else
    -- The window open that day when two weeks of it are left, else the next one to open.
    v_day := greatest(v_today, v_start);
    select greatest(w.w_from, v_day), w.w_to into v_from, v_by
      from public.roof_care_windows(v_day) w
     where w.w_from > v_day or w.w_to - v_day >= 13
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
  -- The plan year is twelve months and no longer: it does not stretch to an inspection.

  update public.roof_care_plans
     set status = 'active', paid_on = v_paid, starts_on = v_start, renews_on = v_renews,
         first_days = case when first_visit = 'days' then v_days else first_days end,
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
grant execute on function public.roof_care_start(uuid, date) to service_role;

notify pgrst, 'reload schema';
