-- Roof Care: a renewal's answer against the rule is a manager's, and a plan that ended more
-- than 60 days ago renews with nothing owed (break test Nov 20, number 9).
--
-- Until now, with an inspection still owed, anyone in the office could pick either answer: an
-- office user took the price of an inspection off a renewal whose own rule said "charge in
-- full". And a plan that had expired more than a year before was renewed with the credit for
-- an inspection of a year long over.
--
-- Now:
--   * the rule's own answer (roof_care_renewal_offer's default_choice: half off only for an
--     inspection that is late with no push-back saying the customer asked) is what an office
--     user gets. The other answer needs a manager or an admin, and the refusal says so. The
--     offer says who may change it (can_change);
--   * a plan that ended more than 60 days ago is renewed at the full price, with no credit for
--     an inspection not done and nothing carried into the new year, whoever asks (the offer
--     says lapsed, and how many inspections that leaves behind: lapsed_owed);
--   * a renewal keeps its plan's roof size and what the sign-up kept about it (number 4).

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
  v_late boolean;
  v_watch numeric;
  v_amount numeric;
  v_lapsed boolean;
  v_left integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office renews a Roof Care plan' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan;
  if not found or not (p.status = 'active'
                       or (p.status = 'ended' and p.ended_reason = 'Expired')) then
    raise exception 'That plan was not found, or it cannot be renewed';
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
  -- One inspection: half of Roof Watch (two inspections and nothing else) for this roof and drive.
  select (e->>'price')::numeric into v_watch
    from jsonb_array_elements(v_price->'plans') e where e->>'plan' = 'watch';
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', o.kind, 'due_by', o.due_by, 'push_reason', o.push_reason,
           'customer_asked', o.customer_asked, 'late', o.due_by < v_today) order by o.kind),
           '[]'::jsonb),
         count(*), coalesce(bool_or(o.customer_asked), false),
         coalesce(bool_or(o.due_by < v_today), false)
    into v_owed, v_n, v_asked, v_late
    from public.roof_care_owed(p.id) o;
  -- Ended more than 60 days ago: nothing of the old year is credited or carried.
  v_lapsed := p.status = 'ended' and v_today > coalesce(p.ended_on, p.renews_on) + 60;
  if v_lapsed then
    v_left := v_n;
    v_n := 0;
    v_owed := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'plan', p.plan,
    'renews_on', p.renews_on,
    'opens_on', p.renews_on - 60,
    'open', v_today >= p.renews_on - 60,
    'expired', p.status = 'ended',
    'price', v_amount,
    'price_was', p.price,
    'owed', v_owed,
    'owed_count', v_n,
    -- Half off only for an inspection that is late with no push-back saying the customer asked.
    'default_choice', case when v_n = 0 then null
                           when v_asked or not v_late then 'full' else 'half_off' end,
    'default_reason', case when v_n = 0 then null when v_asked then 'customer'
                           when not v_late then 'not_late' else 'late' end,
    'credit_if_half_off', case when v_n = 0 then 0
                               else least(v_amount, round(v_watch * least(v_n, 2) / 2.0, 2)) end,
    'carried_until', greatest(p.renews_on, v_today) + 60,
    'pay_method', p.pay_method,
    'has_renewal', exists (
      select 1 from public.roof_care_plans r
       where r.renewed_from = p.id and r.status <> 'ended'),
    -- Who may pick the answer the rule did not: a manager or an admin.
    'can_change', public.is_admin() or public.is_manager(),
    'lapsed', v_lapsed,
    'lapsed_owed', v_left,
    'ended_on', case when p.status = 'ended' then coalesce(p.ended_on, p.renews_on) end);
end;
$function$;

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
  v_watch numeric;
  v_allowance numeric;
  v_calls integer;
  v_new uuid;
  v_asked boolean;
  v_late boolean;
  v_default text;
  v_choice text := p_choice;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office renews a Roof Care plan' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found or not (p.status = 'active'
                       or (p.status = 'ended' and p.ended_reason = 'Expired')) then
    raise exception 'That plan was not found, or it cannot be renewed';
  end if;
  if exists (select 1 from public.roof_care_plans r
              where r.site_id = p.site_id and r.status = 'active' and r.id <> p.id) then
    raise exception 'This property has a newer Roof Care plan';
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
  -- One inspection: half of Roof Watch (two inspections and nothing else) for this roof and drive.
  select (e->>'price')::numeric into v_watch
    from jsonb_array_elements(v_price->'plans') e where e->>'plan' = 'watch';
  -- The renewal is saved at the price the box showed, or not at all.
  if p_shown_price is not null and round(p_shown_price) <> round(v_amount) then
    raise exception 'The price changed: this plan is now $%, not the $% shown. The prices have been read again. Check them with the customer and press again.',
      trim(to_char(round(v_amount), '999,999,990')), trim(to_char(round(p_shown_price), '999,999,990'));
  end if;
  select count(*), coalesce(bool_or(o.customer_asked), false),
         coalesce(bool_or(o.due_by < v_today), false)
    into v_n, v_asked, v_late
    from public.roof_care_owed(p.id) o;
  -- Ended more than 60 days ago: the full price, no credit, nothing carried, whoever asks.
  if p.status = 'ended' and v_today > coalesce(p.ended_on, p.renews_on) + 60 then
    v_n := 0;
    v_choice := null;
  end if;
  if v_n > 0 then
    if v_choice is null or v_choice not in ('half_off', 'full') then
      raise exception 'Pick what happens with the inspection that is still owed';
    end if;
    -- The rule's own answer, as roof_care_renewal_offer() gives it. The other one is a
    -- manager's or an admin's.
    v_default := case when v_asked or not v_late then 'full' else 'half_off' end;
    if v_choice <> v_default and not (public.is_admin() or public.is_manager()) then
      if v_default = 'full' then
        raise exception 'This renewal is charged in full, and the inspection still owed stays owed: %. Taking its price off instead is for a manager or an admin. Renew it charged in full, or ask one of them to renew it.',
          case when v_asked then 'a push-back of it was marked as the customer asking'
               else 'it is not late yet' end
          using errcode = '42501';
      end if;
      raise exception 'This renewal has the price of the inspection not done taken off: it is late, and no push-back says the customer asked. Charging it in full instead is for a manager or an admin. Renew it with the price taken off, or ask one of them to renew it.'
        using errcode = '42501';
    end if;
    if v_choice = 'half_off' then
      v_credit := least(v_amount, round(v_watch * least(v_n, 2) / 2.0, 2));
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
    renewed_from, renewal_choice, renewal_credit, renewal_owed,
    size_map_sqft, size_unchecked, size_confirmed_on, size_confirmed_by_name)
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
    p.id, case when v_n > 0 then v_choice end, v_credit, v_n,
    p.size_map_sqft, p.size_unchecked, p.size_confirmed_on, p.size_confirmed_by_name)
  returning id into v_new;
  -- Nothing to pay: the new year starts by itself, with no invoice.
  if v_credit >= v_amount then
    perform public.roof_care_start(v_new, v_today);
  end if;
  return v_new;
end;
$function$;

notify pgrst, 'reload schema';
