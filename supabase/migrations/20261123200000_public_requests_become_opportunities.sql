/* Nov 23 (owner: "i like option A"): a request from a public page becomes an opportunity at once.

   Until now a request waited on a list of its own (Opportunities, Public requests) and became an
   opportunity only after someone matched it. Now:

   1. public_request_submit makes the opportunity in the same step: in the normal list, with the
      plan or the services in its title, the source "QR page", who referred them, the price the
      page showed as its value, due the next day, no customer on it yet and nobody assigned.
   2. public_request_handle, when the office says whose the request is, puts that customer and
      property on the request's opportunity too.
   3. The request follows its opportunity: deleting the opportunity before anyone said whose it
      is dismisses the request, restoring it puts the request back, and a customer picked on the
      opportunity's own form counts as the match.

   Nothing is granted to anyone new: the two functions keep their callers (the site's own server
   for the first, signed-in people with Customers access for the second). */

/* A visitor's request, checked again and kept, and its opportunity made. */
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
  v_id uuid;
  v_opp uuid;
  v_from text;
  v_plan_name text;
  v_ask text;
  v_title text;
  v_desc text;
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
      || case when v_several then ', several buildings' else '' end;
    v_title := v_from || ': Roof Care custom quote';
  elsif v_kind = 'care' then
    v_ask := v_plan_name;
    v_title := v_from || ': ' || v_plan_name || ' plan';
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

revoke all on function public.public_request_submit(text, jsonb) from public, anon, authenticated;
grant execute on function public.public_request_submit(text, jsonb) to service_role;

/* The office's answer to a request. Matched: its opportunity gets the customer too. */
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
  return q;
end;
$function$;

revoke all on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text)
  to authenticated;

/* The request follows its opportunity. A request has one opportunity (public_requests.opportunity_id). */
create or replace function public.crm_opportunities_request_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    -- Deleted before anyone said whose it is: the request is not left waiting.
    update public.public_requests
       set status = 'dismissed', dismiss_reason = 'Its opportunity was deleted',
           handled_at = now(), handled_by = auth.uid(), handled_by_name = new.updated_by_name
     where opportunity_id = new.id and status = 'new';
  elsif new.deleted_at is null and old.deleted_at is not null then
    update public.public_requests
       set status = 'new', dismiss_reason = null, handled_at = null, handled_by = null,
           handled_by_name = null
     where opportunity_id = new.id and status = 'dismissed'
       and dismiss_reason = 'Its opportunity was deleted';
  end if;
  -- The customer or the property on the opportunity is the request's, until a plan is signed.
  if new.deleted_at is null and new.account_id is not null
     and (old.account_id is distinct from new.account_id
          or old.site_id is distinct from new.site_id
          or old.deleted_at is not null)
  then
    update public.public_requests
       set status = 'matched', account_id = new.account_id, site_id = new.site_id,
           handled_at = coalesce(handled_at, now()),
           handled_by = coalesce(handled_by, auth.uid()),
           handled_by_name = coalesce(handled_by_name, new.updated_by_name)
     where opportunity_id = new.id and status in ('new', 'matched')
       and roof_care_plan_id is null
       and (status = 'new' or account_id is distinct from new.account_id
            or site_id is distinct from new.site_id);
  end if;
  return null;
end;
$function$;

revoke all on function public.crm_opportunities_request_follow() from public, anon, authenticated;

drop trigger if exists crm_opportunities_request_follow on public.crm_opportunities;
create trigger crm_opportunities_request_follow
  after update of deleted_at, account_id, site_id on public.crm_opportunities
  for each row execute function public.crm_opportunities_request_follow();

create index if not exists public_requests_opportunity on public.public_requests (opportunity_id)
  where opportunity_id is not null;

notify pgrst, 'reload schema';
