-- A size range on the public price page shows each plan from its lowest price to its highest.
--
-- The owner, Nov 23, after his own try of /care: "how is the range of building size calculating
-- the price? thats a very different price based on what they decide and may give them much
-- smaller idea of what they will pay". A visitor who picked a size range and typed no size was
-- shown one price, worked on the middle of the range. He chose: show the range of prices, say
-- which size the prices are for, and ask for the exact size.
--
-- The site's server now sends the two ends of the picked range with the middle. Each plan keeps
-- its one price (the middle: the one a request is proved against and the opportunity's value)
-- and gains price_low and price_high. They are kept with the quote, so the office reads the
-- same two numbers on the request. Nothing else changes: a typed size or a roof found on the
-- map is one price as before, and a request is sent as before.

create or replace function public.public_care_quote(
  p_key text, p jsonb, p_hours numeric, p_miles numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_address text := btrim(coalesce(p->>'address', ''));
  v_city text := btrim(coalesce(p->>'city', ''));
  v_state text := btrim(coalesce(p->>'state', ''));
  v_zip text := btrim(coalesce(p->>'zip', ''));
  v_found boolean := coalesce((p->>'found')::boolean, false);
  v_rough boolean := coalesce((p->>'rough')::boolean, false);
  v_place text := nullif(btrim(coalesce(p->>'place', '')), '');
  v_source text := nullif(p->>'sqft_source', '');
  v_sqft numeric;
  v_priced jsonb;
  v_custom boolean := false;
  v_plans jsonb := '[]'::jsonb;
  d jsonb;
  r jsonb;
  k text;
  v_token uuid;
  v_calls integer;
  v_storms integer;
  v_low numeric;
  v_high numeric;
  v_lo jsonb;
  v_hi jsonb;
  v_pl numeric;
  v_ph numeric;
  v_price numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server asks for public prices' using errcode = '42501';
  end if;
  if char_length(v_address) < 3 or char_length(v_address) > 200
     or char_length(v_city) > 120 or char_length(v_state) > 40 or char_length(v_zip) > 12
     or char_length(coalesce(v_place, '')) > 160
  then
    raise exception 'Type the building''s street address, city, state and zip.'
      using errcode = '22023';
  end if;
  if v_source is not null and v_source not in ('map', 'typed', 'range') then
    raise exception 'The roof size did not come through. Please try again.' using errcode = '22023';
  end if;
  begin
    v_sqft := nullif(p->>'sqft', '')::numeric;
  exception when others then
    v_sqft := null;
  end;
  if v_sqft is not null and (v_sqft = 'NaN'::numeric or v_sqft <= 0 or v_sqft > 100000000) then
    raise exception 'Type the roof''s size in square feet: a number above 0.'
      using errcode = '22023';
  end if;
  if v_sqft is null then
    v_source := null;
  end if;
  -- A size range was picked and no size typed: the two ends of the range come with it, so
  -- each plan can be shown from its lowest price to its highest. Ends that do not sit around
  -- the size itself are dropped, and the one price stands as before.
  if v_source = 'range' then
    begin
      v_low := nullif(p->>'sqft_low', '')::numeric;
      v_high := nullif(p->>'sqft_high', '')::numeric;
    exception when others then
      v_low := null;
      v_high := null;
    end;
    if v_low is null or v_high is null or v_low = 'NaN'::numeric or v_high = 'NaN'::numeric
       or v_low <= 0 or v_low > v_sqft or v_high < v_sqft or v_high > 100000000
    then
      v_low := null;
      v_high := null;
    end if;
  end if;

  if v_found and v_sqft is not null then
    v_priced := public.roof_care_price(v_sqft, p_hours, p_miles);
    if coalesce((v_priced->>'ready')::boolean, false) is not true then
      raise exception 'The plan prices are not set up yet. Please call us.' using errcode = 'P0001';
    end if;
    v_custom := coalesce((v_priced->>'custom_quote')::boolean, false);
    if not v_custom then
      select s.data into d from public.roof_care_settings s where s.id = 1;
      v_calls := least(greatest(round(coalesce(nullif(d->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 99);
      v_storms := least(greatest(round(coalesce(nullif(d->>'guard_storm_inspections', '')::numeric, 0))::integer, 0), 99);
      if v_low is not null then
        v_lo := public.roof_care_price(v_low, p_hours, p_miles);
        v_hi := public.roof_care_price(v_high, p_hours, p_miles);
        if coalesce((v_lo->>'ready')::boolean, false) is not true
           or coalesce((v_hi->>'ready')::boolean, false) is not true
           or coalesce((v_lo->>'custom_quote')::boolean, false)
           or coalesce((v_hi->>'custom_quote')::boolean, false)
        then
          v_lo := null;
          v_hi := null;
        end if;
      end if;
      for r in select value from jsonb_array_elements(v_priced->'plans') loop
        k := r->>'plan';
        v_price := (r->>'price')::numeric;
        v_pl := null;
        v_ph := null;
        if v_lo is not null then
          select (x->>'price')::numeric into v_pl
            from jsonb_array_elements(v_lo->'plans') x where x->>'plan' = k;
          select (x->>'price')::numeric into v_ph
            from jsonb_array_elements(v_hi->'plans') x where x->>'plan' = k;
        end if;
        v_plans := v_plans || (jsonb_build_object(
          'plan', k,
          'name', case k when 'watch' then 'Roof Watch' when 'care' then 'Roof Care'
                         else 'Roof Guard' end,
          'price', (r->>'price')::numeric,
          'benefits', jsonb_build_object(
            'allowance', greatest(coalesce(nullif(d->'plans'->k->>'allowance', '')::numeric, 0), 0),
            'leak_calls', case when k = 'guard' then v_calls else 0 end,
            'storm', case when k = 'guard' then v_storms else 0 end))
          || case when v_pl is not null and v_ph is not null and v_pl <= v_price and v_ph >= v_price
                  then jsonb_build_object('price_low', v_pl, 'price_high', v_ph)
                  else '{}'::jsonb end);
      end loop;
    end if;
  end if;

  delete from public.public_quotes where created_at < now() - interval '14 days';
  insert into public.public_quotes (
    from_key, address, city, state, zip, found, rough, place, sqft, sqft_source,
    custom_quote, plans)
  values (
    left(p_key, 80), v_address, v_city, v_state, v_zip, v_found, v_rough, v_place, v_sqft,
    v_source, v_custom, v_plans)
  returning token into v_token;
  return jsonb_build_object('quote_token', v_token, 'custom_quote', v_custom, 'plans', v_plans);
end;
$function$;

revoke all on function public.public_care_quote(text, jsonb, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.public_care_quote(text, jsonb, numeric, numeric) to service_role;
