-- A renewal's plan year starts the day AFTER the old year's last day (owner, Nov 23).
--
-- The audit of Nov 23 found one day covered twice: the old year covers its last day (renews_on),
-- and a renewal paid ahead started on that same day. The owner: "start the new year the day
-- after". So:
--
--   * roof_care_start: a renewal paid on or before the old year's last day starts the day after
--     it, and ends on the same date one year on from the old year's last day. The renewal date
--     therefore stays the same date every year. A renewal paid late starts on its payment and
--     runs twelve months from it, as before.
--   * roof_care_renewal_offer: an inspection carried into the new year is owed for 60 days from
--     that first day, so "carried until" moves with it.
--
-- Nothing else changes. Both bodies are the live ones with these lines changed.

create or replace function public.roof_care_start(p_plan uuid, p_paid date)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_p public.roof_care_plans%rowtype;
  v_old public.roof_care_plans%rowtype;
  v_renewal boolean := false;
  v_paid date;
  v_start date;
  v_day date;
  v_days integer;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
begin
  select * into v_p from public.roof_care_plans where id = p_plan for update;
  if not found or v_p.status <> 'awaiting_payment' then
    return;
  end if;
  -- The plan year starts the day the payment was received: never a day still to come, and
  -- never before the day the plan was signed. The inspections are dated from the day it is
  -- recorded, so none starts out already late.
  v_paid := greatest(least(coalesce(p_paid, v_today), v_today), coalesce(v_p.signed_on, v_today));
  v_start := v_paid;
  if v_p.renewed_from is not null then
    select * into v_old from public.roof_care_plans where id = v_p.renewed_from for update;
    v_renewal := found and (v_old.status = 'active'
                            or (v_old.status = 'ended' and v_old.ended_reason = 'Expired'));
  end if;
  if v_renewal then
    -- A renewal paid ahead starts the day after the old year's last day (owner, Nov 23: "start
    -- the new year the day after"): the old year covers its last day, so no day is covered by
    -- both. Paid late, it starts on the payment.
    v_start := greatest(v_paid, v_old.renews_on + 1);
    -- Paid ahead, the new year ends on the same date as every year before it: the renewal date
    -- does not creep a day later each year.
    if v_paid <= v_old.renews_on then
      v_renews := (v_old.renews_on + interval '1 year')::date;
    end if;
    if v_p.renewal_choice = 'full' then
      -- The customer kept us off the roof: the inspection comes along, owed for 60 more days.
      update public.roof_care_visits v
         set plan_id = p_plan, kind = 'carried', carried_from = v_old.id,
             due_from = least(v.due_from, v_start + 60), due_by = v_start + 60
       where v.id in (select o.id from public.roof_care_owed(v_old.id) o);
    end if;
    -- The old year is over. An inspection of it that was not carried is dropped: its ticket
    -- nobody had started is taken off the board. A storm inspection asked for stays.
    update public.roof_care_plans
       set status = 'ended', ended_on = coalesce(ended_on, v_today), ended_reason = 'Renewed',
           ended_by_name = 'Roof Care plans', updated_at = now()
     where id = v_old.id;
    with gone as (
      update public.service_jobs sj
         set deleted_at = now(), updated_by_name = 'Roof Care plans'
       where sj.roof_care_visit_id in (
               select v.id from public.roof_care_visits v
                where v.plan_id = v_old.id and v.kind in ('visit1', 'visit2'))
         and sj.deleted_at is null
         and sj.stage in ('open', 'scheduled')
         and sj.en_route_at is null and sj.on_site_at is null and sj.completed_at is null
         and sj.invoice_id is null
      returning sj.id
    )
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    select g.id, 'note',
           'Taken off the board: the plan was renewed with this inspection not done'
             || case when coalesce(v_p.renewal_credit, 0) > 0
                     then ', and the renewal was reduced for it.' else '.' end,
           'Roof Care plans'
      from gone g;
  end if;

  if v_p.first_visit = 'now' then
    v_from := v_today; v_by := v_today;
  elsif v_p.first_visit = 'days' then
    -- The sign-up refuses a number of days whose second inspection would fall after the plan's
    -- last day. The days are counted from the payment, which can come later than the signing,
    -- so the same number can stop fitting. The payment is not refused for that: the first
    -- inspection is brought forward to the last day that still leaves room for the second.
    v_days := least(greatest(coalesce(v_p.first_days, 1), 1), 365);
    while v_days > 1
          and not public.roof_care_second_fits(
                v_today + v_days, coalesce(v_renews, (v_start + interval '1 year')::date))
    loop
      v_days := v_days - 1;
    end loop;
    v_from := v_today + v_days; v_by := v_from;
  else
    -- The window open that day when two weeks of it are left, else the next one to open.
    v_day := greatest(v_today, v_start);
    select greatest(w.w_from, v_day), w.w_to into v_from, v_by
      from public.roof_care_windows(v_day) w
     where w.w_from > v_day or w.w_to - v_day >= 13
     order by w.w_from limit 1;
  end if;
  v_renews := coalesce(v_renews, (v_start + interval '1 year')::date);
  -- The second inspection, by the sign-up's own rule (20261119200000).
  select x.f, x.t into v2_from, v2_by
    from (select greatest(w.w_from, v_from + 120) as f, w.w_to as t
            from public.roof_care_windows(v_from + 120) w) x
   where x.t - x.f >= 13
   order by x.f limit 1;
  if v2_from <= v_renews then
    v2_by := least(v2_by, greatest(v_renews, v2_from + 13));
  end if;
  -- The plan year is twelve months and no longer: it does not stretch to an inspection.

  update public.roof_care_plans
     set status = 'active', paid_on = v_paid, starts_on = v_start, renews_on = v_renews,
         first_days = case when first_visit = 'days' then v_days else first_days end,
         updated_at = now()
   where id = p_plan;
  -- Paid for already: an inspection of this plan bills nothing.
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (p_plan, 'visit1', v_from, v_by, v_by, 0),
         (p_plan, 'visit2', v2_from, v2_by, v2_by, 0);
  perform public.roof_care_make_tickets(p_plan);
end;
$function$;

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
    'carried_until', greatest(p.renews_on + 1, v_today) + 60,
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
