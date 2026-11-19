-- Roof Care: a plan is one year of coverage, and then it is over (owner, Nov 19: "the agreement
-- is for one year of coverage …, and the benefits dont roll over, if we push it back we can
-- follow the owed inspection rule", and "we need to be notified … when a plan expires so we can
-- reach out to renew").
--
-- Until now a plan stayed in force past its renewal date until someone renewed or ended it, and
-- pushing an inspection past the plan year moved the renewal date with it. Now:
--
--   1. The plan year is twelve months from the payment and no longer. Pushing an inspection back
--      does not move the renewal date: an inspection past it is "still owed", and the renewal's
--      own rule decides it.
--   2. The morning run ends a plan whose year is over as "Expired". Its minor repairs and leak
--      calls stop with it. Its inspection tickets stay: what is owed is still owed.
--   3. An expired plan can still be renewed, as long as the property has no newer plan. The new
--      year then starts the day the renewal is paid.
--   4. The office is told once (expiry_notified_at; lib/roof-care-notify.server.ts).

alter table public.roof_care_plans
  add column if not exists expiry_notified_at timestamptz;

comment on column public.roof_care_plans.expiry_notified_at is
  'When the office was told this plan expired; null until then.';

-- Each function is changed where it stands, and the change is refused if the function is not as
-- this file expects.
do $mig$
declare
  d text;
  procedure_missing constant text := 'A Roof Care function is not as this change expects: ';

  -- 1. Push back no longer moves the renewal date.
  a1 text := '     set renews_on = greatest(renews_on, v_last), updated_at = now()';
  b1 text := '     set updated_at = now()';
  -- 2. The payment starts a year of twelve months, and renews an expired plan as one in force.
  a2 text := '  v_renews := greatest(v_renews, v2_by);';
  b2 text := '  -- The plan year is twelve months and no longer: it does not stretch to an inspection.';
  a3 text := '    v_renewal := found and v_old.status = ''active'';';
  b3 text := '    v_renewal := found and (v_old.status = ''active''
                            or (v_old.status = ''ended'' and v_old.ended_reason = ''Expired''));';
  a4 text := '       set status = ''ended'', ended_on = v_today, ended_reason = ''Renewed'',';
  b4 text := '       set status = ''ended'', ended_on = coalesce(ended_on, v_today), ended_reason = ''Renewed'',';
  -- 3. An expired plan can be renewed.
  a5 text := '  if not found or p.status <> ''active'' then
    raise exception ''That plan was not found, or it is not in force'';';
  b5 text := '  if not found or not (p.status = ''active''
                       or (p.status = ''ended'' and p.ended_reason = ''Expired'')) then
    raise exception ''That plan was not found, or it cannot be renewed'';';
  a6 text := '  if v_today < p.renews_on - 60 then';
  b6 text := '  if exists (select 1 from public.roof_care_plans r
              where r.site_id = p.site_id and r.status = ''active'' and r.id <> p.id) then
    raise exception ''This property has a newer Roof Care plan'';
  end if;
  if v_today < p.renews_on - 60 then';
  -- 4. The morning run ends the plans whose year is over.
  a7 text := '    perform public.roof_care_lapse_carried();';
  b7 text := '    perform public.roof_care_expire();
    perform public.roof_care_lapse_carried();';
begin
  -- push back
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_push_back';
  if position(b1 in d) = 0 or position(a1 in d) > 0 then
    if position(a1 in d) = 0 then raise exception '%roof_care_push_back', procedure_missing; end if;
    execute replace(d, a1, b1);
  end if;
  -- start
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_start';
  if position(b4 in d) = 0 then
    if position(a2 in d) = 0 or position(a3 in d) = 0 or position(a4 in d) = 0 then
      raise exception '%roof_care_start', procedure_missing;
    end if;
    execute replace(replace(replace(d, a2, b2), a3, b3), a4, b4);
  end if;
  -- renewing
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_renew';
  if position('it cannot be renewed' in d) = 0 then
    if position(a5 in d) = 0 or position(a6 in d) = 0 then
      raise exception '%roof_care_renew', procedure_missing;
    end if;
    execute replace(replace(d, a5, b5), a6, b6);
  end if;
  -- the morning run
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'roof_care_make_tickets';
  if position('roof_care_expire' in d) = 0 then
    if position(a7 in d) = 0 then raise exception '%roof_care_make_tickets', procedure_missing; end if;
    execute replace(d, a7, b7);
  end if;
end $mig$;

-- A plan whose twelve months are over. Its inspections and their tickets are left as they are.
create or replace function public.roof_care_expire()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_n integer;
begin
  update public.roof_care_plans
     set status = 'ended', ended_on = v_today, ended_reason = 'Expired',
         ended_by_name = 'Roof Care plans', updated_at = now()
   where status = 'active' and renews_on <= v_today;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.roof_care_expire() from public, anon, authenticated;

-- The Renew box, written whole. Two changes: an expired plan can be asked about, and an
-- inspection that is not late yet does not lean the box to half off. A renewal is made up to 60
-- days ahead, when the year's second inspection is often still inside its own window: that is
-- an inspection still to do, not one we failed to do. It leans to "charged in full, the
-- inspection stays owed", and says why (default_reason).
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
  v_amount numeric;
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
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', o.kind, 'due_by', o.due_by, 'push_reason', o.push_reason,
           'customer_asked', o.customer_asked, 'late', o.due_by < v_today) order by o.kind),
           '[]'::jsonb),
         count(*), coalesce(bool_or(o.customer_asked), false),
         coalesce(bool_or(o.due_by < v_today), false)
    into v_owed, v_n, v_asked, v_late
    from public.roof_care_owed(p.id) o;
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
    'credit_if_half_off', round(v_amount * least(v_n, 2) / 2.0, 2),
    'carried_until', greatest(p.renews_on, v_today) + 60,
    'pay_method', p.pay_method,
    'has_renewal', exists (
      select 1 from public.roof_care_plans r
       where r.renewed_from = p.id and r.status <> 'ended'));
end;
$function$;

revoke all on function public.roof_care_renewal_offer(uuid) from public, anon;
grant execute on function public.roof_care_renewal_offer(uuid) to authenticated;
