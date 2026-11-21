-- Roof Care: the database itself refuses a sign-up that makes no sense (break test Nov 20,
-- number 25; owner, Nov 20: "go with ... 25").
--
-- The site's server checks everything before it asks the database, so none of this could be
-- reached from the screens. A signed-in person calling the database directly could still save:
--   - a drive that is "not a number" or "without end", or one of 500 hours, as a price;
--   - any text as the terms the customer agreed to;
--   - a plan with no way of paying;
--   - a plan at a price other than the one the customer was shown.
-- Now the database refuses each, in the words the screens use.
--
--   roof_care_price                  refuses a roof size or a drive that is not a real number,
--                                    a round trip over 24 hours or 2,000 miles, and a roof over
--                                    100,000,000 sq ft. (A custom quote is still answered for
--                                    a roof over the custom-quote size.)
--   roof_care_sign_up_await_payment  the same for the drive; the terms must be a terms version
--                                    ("2026-11-20.1"); check or card must be picked; and with
--                                    `p_shown_price` (the site's server sends it) the plan is
--                                    saved at the price shown or not at all. It also keeps the
--                                    plan's storm inspections (20261120820000).
--
-- The sign-up gains one argument, so the old one is dropped first: two functions of one name
-- would leave the data API unable to choose.

create or replace function public.roof_care_price(
  p_sqft numeric, p_hours numeric default null, p_miles numeric default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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
  -- A signed-in person is answered only with Service or Customers access. The scheduled runs
  -- and the site's own server key are not held to this.
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_access('service') or public.has_access('customers'))
  then
    raise exception 'Only someone with Service or Customers access reads the Roof Care prices'
      using errcode = '42501';
  end if;
  -- A size or a drive that is not a real number, or one no building of ours can have, is
  -- refused in words before anything is worked out from it (Nov 20): "not a number" and
  -- "without end" pass every smaller-than check, and came out as a price.
  if p_sqft is not null and (p_sqft = 'NaN'::numeric or p_sqft > 100000000) then
    raise exception 'The roof size is not a number that can be priced. Type the roof''s size in square feet.'
      using errcode = '22023';
  end if;
  if (p_hours is not null and (p_hours = 'NaN'::numeric or p_hours > 24))
     or (p_miles is not null and (p_miles = 'NaN'::numeric or p_miles > 2000))
  then
    raise exception 'The drive to this property did not come out as a real round trip (at most 24 hours and 2,000 miles), so there is no price. Ask an admin to check where the property is on the map.'
      using errcode = '22023';
  end if;
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
  v_per_trip := round(
    greatest(0, coalesce(p_hours, v_bh) - v_bh) * v_crew * v_size
    + greatest(0, coalesce(p_miles, v_bm) - v_bm) * v_mile, 2);
  foreach k in array array['watch', 'care', 'guard'] loop
    v_base := (d->'plans'->k->>'base')::numeric;
    v_per := (d->'plans'->k->>'per_sqft')::numeric;
    v_trips := 2 + case when k = 'guard' then v_leaks + v_storms else 0 end;
    v_list := v_base + v_per * greatest(p_sqft, coalesce((d->>'min_price_sqft')::numeric, 0));
    v_travel := v_per_trip * v_trips;
    v_price := round(v_list + v_travel);
    v_first := ceil(v_price / 2);
    v_plans := v_plans || jsonb_build_object(
      'plan', k, 'list', round(v_list), 'travel', v_price - round(v_list), 'price', v_price,
      'visit1', v_first, 'visit2', v_price - v_first, 'trips', v_trips);
  end loop;
  return jsonb_build_object(
    'ready', true, 'custom_quote', false,
    'baseline_hours', v_bh, 'baseline_miles', v_bm,
    'beyond_baseline', v_per_trip > 0,
    'plans', v_plans);
end;
$function$;

revoke all on function public.roof_care_price(numeric, numeric, numeric) from public, anon;
grant execute on function public.roof_care_price(numeric, numeric, numeric) to authenticated;

drop function if exists public.roof_care_sign_up_await_payment(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text, boolean);

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

notify pgrst, 'reload schema';
