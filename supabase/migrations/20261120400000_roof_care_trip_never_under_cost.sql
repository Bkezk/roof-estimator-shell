-- Roof Care: a return trip is never charged less than it costs us (owner, Nov 20: "why is it
-- charging less than it cost? didnt we figure that out?").
--
-- The two trip rate boxes of the same day start blank, and a blank left the charge at the
-- Service rates page's travel rates, which count no miles: under the trip's cost. Now the charge
-- is the higher of two amounts, with nothing to type:
--   - what the rates come to: the two boxes when either is typed, else the travel rates;
--   - what the trip costs us by the Roof Care price setup's own numbers: the whole crew's pay
--     for the hours of the round trip, and the vehicle for its miles.
-- Null only when neither can be worked out. Never zero. No amount is typed here.

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
  v_rate numeric;
  v_cost numeric;
  v_crew_cost numeric;
  v_vehicle numeric;
begin
  select s.data into d from public.roof_care_settings s where s.id = 1;
  -- The plan's own drive; one priced on the baseline drive is charged that drive.
  select coalesce(p.drive_hours, nullif(d->>'baseline_drive_hours', '')::numeric),
         coalesce(p.drive_miles, nullif(d->>'baseline_miles', '')::numeric)
    into v_hours, v_miles
    from public.roof_care_plans p where p.id = p_plan;
  v_size := greatest(coalesce(nullif(d->>'crew_size', '')::numeric, 1), 1);
  v_per_hour := greatest(coalesce(nullif(d->>'trip_charge_per_hour', '')::numeric, 0), 0);
  v_per_mile := greatest(coalesce(nullif(d->>'trip_charge_per_mile', '')::numeric, 0), 0);
  if v_per_hour > 0 or v_per_mile > 0 then
    -- The plan's own trip rate, when the owner has typed one.
    v_rate := round(coalesce(v_hours, 0) * v_per_hour + coalesce(v_miles, 0) * v_per_mile, 2);
  else
    -- Else as travel is on a service invoice: the hours at the standard travel rate of the
    -- technician and of each helper of the crew.
    select r.bill_rate into v_tech from public.service_rates r
     where r.rate_kind = 'standard' and r.role = 'tech' and r.time_kind = 'travel';
    select r.bill_rate into v_helper from public.service_rates r
     where r.rate_kind = 'standard' and r.role = 'helper' and r.time_kind = 'travel';
    if coalesce(v_hours, 0) > 0 and coalesce(v_tech, 0) > 0
       and (v_size = 1 or coalesce(v_helper, 0) > 0) then
      v_rate := round(v_hours * (v_tech + (v_size - 1) * coalesce(v_helper, 0)), 2);
    end if;
  end if;
  -- What the trip costs us: the whole crew for the hours, the vehicle for the miles.
  v_crew_cost := nullif(d->>'crew_cost_per_hour', '')::numeric;
  v_vehicle := nullif(d->>'vehicle_cost_per_mile', '')::numeric;
  if coalesce(v_hours, 0) > 0 and coalesce(v_crew_cost, 0) > 0 then
    v_cost := round(v_hours * v_size * v_crew_cost + coalesce(v_miles, 0) * coalesce(v_vehicle, 0), 2);
  end if;
  -- The higher of the two. greatest() passes over the one that could not be worked out.
  return nullif(greatest(nullif(v_rate, 0), nullif(v_cost, 0)), 0);
end;
$function$;

revoke all on function public.roof_care_trip_charge(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
