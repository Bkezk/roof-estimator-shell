-- Roof Care: the storm inspections a plan includes are kept on the plan (break test Nov 20,
-- number 31; owner, Nov 20: "go with ... 31").
--
-- A plan already keeps the minor repairs amount and the leak calls it was signed with. The
-- number of storm inspections was read from the settings every time, so changing the setting
-- changed what plans already sold include, in the middle of their year. It is now kept on the
-- plan when it is signed or renewed, and that is what the plan includes until it ends. A change
-- of the setting reaches new plans (and renewals, which are a new year at a new price) only.
--
-- Plans from before this: filled in once here from today's setting, which is what they have
-- been getting. Should one still have no number, the setting is read for it as before.
--
-- NOT kept on the plan, on purpose: what a return trip is charged and what a billed extra storm
-- inspection costs. Those follow today's settings, like any price of work not yet done.

alter table public.roof_care_plans
  add column if not exists storm_included integer
    check (storm_included is null or (storm_included >= 0 and storm_included <= 24));

comment on column public.roof_care_plans.storm_included is
  'Storm inspections this plan includes in its year, as signed. Null: read the setting.';

update public.roof_care_plans p
   set storm_included = case when p.plan = 'guard'
         then coalesce((select least(greatest(round(coalesce(
                nullif(s.data->>'guard_storm_inspections', '')::numeric, 0))::integer, 0), 24)
                from public.roof_care_settings s where s.id = 1), 0)
         else 0 end
 where p.storm_included is null;

create or replace function public.roof_care_storm_state(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_allowed integer;
  v_included integer;
  v_billed integer;
  v_price jsonb;
  v_watch numeric;
  v_one numeric;
  v_used numeric;
  v_left numeric;
  v_added jsonb;
begin
  select * into p from public.roof_care_plans where id = p_plan;
  if not found or p.status <> 'active' then
    raise exception 'That plan was not found, or it has ended';
  end if;
  if p.plan <> 'guard' then
    raise exception 'Only Roof Guard includes a storm inspection';
  end if;
  -- What this plan includes is what it was signed with (Nov 20): a change of the setting
  -- reaches new plans only. A plan from before the number was kept reads the setting.
  v_allowed := p.storm_included;
  if v_allowed is null then
    select greatest(round(coalesce(nullif(s.data->>'guard_storm_inspections', '')::numeric, 0))::integer, 0)
      into v_allowed
      from public.roof_care_settings s where s.id = 1;
  end if;
  select count(*) filter (where v.amount = 0), count(*) filter (where v.amount > 0)
    into v_included, v_billed
    from public.roof_care_visits v where v.plan_id = p.id and v.kind = 'storm';
  select jsonb_build_object('by_name', nullif(trim(coalesce(v.added_by_name, '')), ''),
                            'at', v.created_at)
    into v_added
    from public.roof_care_visits v
   where v.plan_id = p.id and v.kind = 'storm'
     and (v.created_at at time zone 'America/New_York')::date = v_today
   order by v.created_at desc
   limit 1;
  if v_included < coalesce(v_allowed, 0) then
    return jsonb_build_object(
      'billed', false, 'included', coalesce(v_allowed, 0), 'used', v_included,
      'billed_so_far', v_billed, 'added_today', v_added);
  end if;
  -- One inspection: half of Roof Watch (two inspections and nothing else) for this roof and drive.
  v_price := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);
  select (e->>'price')::numeric into v_watch
    from jsonb_array_elements(coalesce(v_price->'plans', '[]'::jsonb)) e
   where e->>'plan' = 'watch';
  v_one := round(v_watch / 2.0, 2);
  select coalesce(sum(-l.total), 0) into v_used
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-allowance:' || p.id::text and i.status <> 'void';
  v_left := greatest(coalesce(p.repair_allowance, 0) - greatest(v_used, 0), 0);
  return jsonb_build_object(
    'billed', true, 'included', coalesce(v_allowed, 0), 'used', v_included,
    'billed_so_far', v_billed,
    'price', v_one,
    'allowance_left', v_left,
    'plan_pays', least(v_left, v_one),
    'customer_pays', greatest(v_one - v_left, 0),
    'added_today', v_added);
end;
$function$;

revoke all on function public.roof_care_storm_state(uuid) from public, anon, authenticated;
grant execute on function public.roof_care_storm_state(uuid) to service_role;

-- The technician's read of a plan (20261120650000) gives the plan's own number too.
create or replace function public.roof_care_field_plans(p_sites uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(jsonb_agg(x.plan order by x.signed_on desc, x.created_at desc), '[]'::jsonb)
    from (
      select p.signed_on, p.created_at,
             jsonb_build_object(
               'id', p.id, 'account_id', p.account_id, 'site_id', p.site_id,
               'plan', p.plan, 'status', p.status, 'pay_first', p.pay_first,
               'plan_number', p.plan_number, 'first_visit', p.first_visit,
               'first_days', p.first_days, 'starts_on', p.starts_on, 'signed_on', p.signed_on,
               'renews_on', p.renews_on, 'roof_sqft', p.roof_sqft,
               'price_estimated', p.price_estimated,
               -- What the plan includes, as the customer was told it.
               'repair_allowance', p.repair_allowance,
               'free_travel_calls', p.free_travel_calls,
               'storm_included', p.storm_included,
               'pay_method', p.pay_method,
               'closed_out_on', p.closed_out_on, 'closed_out_reason', p.closed_out_reason,
               'renewed_from', p.renewed_from,
               'agreed_by', p.agreed_by, 'sold_by_name', p.sold_by_name,
               'ended_on', p.ended_on, 'ended_reason', p.ended_reason,
               'forecast_sent_on', p.forecast_sent_on,
               'size_unchecked', p.size_unchecked,
               'visits', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', v.id, 'kind', v.kind, 'due_from', v.due_from, 'due_by', v.due_by,
                          'first_due_by', v.first_due_by,
                          -- A storm inspection beyond the ones included: said, with no amount.
                          'extra', coalesce(v.amount, 0) > 0,
                          'push_reason', v.push_reason, 'pushed_by_name', v.pushed_by_name,
                          'customer_asked', v.customer_asked, 'lost_on', v.lost_on,
                          'skipped_on', v.skipped_on, 'skip_reason', v.skip_reason,
                          'skipped_by_name', v.skipped_by_name,
                          'drains_cleaned', v.drains_cleaned,
                          'gutters_cleaned', v.gutters_cleaned,
                          'cleaning_note', v.cleaning_note,
                          'cleaning_by_name', v.cleaning_by_name, 'cleaning_at', v.cleaning_at,
                          -- The inspection's ticket, whoever it is with: its stage is what
                          -- "done" is counted from.
                          'ticket', (
                            select jsonb_build_object(
                                     'id', j.id, 'number', j.number, 'stage', j.stage,
                                     'scheduled_date', j.scheduled_date,
                                     'completed_at', j.completed_at,
                                     'mine', (j.technician_id = auth.uid()
                                              or public.is_on_crew(j.id)))
                              from public.service_jobs j
                             where j.roof_care_visit_id = v.id and j.deleted_at is null
                             order by j.created_at
                             limit 1))
                          order by v.due_from, v.kind), '[]'::jsonb)
                   from public.roof_care_visits v
                  where v.plan_id = p.id)) as plan
        from public.roof_care_plans p
       where p.site_id = any (coalesce(p_sites, '{}'::uuid[]))
         and public.roof_care_site_seen(p.site_id)
    ) x;
$function$;

revoke all on function public.roof_care_field_plans(uuid[]) from public, anon;
grant execute on function public.roof_care_field_plans(uuid[]) to authenticated;

-- A renewal is a new year: it takes today's number, as it takes today's price.
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
  v_storms integer;
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
              else 0 end,
         case when p.plan = 'guard'
              then least(greatest(round(coalesce(
                     nullif(s.data->>'guard_storm_inspections', '')::numeric, 0))::integer, 0), 24)
              else 0 end
    into v_allowance, v_calls, v_storms
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  -- renews_on is a placeholder until the payment, as at a sign-up.
  insert into public.roof_care_plans (
    account_id, site_id, plan, status, pay_first, plan_number, signed_on, renews_on,
    roof_sqft, drive_hours, drive_miles, price_estimated, list_price, travel_price, price,
    first_visit, first_days, agreed_by, sold_by, sold_by_name, notes, terms_version,
    repair_allowance, free_travel_calls, storm_included, pay_method, pay_note, referred_by,
    renewed_from, renewal_choice, renewal_credit, renewal_owed,
    size_map_sqft, size_unchecked, size_confirmed_on, size_confirmed_by_name)
  values (
    p.account_id, p.site_id, p.plan, 'awaiting_payment', true,
    nextval('public.roof_care_plan_number_seq')::integer, v_today,
    (greatest(p.renews_on, v_today) + interval '1 year')::date,
    p.roof_sqft, p.drive_hours, p.drive_miles, p.price_estimated,
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, v_amount,
    'window', null, p.agreed_by, p.sold_by, p.sold_by_name, '', p.terms_version,
    greatest(coalesce(v_allowance, 0), 0), coalesce(v_calls, 0), coalesce(v_storms, 0),
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

revoke all on function public.roof_care_renew(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.roof_care_renew(uuid, text, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
