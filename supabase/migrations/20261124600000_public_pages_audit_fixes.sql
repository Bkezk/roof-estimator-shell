/* The public pages audit, Nov 24, 2026 (owner: "Go" on each).

   What changes here, in the database's own checks behind /care and /request:

   1. Request service: a request with no box ticked is kept when a few words say what is going
      on. It is filed as "Other". (The page always let it through and the database refused it.)
   6. A building further than a plan is priced for (a round trip over 24 hours or 2,000 miles)
      is answered as a custom quote, marked `far`, in place of a refusal written for the office.
   8. A price belongs to one building: its street, city, state and zip. The city, a two letter
      state and a five digit zip are asked for here too, and the request is compared with the
      price on all four.
   9. One-line boxes are kept as one line (no line break, tab or other unseen character), and
      an email address is accepted only when it is nothing but an address.
   12. The same request sent twice within ten minutes is one request: its reference is given
      again. A form dropped as a robot's is counted by day. The office's "this request became
      that plan / that opportunity" is refused when the plan or the opportunity is another
      customer's. Daily totals of the counters are kept sixty days (they were three).

   Applied by hand through the Lovable database tool (AGENTS.md). */

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────

create or replace function public.public_form_line(p text)
returns text
language sql
immutable
set search_path = public
as $function$
  select btrim(regexp_replace(
    regexp_replace(coalesce(p, ''), '[\x01-\x1F\x7F  ]+', ' ', 'g'),
    ' {2,}', ' ', 'g'));
$function$;

create or replace function public.public_form_text(p text)
returns text
language sql
immutable
set search_path = public
as $function$
  select btrim(regexp_replace(coalesce(p, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F  ]+', ' ', 'g'));
$function$;

revoke all on function public.public_form_line(text) from public, anon;
revoke all on function public.public_form_text(text) from public, anon;
grant execute on function public.public_form_line(text) to authenticated, service_role;
grant execute on function public.public_form_text(text) to authenticated, service_role;

alter table public.public_quotes add column if not exists far boolean not null default false;

-- ── The counters ────────────────────────────────────────────────────────────────────────────

alter table public.public_form_hits drop constraint if exists public_form_hits_kind_check;
alter table public.public_form_hits add constraint public_form_hits_kind_check
  check (kind = any (array['quote'::text, 'request'::text, 'pay'::text, 'trap'::text]));

create or replace function public.public_form_dropped(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts requests' using errcode = '42501';
  end if;
  insert into public.public_form_hits (kind, key, bucket, n)
  values ('trap', '*', date_trunc('day', now()), 1)
  on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1;
end;
$function$;

revoke all on function public.public_form_dropped(text) from public, anon, authenticated;
grant execute on function public.public_form_dropped(text) to service_role;

create or replace function public.public_form_take(p_kind text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_one_cap integer;
  v_all_cap integer;
  v_one integer;
  v_all integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts requests' using errcode = '42501';
  end if;
  if p_kind = 'quote' then
    v_one_cap := 20; v_all_cap := 400;
  elsif p_kind = 'request' then
    v_one_cap := 5; v_all_cap := 60;
  elsif p_kind = 'pay' then
    -- Nov 23: the card payment link in a customer's email. Opening it and pressing Pay each
    -- count. A link is a long random address nobody can guess; this only stops hammering.
    v_one_cap := 30; v_all_cap := 2000;
  else
    return false;
  end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 80 or p_key = '*' then
    return false;
  end if;
  -- Nov 24: one connection's hourly counts go after three days, as before. The day's totals
  -- for everyone together (the '*' rows, which belong to no connection) are kept sixty days.
  delete from public.public_form_hits where bucket < now() - interval '3 days' and key <> '*';
  delete from public.public_form_hits where bucket < now() - interval '60 days';
  select n into v_all from public.public_form_hits
   where kind = p_kind and key = '*' and bucket = v_day;
  select n into v_one from public.public_form_hits
   where kind = p_kind and key = p_key and bucket = v_hour;
  if coalesce(v_all, 0) >= v_all_cap or coalesce(v_one, 0) >= v_one_cap then
    return false;
  end if;
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, '*', v_day, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1;
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, p_key, v_hour, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1;
  return true;
end;
$function$;

-- ── The price question ──────────────────────────────────────────────────────────────────────

create or replace function public.public_care_quote(p_key text, p jsonb, p_hours numeric, p_miles numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_address text := public.public_form_line(p->>'address');
  v_city text := public.public_form_line(p->>'city');
  v_state text := upper(public.public_form_line(p->>'state'));
  v_zip text := public.public_form_line(p->>'zip');
  v_found boolean := coalesce((p->>'found')::boolean, false);
  v_rough boolean := coalesce((p->>'rough')::boolean, false);
  v_place text := nullif(public.public_form_line(p->>'place'), '');
  v_source text := nullif(p->>'sqft_source', '');
  v_sqft numeric;
  v_priced jsonb;
  v_custom boolean := false;
  v_far boolean := false;
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
     or char_length(v_city) < 1 or char_length(v_city) > 120
     or char_length(coalesce(v_place, '')) > 160
  then
    raise exception 'Type the building''s street address, city, state and zip.'
      using errcode = '22023';
  end if;
  -- Nov 24: a price belongs to one building. Its state and its zip are checked here too.
  if v_state !~ '^[A-Z]{2}$' then
    raise exception 'Type the state as two letters, like KY.' using errcode = '22023';
  end if;
  if v_zip !~ '^\d{5}(-\d{4})?$' then
    raise exception 'Type the building''s five digit zip code.' using errcode = '22023';
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

  -- Nov 24: a building further than a plan is priced for. roof_care_price refuses a round trip
  -- over 24 hours or 2,000 miles in words written for the office ("ask an admin to check where
  -- the property is on the map"), and the visitor was told to try again for ever. It is a
  -- custom quote: no price, and their details can still be sent.
  if v_found and (coalesce(p_hours, 0) > 24 or coalesce(p_miles, 0) > 2000) then
    v_far := true;
    v_custom := true;
  elsif v_found and v_sqft is not null then
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
    custom_quote, far, plans)
  values (
    left(p_key, 80), v_address, v_city, v_state, v_zip, v_found, v_rough, v_place, v_sqft,
    v_source, v_custom, v_far, v_plans)
  returning token into v_token;
  return jsonb_build_object(
    'quote_token', v_token, 'custom_quote', v_custom, 'far', v_far, 'plans', v_plans);
end;
$function$;

-- ── The request ─────────────────────────────────────────────────────────────────────────────

create or replace function public.public_request_submit(p_key text, p jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_kind text := p->>'kind';
  t_name text := public.public_form_line(p->>'contact_name');
  t_company text := public.public_form_line(p->>'company');
  t_phone text := public.public_form_line(p->>'phone');
  t_email text := lower(public.public_form_line(p->>'email'));
  t_address text := public.public_form_line(p->>'address');
  t_city text := public.public_form_line(p->>'city');
  t_state text := upper(public.public_form_line(p->>'state'));
  t_zip text := public.public_form_line(p->>'zip');
  t_building text := public.public_form_line(p->>'building_name');
  t_referred text := public.public_form_line(p->>'referred_by');
  t_notes text := public.public_form_text(p->>'notes');
  t_details text := public.public_form_text(p->>'details');
  v_plan text := p->>'plan';
  v_pay text := p->>'pay_method';
  v_terms text := btrim(coalesce(p->>'terms_version', ''));
  t_agreed_by text := public.public_form_line(p->>'agreed_by');
  v_several boolean := coalesce((p->>'several_buildings')::boolean, false);
  v_range text := nullif(p->>'size_range', '');
  v_shown numeric;
  v_q public.public_quotes%rowtype;
  v_price numeric;
  v_priced boolean;
  v_far boolean := false;
  v_services text[] := '{}'::text[];
  v_known text[];
  s text;
  v_ref text;
  v_digits text;
  v_id uuid;
  v_opp uuid;
  v_from text;
  v_plan_name text;
  v_ask text;
  v_title text;
  v_desc text;
  v_email_ok constant text := '^[a-z0-9._%+''-]+@([a-z0-9-]+\.)+[a-z]{2,}$';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server sends a public request' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('care', 'service') then
    raise exception 'The form did not come through. Please try again.' using errcode = '22023';
  end if;
  if char_length(t_name) < 2 or char_length(t_name) > 120 then
    raise exception 'Type your name.' using errcode = '22023';
  end if;
  if char_length(t_company) > 160 or char_length(t_building) > 160
     or char_length(t_referred) > 160 or char_length(t_phone) > 40 or char_length(t_email) > 200
     or char_length(t_notes) > 2000 or char_length(t_details) > 2000
  then
    raise exception 'One of the boxes holds more than it can take. Shorten it and send again.'
      using errcode = '22023';
  end if;
  v_digits := regexp_replace(t_phone, '\D', '', 'g');
  if not (char_length(v_digits) between 10 and 15 or t_email ~ v_email_ok) then
    raise exception 'Type a phone number with its area code, or an email address, so we can reach you.'
      using errcode = '22023';
  end if;
  -- Nov 24: an email address is kept only when it is nothing but an address. The office's
  -- screen makes a link from it.
  if t_email <> '' and t_email !~ v_email_ok then
    raise exception 'The email address does not look right. Check it, or leave it blank and give a phone number.'
      using errcode = '22023';
  end if;
  if char_length(t_address) < 3 or char_length(t_address) > 200
     or char_length(t_city) < 1 or char_length(t_city) > 120
  then
    raise exception 'Type the building''s street address, city, state and zip.'
      using errcode = '22023';
  end if;
  -- Nov 24: the state and the zip are checked here too, not only on the page.
  if t_state !~ '^[A-Z]{2}$' then
    raise exception 'Type the state as two letters, like KY.' using errcode = '22023';
  end if;
  if t_zip !~ '^\d{5}(-\d{4})?$' then
    raise exception 'Type the building''s five digit zip code.' using errcode = '22023';
  end if;

  if v_kind = 'care' then
    if v_range is not null
       and v_range not in ('under_10k', '10k_25k', '25k_50k', '50k_75k', 'over_75k')
    then
      raise exception 'The roof size did not come through. Please try again.' using errcode = '22023';
    end if;
    begin
      select * into v_q from public.public_quotes where token = (p->>'quote_token')::uuid;
    exception when others then
      v_q := null;
    end;
    if v_q.token is null or v_q.created_at < now() - interval '2 days' then
      raise exception 'The prices on the page are no longer current. Press Show my prices again, then send.'
        using errcode = 'P0001';
    end if;
    -- Nov 24: the price is for one building: the same street, city, state and zip. (It was
    -- the street and the zip alone.)
    if public.public_form_norm(v_q.address) <> public.public_form_norm(t_address)
       or public.public_form_norm(v_q.zip) <> public.public_form_norm(t_zip)
       or public.public_form_norm(v_q.city) <> public.public_form_norm(t_city)
       or upper(btrim(coalesce(v_q.state, ''))) <> t_state
    then
      raise exception 'The address changed after the prices were shown. Press Show my prices again, then send.'
        using errcode = 'P0001';
    end if;
    v_far := coalesce(v_q.far, false);
    -- A plan is picked and its price proved only where prices were shown: not for a custom
    -- quote, several buildings, or an address that could not be placed.
    v_priced := v_q.found and not v_q.custom_quote and not v_several and v_q.sqft is not null
      and jsonb_typeof(v_q.plans) = 'array' and jsonb_array_length(v_q.plans) > 0;
    if v_priced then
      if v_plan is null or v_plan not in ('watch', 'care', 'guard') then
        raise exception 'Pick one of the three plans.' using errcode = '22023';
      end if;
      if v_pay is null or v_pay not in ('check', 'card') then
        raise exception 'Say how you would like to pay: by check or by card.' using errcode = '22023';
      end if;
      if coalesce((p->>'agreed')::boolean, false) is not true then
        raise exception 'Tick the box to agree to the plan''s terms.' using errcode = '22023';
      end if;
      if v_terms !~ '^\d{4}-\d{2}-\d{2}(\.\d+)?$' then
        raise exception 'The plan''s terms did not come through. Reload the page and try again.'
          using errcode = '22023';
      end if;
      if char_length(t_agreed_by) < 2 or char_length(t_agreed_by) > 120 then
        raise exception 'Type your full name where it asks who agrees to the terms.'
          using errcode = '22023';
      end if;
      select (x->>'price')::numeric into v_price
        from jsonb_array_elements(v_q.plans) x where x->>'plan' = v_plan;
      begin
        v_shown := nullif(p->>'shown_price', '')::numeric;
      exception when others then
        v_shown := null;
      end;
      if v_price is null or v_shown is null or v_shown <> v_price then
        raise exception 'The price changed after it was shown. Press Show my prices again, then send.'
          using errcode = 'P0001';
      end if;
    else
      -- No price was shown, so this is a request to be called with a custom quote, not a
      -- sign-up: no price, no way of paying and no agreement to the terms is kept, whatever
      -- the page sent in those boxes. A plan is kept (as the one they leaned to) only where
      -- the three prices were on the page, which is the several buildings case.
      v_shown := null;
      v_pay := null;
      v_terms := null;
      t_agreed_by := null;
      if not (jsonb_typeof(v_q.plans) = 'array' and jsonb_array_length(v_q.plans) > 0
              and v_plan in ('watch', 'care', 'guard'))
      then
        v_plan := null;
      end if;
    end if;
  else
    select services into v_known from public.public_form_settings where id = 1;
    if jsonb_typeof(p->'services') = 'array' then
      for s in select btrim(value) from jsonb_array_elements_text(p->'services') loop
        if s = any(coalesce(v_known, '{}'::text[])) and not (s = any(v_services)) then
          v_services := v_services || s;
        elsif not (s = any(coalesce(v_known, '{}'::text[]))) then
          raise exception 'One of the services ticked is not on our list any more. Reload the page and try again.'
            using errcode = '22023';
        end if;
      end loop;
    end if;
    -- Nov 24: no box ticked is fine when a few words say what is going on. The page always
    -- let that through; it was refused here, and the visitor was told to try again for ever.
    if coalesce(array_length(v_services, 1), 0) < 1 and t_details = '' then
      raise exception 'Tick a service, or tell us what is going on.' using errcode = '22023';
    end if;
  end if;

  -- Nov 24: the same request sent twice within ten minutes (a second press after a slow
  -- answer, a reload and a resend) is one request. The first one's reference is given again,
  -- and the office gets one opportunity, not two.
  select q.reference into v_ref
    from public.public_requests q
   where q.kind = v_kind
     and q.created_at > now() - interval '10 minutes'
     and q.contact_name = t_name
     and q.email = t_email
     and regexp_replace(q.phone, '\D', '', 'g') = v_digits
     and public.public_form_norm(q.address) = public.public_form_norm(t_address)
     and q.zip = t_zip
     and coalesce(q.plan, '') = coalesce(case when v_kind = 'care' then v_plan end, '')
     and q.services = v_services
     and q.details = (case when v_kind = 'service' then t_details else '' end)
     and q.notes = (case when v_kind = 'care' then t_notes else '' end)
   order by q.created_at desc
   limit 1;
  if v_ref is not null then
    return v_ref;
  end if;

  v_ref := 'R-' || nextval('public.public_request_ref_seq');
  insert into public.public_requests (
    reference, kind, contact_name, company, phone, email, address, city, state, zip,
    building_name, referred_by, plan, sqft, size_range, sqft_source, shown_price, quote,
    pay_method, terms_version, agreed_by, several_buildings, notes, services, details, from_key)
  values (
    v_ref, v_kind, t_name, t_company, t_phone, t_email, t_address, t_city, t_state, t_zip,
    t_building, t_referred,
    case when v_kind = 'care' then v_plan end,
    case when v_kind = 'care' then v_q.sqft end,
    case when v_kind = 'care' then v_range end,
    case when v_kind = 'care' then v_q.sqft_source end,
    case when v_kind = 'care' then v_shown end,
    case when v_kind = 'care' then jsonb_build_object(
      'found', v_q.found, 'rough', v_q.rough, 'place', v_q.place,
      'custom_quote', v_q.custom_quote, 'far', v_far, 'plans', v_q.plans) end,
    case when v_kind = 'care' then v_pay end,
    case when v_kind = 'care' then v_terms end,
    case when v_kind = 'care' then t_agreed_by end,
    case when v_kind = 'care' then v_several else false end,
    case when v_kind = 'care' then t_notes else '' end,
    v_services,
    case when v_kind = 'service' then t_details else '' end,
    left(p_key, 80))
  returning id into v_id;

  -- Nov 23 (owner: "i like option A"): the request becomes an opportunity at once, in the normal
  -- list. No customer is on it yet (the office says whose it is, on the opportunity) and nobody
  -- is assigned, so the "nobody on it" alert covers it. Due the next day: someone is waiting.
  v_from := coalesce(nullif(t_company, ''), t_name);
  v_plan_name := case v_plan when 'watch' then 'Roof Watch' when 'care' then 'Roof Care'
                   when 'guard' then 'Roof Guard' else 'a Roof Care plan' end;
  if v_kind = 'care' and v_shown is null then
    v_ask := 'a custom quote for ' || v_plan_name
      || case when v_several then ', several buildings' else '' end
      || case when v_far then ', outside the usual service area' else '' end;
    v_title := v_from || ': Roof Care custom quote';
  elsif v_kind = 'care' then
    v_ask := v_plan_name;
    v_title := v_from || ': ' || v_plan_name || ' plan';
  elsif coalesce(array_length(v_services, 1), 0) < 1 then
    -- Nov 24: no box ticked. Filed as Other; what they wrote says the rest.
    v_ask := 'Other (see what they wrote)';
    v_title := v_from || ': Other';
  else
    v_ask := array_to_string(v_services, ', ');
    v_title := v_from || ': ' || v_services[1]
      || case when array_length(v_services, 1) > 1
              then ' and ' || (array_length(v_services, 1) - 1) || ' more' else '' end;
  end if;
  v_desc := 'From the public '
    || case when v_kind = 'care' then 'Roof Care plans' else 'Request service' end
    || ' page, request ' || v_ref || '.' || E'\n'
    || 'Asked for: ' || v_ask || '.' || E'\n'
    || case when v_kind = 'service' and coalesce(array_length(v_services, 1), 0) < 1
            then 'They wrote: ' || left(public.public_form_line(t_details), 400) || E'\n'
            else '' end
    || 'Contact: ' || concat_ws(', ', t_name, nullif(t_phone, ''), nullif(t_email, '')) || '.'
    || E'\n'
    || 'Building: ' || concat_ws(', ', nullif(t_building, ''), t_address, nullif(t_city, ''),
                                 nullif(btrim(t_state || ' ' || t_zip), '')) || '.';
  insert into public.crm_opportunities (
    title, description, status, lead_source, referred_by, est_value, expected_close,
    created_by, updated_by_name)
  values (
    left(v_title, 160), left(v_desc, 1900), 'open', 'QR page',
    nullif(left(t_referred, 120), ''),
    case when v_kind = 'care' then v_shown end,
    (now() at time zone 'America/New_York')::date + 1,
    null, 'Public page')
  returning id into v_opp;
  update public.public_requests set opportunity_id = v_opp where id = v_id;
  return v_ref;
end;
$function$;

-- ── The office's answer to a request ────────────────────────────────────────────────────────

create or replace function public.public_request_handle(
  p_id uuid, p_status text, p_account uuid default null, p_site uuid default null,
  p_opportunity uuid default null, p_plan uuid default null, p_reason text default null)
returns public.public_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  q public.public_requests;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_account uuid;
begin
  if not public.has_access('customers') then
    raise exception 'Only the office handles the requests from the public pages'
      using errcode = '42501';
  end if;
  select * into q from public.public_requests where id = p_id for update;
  if not found then
    raise exception 'That request was not found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('matched', 'dismissed', 'new') then
    raise exception 'Say what happened to the request: matched or dismissed' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(pr.email), ''), 'Unknown user')
    into v_name from public.profiles pr where pr.id = auth.uid();
  if p_status = 'dismissed' then
    if q.status = 'matched' then
      raise exception 'This request is already matched to a customer, so it is not dismissed'
        using errcode = 'P0001';
    end if;
    if v_reason is null or char_length(v_reason) > 500 then
      raise exception 'Type why the request is dismissed, in a few words' using errcode = '22023';
    end if;
    update public.public_requests
       set status = 'dismissed', dismiss_reason = v_reason, handled_at = now(),
           handled_by = auth.uid(), handled_by_name = v_name
     where id = p_id returning * into q;
    return q;
  end if;
  if p_status = 'new' then
    -- Put back on the list: a dismissal taken back. A matched request stays matched.
    if q.status <> 'dismissed' then
      raise exception 'Only a dismissed request is put back on the list' using errcode = 'P0001';
    end if;
    update public.public_requests
       set status = 'new', dismiss_reason = null, handled_at = null, handled_by = null,
           handled_by_name = null
     where id = p_id returning * into q;
    return q;
  end if;
  if q.status = 'dismissed' then
    raise exception 'This request was dismissed. Put it back on the list first.'
      using errcode = 'P0001';
  end if;
  v_account := coalesce(p_account, q.account_id);
  if v_account is null then
    raise exception 'Pick the customer this request belongs to' using errcode = '22023';
  end if;
  if p_account is not null and not exists (
       select 1 from public.crm_accounts a where a.id = p_account and a.deleted_at is null)
  then
    raise exception 'That customer was not found, or is deleted' using errcode = 'P0002';
  end if;
  if p_site is not null and not exists (
       select 1 from public.crm_sites s
        where s.id = p_site and s.deleted_at is null
          and s.account_id = v_account)
  then
    raise exception 'That property is not this customer''s' using errcode = '22023';
  end if;
  -- Nov 24: the opportunity and the plan a request is pointed at are this customer's own. An
  -- opportunity of another customer would otherwise be handed to this one further down.
  if p_opportunity is not null and not exists (
       select 1 from public.crm_opportunities o
        where o.id = p_opportunity and o.deleted_at is null
          and (o.account_id is null or o.account_id = v_account))
  then
    raise exception 'That opportunity is another customer''s, or is deleted' using errcode = '22023';
  end if;
  if p_plan is not null and not exists (
       select 1 from public.roof_care_plans pl
        where pl.id = p_plan and pl.account_id = v_account)
  then
    raise exception 'That Roof Care plan is not this customer''s' using errcode = '22023';
  end if;
  update public.public_requests
     set status = 'matched',
         account_id = coalesce(p_account, account_id),
         site_id = coalesce(p_site, site_id),
         opportunity_id = coalesce(p_opportunity, opportunity_id),
         roof_care_plan_id = coalesce(p_plan, roof_care_plan_id),
         handled_at = coalesce(handled_at, now()),
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, v_name)
   where id = p_id returning * into q;
  -- Nov 23: the request's own opportunity gets the customer and the property with it.
  if q.opportunity_id is not null then
    update public.crm_opportunities o
       set account_id = q.account_id,
           site_id = coalesce(q.site_id, o.site_id),
           updated_by_name = v_name
     where o.id = q.opportunity_id
       and o.deleted_at is null
       and (o.account_id is distinct from q.account_id
            or (q.site_id is not null and o.site_id is distinct from q.site_id));
  end if;
  -- Nov 23 (owner: "2 go"): the opportunity is Won when the plan is paid, not when it is
  -- signed. A plan that is already paid when the request is pointed at it is Won now.
  if q.roof_care_plan_id is not null and exists (
       select 1 from public.roof_care_plans p
        where p.id = q.roof_care_plan_id and p.status = 'active')
  then
    perform public.roof_care_plan_wins_opportunity(q.roof_care_plan_id);
  end if;
  return q;
end;
$function$;
