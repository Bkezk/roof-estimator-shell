-- Roof Care break test of Nov 20, fixes 22 and 28: who may run what.
--
-- 22. The old sign-up is switched off. roof_care_sign_up() started a plan at once with nothing
--     paid, and any signed-in person with a ticket at the property could still call it. No code
--     of the site calls it: sign-ups go through roof_care_sign_up_await_payment(), which waits
--     for the payment. The function is kept (older migrations name it); no signed-in person
--     can run it any more.
--
-- 28. roof_care_make_tickets() is for the morning run and for the plan functions that call it
--     themselves (roof_care_start, roof_care_add_storm). The site never calls it, so no
--     signed-in person runs it directly. roof_care_price() and roof_care_windows() answer only
--     a signed-in person who has Service or Customers access: a technician who can sign a
--     customer up still gets a price. The plan functions ask as the database and are not held
--     to this.

revoke all on function public.roof_care_sign_up(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.roof_care_sign_up(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text)
  to service_role;

revoke all on function public.roof_care_make_tickets(uuid) from public, anon, authenticated;
grant execute on function public.roof_care_make_tickets(uuid) to service_role;

create or replace function public.roof_care_windows(p_from date)
returns table (w_from date, w_to date)
language plpgsql
stable
set search_path = public
as $function$
begin
  -- Asked straight by a signed-in person: only one who works with service or customers. A plan
  -- function asks as the database.
  if current_user = 'authenticated'
     and not (public.has_access('service') or public.has_access('customers'))
  then
    raise exception 'Only someone with Service or Customers access reads the inspection windows'
      using errcode = '42501';
  end if;
  return query
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
end;
$function$;

revoke all on function public.roof_care_windows(date) from public, anon;
grant execute on function public.roof_care_windows(date) to authenticated, service_role;

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
grant execute on function public.roof_care_price(numeric, numeric, numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
