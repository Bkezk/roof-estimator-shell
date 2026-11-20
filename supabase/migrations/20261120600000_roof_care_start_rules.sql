-- Roof Care break test of Nov 20, fixes 13, 19 and 23: when a plan year starts.
--
-- 13. The plan year never starts before the day the plan was signed. A payment typed with an
--     older date used to start the year on that date: a paid date 400 days back gave a plan
--     that was already over, and the next morning run expired it. The paid day is now held
--     between the signing day and today, for the start and for the day kept on the plan. The
--     invoice keeps whatever date was typed on it.
--
-- 19. "Next window" uses a window that is open today when at least 14 days of it are left: the
--     first inspection is then due from today to that window's end. With less than 14 days
--     left, or no window open, it is the next window to open, as before. The second inspection
--     keeps its rule.
--
-- 23. A plan starts on its invoice only when the money is there. The invoice has to be for the
--     plan's price less its renewal credit, to the cent, and its payment has to cover it. An
--     invoice of another amount marked paid, or marked paid holding less than its total, is
--     refused in plain words and the plan keeps waiting. A part payment recorded the usual way
--     leaves the invoice Final, so nothing fires and the plan keeps waiting, as it did. A
--     manager's free year has no invoice and is not touched by this.

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
    -- A renewal paid ahead starts when the old year is over; paid late, on the payment.
    v_start := greatest(v_paid, v_old.renews_on);
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
           'Taken off the board: the plan was renewed with this inspection not done, and the renewal was reduced for it.',
           'Roof Care plans'
      from gone g;
  end if;

  if v_p.first_visit = 'now' then
    v_from := v_today; v_by := v_today;
  elsif v_p.first_visit = 'days' then
    v_from := v_today + coalesce(v_p.first_days, 1); v_by := v_from;
  else
    -- The window open that day when two weeks of it are left, else the next one to open.
    v_day := greatest(v_today, v_start);
    select greatest(w.w_from, v_day), w.w_to into v_from, v_by
      from public.roof_care_windows(v_day) w
     where w.w_from > v_day or w.w_to - v_day >= 13
     order by w.w_from limit 1;
  end if;
  v_renews := (v_start + interval '1 year')::date;
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
         updated_at = now()
   where id = p_plan;
  -- Paid for already: an inspection of this plan bills nothing.
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (p_plan, 'visit1', v_from, v_by, v_by, 0),
         (p_plan, 'visit2', v2_from, v2_by, v2_by, 0);
  perform public.roof_care_make_tickets(p_plan);
end;
$function$;

revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;
grant execute on function public.roof_care_start(uuid, date) to service_role;

create or replace function public.invoices_plan_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_status text;
  v_number integer;
  v_owed numeric;
begin
  if new.roof_care_plan_id is null or new.status <> 'paid'
     or (tg_op = 'UPDATE' and old.status = 'paid')
  then
    return null;
  end if;
  select p.status, p.plan_number, round(greatest(p.price - coalesce(p.renewal_credit, 0), 0), 2)
    into v_status, v_number, v_owed
    from public.roof_care_plans p where p.id = new.roof_care_plan_id for update;
  if not found or v_status <> 'awaiting_payment' then
    return null;
  end if;
  -- The money has to be there: the invoice is for the plan's own amount, and it is covered.
  if round(coalesce(new.total, 0), 2) <> v_owed then
    raise exception 'This invoice is for $% and plan RC-% costs $%. Put the invoice right, then mark it paid. The plan starts when its invoice is paid in full.',
      trim(to_char(coalesce(new.total, 0), '999,999,990.00')), v_number,
      trim(to_char(v_owed, '999,999,990.00'));
  end if;
  if coalesce(new.paid_amount, 0) + 0.005 < coalesce(new.total, 0) then
    raise exception 'Only $% of this invoice''s $% is paid. Plan RC-% starts when its invoice is paid in full.',
      trim(to_char(coalesce(new.paid_amount, 0), '999,999,990.00')),
      trim(to_char(coalesce(new.total, 0), '999,999,990.00')), v_number;
  end if;
  perform public.roof_care_start(new.roof_care_plan_id, new.paid_on);
  return null;
end;
$function$;

notify pgrst, 'reload schema';
