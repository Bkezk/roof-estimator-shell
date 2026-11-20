-- Roof Care: a trip rate of the plan's own for a return trip after a visit we could not do
-- (owner, Nov 20: "go"). Until now the charge was the hours of the plan's round trip at the
-- Service rates page's travel rates, which count no miles and came out under what the trip
-- costs us.
--
-- Two numbers on the Roof Care price setup, both blank until the owner types them:
--   trip_charge_per_hour   for each hour of the round trip, the whole crew
--   trip_charge_per_mile   for each mile of it
-- With either typed, the charge is the plan's own round trip at those two. With both blank the
-- travel rates are used, as before. No amount is typed here.

create or replace function public.roof_care_trip_charge(p_plan uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  d jsonb;
  v_hours numeric;
  v_miles numeric;
  v_per_hour numeric;
  v_per_mile numeric;
  v_size numeric;
  v_tech numeric;
  v_helper numeric;
  v_out numeric;
begin
  select s.data into d from public.roof_care_settings s where s.id = 1;
  -- The plan's own drive; one priced on the baseline drive is charged that drive.
  select coalesce(p.drive_hours, nullif(d->>'baseline_drive_hours', '')::numeric),
         coalesce(p.drive_miles, nullif(d->>'baseline_miles', '')::numeric)
    into v_hours, v_miles
    from public.roof_care_plans p where p.id = p_plan;
  v_per_hour := greatest(coalesce(nullif(d->>'trip_charge_per_hour', '')::numeric, 0), 0);
  v_per_mile := greatest(coalesce(nullif(d->>'trip_charge_per_mile', '')::numeric, 0), 0);
  -- The plan's own trip rate, when the owner has typed one.
  if v_per_hour > 0 or v_per_mile > 0 then
    v_out := round(coalesce(v_hours, 0) * v_per_hour + coalesce(v_miles, 0) * v_per_mile, 2);
    -- Never zero: a plan with no drive on file cannot be worked out.
    return case when v_out > 0 then v_out end;
  end if;
  -- Else as travel is on a service invoice: the hours at the standard travel rate of the
  -- technician and of each helper of the crew.
  v_size := greatest(coalesce(nullif(d->>'crew_size', '')::numeric, 1), 1);
  select r.bill_rate into v_tech from public.service_rates r
   where r.rate_kind = 'standard' and r.role = 'tech' and r.time_kind = 'travel';
  select r.bill_rate into v_helper from public.service_rates r
   where r.rate_kind = 'standard' and r.role = 'helper' and r.time_kind = 'travel';
  if coalesce(v_hours, 0) <= 0 or coalesce(v_tech, 0) <= 0
     or (v_size > 1 and coalesce(v_helper, 0) <= 0) then
    return null;
  end if;
  return round(v_hours * (v_tech + (v_size - 1) * coalesce(v_helper, 0)), 2);
end;
$function$;

revoke all on function public.roof_care_trip_charge(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
