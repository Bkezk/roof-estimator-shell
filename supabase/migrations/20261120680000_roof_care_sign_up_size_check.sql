-- Roof Care: the typed roof size is checked against the map at the sign-up, and plainer words
-- for a size or a drive that cannot be right (break test Nov 20, numbers 4 and 29).
--
-- Until now the typed size was believed: a property the map measures far larger could be
-- signed at 1 sq ft, by anyone, and the plan was saved at the smallest price.
--
-- Now, when the property has a size from the map (crm_sites.map_roof_sqft, 500 sq ft or more):
--   * a typed size more than 20% smaller is refused, for a technician and the office alike,
--     in words that give both sizes;
--   * a manager or an admin may go on after ticking that the typed size is right
--     (p_size_ok). Their name and the day are kept on the plan (size_confirmed_by_name,
--     size_confirmed_on);
--   * a larger typed size is always taken (a property can have more roofs than the one the
--     map found).
-- When the map has no size for the property (not found, or no address), the typed size is
-- taken as before and the plan is marked size_unchecked: "roof size typed by hand, not checked
-- against the map". It stays so until a manager or an admin confirms it
-- (roof_care_confirm_size). A renewal keeps its plan's size and its mark.
--
-- Number 29: a size of 0 or below, and a drive below zero, were answered "the plan prices are
-- not set up yet". Each now has its own words.
--
-- The older roof_care_sign_up() would skip this check; no signed-in person can run it any more
-- (20261120630000_roof_care_rights.sql).

-- One more argument than before (p_size_ok), so the older function goes: a page published
-- before this still calls it by its names, and gets the new rule.
drop function if exists public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text);

create or replace function public.roof_care_sign_up_await_payment(
  p_site uuid, p_plan text, p_sqft numeric, p_hours numeric, p_miles numeric,
  p_estimated boolean, p_first text, p_days integer, p_agreed_by text, p_notes text,
  p_terms text, p_pay_method text default null, p_pay_note text default null,
  p_size_ok boolean default false)
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
  if p_first is null or p_first not in ('now', 'days', 'window') then
    raise exception 'Pick when the first inspection is';
  end if;
  if p_first = 'days' and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'Type how many days to push the first inspection back (1 to 365)';
  end if;
  if p_pay_method is not null and p_pay_method not in ('check', 'card') then
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

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  select coalesce(nullif(s.data->'plans'->p_plan->>'allowance', '')::numeric, 0),
         case when p_plan = 'guard'
              then least(greatest(round(coalesce(
                     nullif(s.data->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 24)
              else 0 end
    into v_allowance, v_calls
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  insert into public.roof_care_plans (
    account_id, site_id, plan, status, pay_first, plan_number, signed_on, renews_on,
    roof_sqft, drive_hours, drive_miles, price_estimated, list_price, travel_price, price,
    first_visit, first_days, agreed_by, sold_by, sold_by_name, notes, terms_version,
    repair_allowance, free_travel_calls, pay_method, pay_note,
    size_map_sqft, size_unchecked, size_confirmed_on, size_confirmed_by_name)
  values (
    v_site.account_id, p_site, p_plan, 'awaiting_payment', true,
    nextval('public.roof_care_plan_number_seq')::integer, v_today,
    (v_today + interval '1 year')::date,
    p_sqft, p_hours, p_miles, coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, case when p_first = 'days' then p_days end, trim(p_agreed_by),
    auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''), trim(p_terms),
    greatest(coalesce(v_allowance, 0), 0), coalesce(v_calls, 0),
    p_pay_method, nullif(trim(coalesce(p_pay_note, '')), ''),
    v_map, v_map is null,
    case when v_confirmed then v_today end,
    case when v_confirmed then coalesce(v_name, '') end)
  returning id into v_plan;
  return v_plan;
end;
$function$;

revoke all on function public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text,
  boolean) from public, anon;
grant execute on function public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text,
  boolean) to authenticated;

-- ── A manager confirms a size that was not checked against the map ──────────────────────────
create or replace function public.roof_care_confirm_size(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin confirms a plan''s roof size' using errcode = '42501';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_plans
     set size_unchecked = false,
         size_confirmed_on = (now() at time zone 'America/New_York')::date,
         size_confirmed_by_name = coalesce(v_name, ''),
         updated_at = now()
   where id = p_plan and size_unchecked;
  if not found then
    raise exception 'That plan was not found, or its roof size is not waiting to be confirmed';
  end if;
end;
$function$;

revoke all on function public.roof_care_confirm_size(uuid) from public, anon;
grant execute on function public.roof_care_confirm_size(uuid) to authenticated;

notify pgrst, 'reload schema';
