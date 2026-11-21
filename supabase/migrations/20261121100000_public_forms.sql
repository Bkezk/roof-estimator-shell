-- The two public pages opened by QR codes (Roof Care step 4; owner, Nov 18 and Nov 20):
-- "Roof Care plans" and "Request service", with no sign-in.
--
-- This is the first door open to strangers, so nothing here is given to the anonymous role.
-- The public pages talk to the site's own server, and the server talks to the database with its
-- own key, the way the two share links (/d/<token>, /i/<token>) already do. The rule of Nov 14,
-- "no database function runs without an account", stands untouched: a stranger holding the
-- site's public key can call none of these functions and read none of these tables.
--
--   public_form_settings   the office's three settings: the services on the request form, the
--                          web address printed in the QR codes, the daily limit of Google lookups
--   google_route_uses      how many Google drive lookups the whole site made each day
--   public_form_hits       how often one connection, and everyone together, asked
--   public_quotes          the prices a visitor was shown, so the request can prove them
--   public_requests        what a visitor sent, held for the office
--
-- Every function checks what it is given again, whatever the server checked before it.

-- ── The office's settings ────────────────────────────────────────────────────────────────────
create table if not exists public.public_form_settings (
  id smallint primary key default 1 check (id = 1),
  -- A starter list. The owner said the printed leave-behind's list is not right and sends his own.
  services text[] not null default array[
    'Roof leak or repair',
    'Roof inspection',
    'Roof replacement or new roof quote',
    'Roof Care maintenance plan',
    'Gutters and downspouts',
    'Sheet metal and flashing',
    'Storm damage',
    'Something else'
  ]::text[],
  -- Null: the site's own address. Printed codes are permanent, so this should be an address on
  -- a domain the company owns.
  qr_base_url text check (qr_base_url is null or qr_base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
  google_daily_cap integer not null default 200 check (google_daily_cap between 0 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  constraint public_form_services_sane check (
    coalesce(array_length(services, 1), 0) between 1 and 40)
);
insert into public.public_form_settings (id) values (1) on conflict (id) do nothing;

alter table public.public_form_settings enable row level security;
drop policy if exists public_form_settings_read on public.public_form_settings;
create policy public_form_settings_read on public.public_form_settings
  for select to authenticated using ((select public.has_access('customers')));
drop policy if exists public_form_settings_write on public.public_form_settings;
create policy public_form_settings_write on public.public_form_settings
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_manager()))
  with check ((select public.is_admin()) or (select public.is_manager()));
revoke all on public.public_form_settings from anon;

-- ── The daily limit of Google lookups ────────────────────────────────────────────────────────
create table if not exists public.google_route_uses (
  day date primary key,
  used integer not null default 0,
  -- Lookups that went to the free router because the day's limit was reached.
  held integer not null default 0
);
alter table public.google_route_uses enable row level security;
revoke all on public.google_route_uses from anon, authenticated;

/* May the site ask Google for one more drive today? True and counted when under the limit;
   false, and counted as held, at the limit. The day is the office's day (Eastern). */
create or replace function public.google_route_take()
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_day date := (now() at time zone 'America/New_York')::date;
  v_cap integer;
  v_used integer;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;
  select google_daily_cap into v_cap from public.public_form_settings where id = 1;
  v_cap := coalesce(v_cap, 200);
  insert into public.google_route_uses (day) values (v_day) on conflict (day) do nothing;
  update public.google_route_uses set used = used + 1
   where day = v_day and used < v_cap
  returning used into v_used;
  if found then
    return true;
  end if;
  update public.google_route_uses set held = held + 1 where day = v_day;
  return false;
end;
$function$;

revoke all on function public.google_route_take() from public, anon;
grant execute on function public.google_route_take() to authenticated, service_role;

/* Today's count, for the office's page. */
create or replace function public.google_route_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_day date := (now() at time zone 'America/New_York')::date;
  v_cap integer;
  v_used integer;
  v_held integer;
begin
  if not public.has_access('customers') then
    raise exception 'Only the office reads the Google lookup count' using errcode = '42501';
  end if;
  select google_daily_cap into v_cap from public.public_form_settings where id = 1;
  select used, held into v_used, v_held from public.google_route_uses where day = v_day;
  return jsonb_build_object(
    'cap', coalesce(v_cap, 200), 'used', coalesce(v_used, 0), 'held', coalesce(v_held, 0));
end;
$function$;

revoke all on function public.google_route_today() from public, anon;
grant execute on function public.google_route_today() to authenticated;

-- ── How often a connection asks ──────────────────────────────────────────────────────────────
create table if not exists public.public_form_hits (
  kind text not null check (kind in ('quote', 'request')),
  -- A keyed hash of where the request came from, made by the server. Never the address itself.
  -- '*' is everyone together.
  key text not null check (char_length(key) between 1 and 80),
  bucket timestamptz not null,
  n integer not null default 0,
  primary key (kind, key, bucket)
);
alter table public.public_form_hits enable row level security;
revoke all on public.public_form_hits from anon, authenticated;

/* One more quote or request from this connection: true when it is within the limits.
   A connection: 20 price questions and 5 requests an hour. Everyone together: 400 price
   questions and 60 requests a day. */
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
  else
    return false;
  end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 80 or p_key = '*' then
    return false;
  end if;
  delete from public.public_form_hits where bucket < now() - interval '3 days';
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

revoke all on function public.public_form_take(text, text) from public, anon, authenticated;
grant execute on function public.public_form_take(text, text) to service_role;

-- ── The prices a visitor was shown ───────────────────────────────────────────────────────────
create table if not exists public.public_quotes (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  from_key text,
  address text not null,
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  found boolean not null,
  rough boolean not null default false,
  place text,
  sqft numeric,
  sqft_source text check (sqft_source is null or sqft_source in ('map', 'typed', 'range')),
  custom_quote boolean not null default false,
  -- [{ plan, name, price, benefits }]: prices only, never how they were made.
  plans jsonb not null default '[]'::jsonb
);
alter table public.public_quotes enable row level security;
revoke all on public.public_quotes from anon, authenticated;

/* An address the way two typings of it are compared: lower case, one space, no dots or commas. */
create or replace function public.public_form_norm(p text)
returns text
language sql
immutable
set search_path = public
as $function$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[.,#]', ' ', 'g'), '\s+', ' ', 'g'));
$function$;

revoke all on function public.public_form_norm(text) from public, anon;
grant execute on function public.public_form_norm(text) to authenticated, service_role;

/* The three yearly prices for a building, kept so the request can prove what was shown.
   `p` is { address, city, state, zip, found, rough, place, sqft, sqft_source }. The drive is the
   server's (hours and miles, round trip) and is used only to work the price out: it is not
   kept and not answered. The answer is { quote_token, custom_quote, plans }. */
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
      for r in select value from jsonb_array_elements(v_priced->'plans') loop
        k := r->>'plan';
        v_plans := v_plans || jsonb_build_object(
          'plan', k,
          'name', case k when 'watch' then 'Roof Watch' when 'care' then 'Roof Care'
                         else 'Roof Guard' end,
          'price', (r->>'price')::numeric,
          'benefits', jsonb_build_object(
            'allowance', greatest(coalesce(nullif(d->'plans'->k->>'allowance', '')::numeric, 0), 0),
            'leak_calls', case when k = 'guard' then v_calls else 0 end,
            'storm', case when k = 'guard' then v_storms else 0 end));
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

-- ── What a visitor sent ──────────────────────────────────────────────────────────────────────
create sequence if not exists public.public_request_ref_seq start with 4001;
revoke all on sequence public.public_request_ref_seq from anon, authenticated;

create table if not exists public.public_requests (
  id uuid primary key default gen_random_uuid(),
  -- What the visitor is told to quote on the phone: "R-4001".
  reference text not null unique,
  kind text not null check (kind in ('care', 'service')),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'matched', 'dismissed')),
  contact_name text not null,
  company text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null,
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  building_name text not null default '',
  referred_by text not null default '',
  -- Roof Care
  plan text check (plan is null or plan in ('watch', 'care', 'guard')),
  sqft numeric,
  size_range text,
  sqft_source text,
  shown_price numeric,
  -- The whole quote as it was shown: { found, rough, place, custom_quote, plans }.
  quote jsonb,
  pay_method text check (pay_method is null or pay_method in ('check', 'card')),
  terms_version text,
  agreed_by text,
  several_buildings boolean not null default false,
  notes text not null default '',
  -- Request service
  services text[] not null default '{}'::text[],
  details text not null default '',
  from_key text,
  -- When the office was told (a notice), so it is told once.
  told_at timestamptz,
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_by_name text,
  dismiss_reason text,
  -- What it became.
  account_id uuid references public.crm_accounts(id) on delete set null,
  site_id uuid references public.crm_sites(id) on delete set null,
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  roof_care_plan_id uuid references public.roof_care_plans(id) on delete set null
);
create index if not exists public_requests_new on public.public_requests (created_at desc)
  where status = 'new';

alter table public.public_requests enable row level security;
drop policy if exists public_requests_read on public.public_requests;
create policy public_requests_read on public.public_requests
  for select to authenticated using ((select public.has_access('customers')));
revoke all on public.public_requests from anon;
revoke insert, update, delete on public.public_requests from authenticated;

/* A visitor's request, checked again and kept. `p` is the form as the page sent it. The answer
   is the reference. Nothing here looks at who is already a customer. */
create or replace function public.public_request_submit(p_key text, p jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_kind text := p->>'kind';
  t_name text := btrim(coalesce(p->>'contact_name', ''));
  t_company text := btrim(coalesce(p->>'company', ''));
  t_phone text := btrim(coalesce(p->>'phone', ''));
  t_email text := lower(btrim(coalesce(p->>'email', '')));
  t_address text := btrim(coalesce(p->>'address', ''));
  t_city text := btrim(coalesce(p->>'city', ''));
  t_state text := btrim(coalesce(p->>'state', ''));
  t_zip text := btrim(coalesce(p->>'zip', ''));
  t_building text := btrim(coalesce(p->>'building_name', ''));
  t_referred text := btrim(coalesce(p->>'referred_by', ''));
  t_notes text := btrim(coalesce(p->>'notes', ''));
  t_details text := btrim(coalesce(p->>'details', ''));
  v_plan text := p->>'plan';
  v_pay text := p->>'pay_method';
  v_terms text := btrim(coalesce(p->>'terms_version', ''));
  t_agreed_by text := btrim(coalesce(p->>'agreed_by', ''));
  v_several boolean := coalesce((p->>'several_buildings')::boolean, false);
  v_range text := nullif(p->>'size_range', '');
  v_shown numeric;
  v_q public.public_quotes%rowtype;
  v_price numeric;
  v_priced boolean;
  v_services text[] := '{}'::text[];
  v_known text[];
  s text;
  v_ref text;
  v_digits text;
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
  if not (char_length(v_digits) between 10 and 15 or t_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Type a phone number with its area code, or an email address, so we can reach you.'
      using errcode = '22023';
  end if;
  if t_email <> '' and t_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'The email address does not look right. Check it, or leave it blank and give a phone number.'
      using errcode = '22023';
  end if;
  if char_length(t_address) < 3 or char_length(t_address) > 200
     or char_length(t_city) > 120 or char_length(t_state) > 40 or char_length(t_zip) > 12
  then
    raise exception 'Type the building''s street address, city, state and zip.'
      using errcode = '22023';
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
    if public.public_form_norm(v_q.address) <> public.public_form_norm(t_address)
       or public.public_form_norm(v_q.zip) <> public.public_form_norm(t_zip)
    then
      raise exception 'The address changed after the prices were shown. Press Show my prices again, then send.'
        using errcode = 'P0001';
    end if;
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
    if coalesce(array_length(v_services, 1), 0) < 1 then
      raise exception 'Tick at least one service.' using errcode = '22023';
    end if;
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
      'custom_quote', v_q.custom_quote, 'plans', v_q.plans) end,
    case when v_kind = 'care' then v_pay end,
    case when v_kind = 'care' then v_terms end,
    case when v_kind = 'care' then t_agreed_by end,
    case when v_kind = 'care' then v_several else false end,
    case when v_kind = 'care' then t_notes else '' end,
    v_services,
    case when v_kind = 'service' then t_details else '' end,
    left(p_key, 80));
  return v_ref;
end;
$function$;

revoke all on function public.public_request_submit(text, jsonb) from public, anon, authenticated;
grant execute on function public.public_request_submit(text, jsonb) to service_role;

/* The services on the request form, for the public page (through the server). */
create or replace function public.public_service_choices()
returns text[]
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((select services from public.public_form_settings where id = 1), '{}'::text[]);
$function$;

revoke all on function public.public_service_choices() from public, anon;
grant execute on function public.public_service_choices() to authenticated, service_role;

-- ── The office's side ────────────────────────────────────────────────────────────────────────
/* Customers and properties that may be the one who sent a request: a shared phone, email,
   name or street address. Broad on purpose (owner, Nov 18): the office decides. */
create or replace function public.public_request_matches(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  q public.public_requests%rowtype;
  v_phone text;
  v_name text;
  v_company text;
  v_street text;
  v_out jsonb;
begin
  if not public.has_access('customers') then
    raise exception 'Only the office sees the requests from the public pages' using errcode = '42501';
  end if;
  select * into q from public.public_requests where id = p_id;
  if not found then
    return '[]'::jsonb;
  end if;
  v_phone := right(regexp_replace(q.phone, '\D', '', 'g'), 10);
  if char_length(v_phone) < 10 then v_phone := null; end if;
  v_name := public.public_form_norm(q.contact_name);
  v_company := public.public_form_norm(q.company);
  if char_length(v_company) < 4 then v_company := null; end if;
  if char_length(v_name) < 4 then v_name := null; end if;
  -- The house number and the first word of the street: "120 main".
  v_street := substring(public.public_form_norm(q.address) from '^\d+\s+\S+');

  with hits as (
    select a.id as account_id, null::uuid as site_id, 'phone' as why
      from public.crm_accounts a
     where a.deleted_at is null and v_phone is not null
       and (right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) = v_phone
            or right(regexp_replace(coalesce(a.mobile, ''), '\D', '', 'g'), 10) = v_phone)
    union all
    select c.account_id, null, 'phone'
      from public.crm_contacts c
     where c.deleted_at is null and v_phone is not null
       and (right(regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g'), 10) = v_phone
            or right(regexp_replace(coalesce(c.office_phone, ''), '\D', '', 'g'), 10) = v_phone)
    union all
    select a.id, null, 'email' from public.crm_accounts a
     where a.deleted_at is null and q.email <> '' and lower(btrim(coalesce(a.email, ''))) = q.email
    union all
    select c.account_id, null, 'email' from public.crm_contacts c
     where c.deleted_at is null and q.email <> '' and lower(btrim(coalesce(c.email, ''))) = q.email
    union all
    select a.id, null, 'name' from public.crm_accounts a
     where a.deleted_at is null
       and ((v_company is not null
             and (public.public_form_norm(a.name) like '%' || v_company || '%'
                  or (char_length(public.public_form_norm(a.name)) >= 4
                      and v_company like '%' || public.public_form_norm(a.name) || '%')))
            or (v_name is not null
                and (public.public_form_norm(a.name) = v_name
                     or public.public_form_norm(coalesce(a.contact_name, '')) = v_name)))
    union all
    select c.account_id, null, 'name' from public.crm_contacts c
     where c.deleted_at is null and v_name is not null
       and public.public_form_norm(coalesce(c.name, '')) = v_name
    union all
    select s.account_id, s.id, 'address' from public.crm_sites s
     where s.deleted_at is null and v_street is not null
       and public.public_form_norm(coalesce(s.address1, '')) like v_street || '%'
       and (q.zip = '' or coalesce(s.zip, '') = '' or left(s.zip, 5) = left(q.zip, 5))
    union all
    select a.id, null, 'address' from public.crm_accounts a
     where a.deleted_at is null and v_street is not null
       and public.public_form_norm(coalesce(a.address1, '')) like v_street || '%'
       and (q.zip = '' or coalesce(a.zip, '') = '' or left(a.zip, 5) = left(q.zip, 5))
  ),
  per as (
    select h.account_id,
           array_agg(distinct h.why order by h.why) as why,
           (array_agg(h.site_id) filter (where h.site_id is not null))[1] as site_id
      from hits h
      join public.crm_accounts a on a.id = h.account_id and a.deleted_at is null
     group by h.account_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', p.account_id,
           'account_name', a.name,
           'why', to_jsonb(p.why),
           'site_id', p.site_id,
           'site_name', s.name,
           'site_address', nullif(concat_ws(', ', nullif(btrim(coalesce(s.address1, '')), ''),
                                             nullif(btrim(coalesce(s.city, '')), '')), ''),
           'phone', coalesce(nullif(a.phone, ''), nullif(a.mobile, '')),
           'email', nullif(a.email, ''))
           order by array_length(p.why, 1) desc, a.name), '[]'::jsonb)
    into v_out
    from (select * from per order by array_length(why, 1) desc limit 12) p
    join public.crm_accounts a on a.id = p.account_id
    left join public.crm_sites s on s.id = p.site_id;
  return v_out;
end;
$function$;

revoke all on function public.public_request_matches(uuid) from public, anon;
grant execute on function public.public_request_matches(uuid) to authenticated;

/* The office's answer to a request: matched to a customer (and what it became), or dismissed
   with a reason. What it became can be added afterwards while it is matched. */
create or replace function public.public_request_handle(
  p_id uuid,
  p_status text,
  p_account uuid default null,
  p_site uuid default null,
  p_opportunity uuid default null,
  p_plan uuid default null,
  p_reason text default null)
returns public.public_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  q public.public_requests;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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
  if coalesce(p_account, q.account_id) is null then
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
          and s.account_id = coalesce(p_account, q.account_id))
  then
    raise exception 'That property is not this customer''s' using errcode = '22023';
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
  return q;
end;
$function$;

revoke all on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
