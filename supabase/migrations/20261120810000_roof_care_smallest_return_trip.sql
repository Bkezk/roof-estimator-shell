-- Roof Care: a return trip is never worked on less than the round trip the plan prices are
-- built on (break test Nov 20, number 11; owner, Nov 20: "go with ... 11").
--
-- The return trip charged after a visit we could not do followed the plan's own drive. A
-- property a quarter of an hour from the office was charged a few dollars for a crew sent out
-- and back, and a plan priced on a drive of 0 had no amount at all. The plan prices themselves
-- are built on a round trip no shorter than the baseline (Setup, Roof Care: "Drive the list
-- price covers"), so the return trip now uses the same floor:
--
--   hours = the larger of the plan's drive hours and the baseline hours
--   miles = the larger of the plan's drive miles and the baseline miles
--
-- Everything after that is as it was (20261120400000): the higher of what the rates come to
-- and what the trip costs us, and never zero. A plan further away than the baseline is charged
-- its own drive, as before.

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
  v_bh numeric;
  v_bm numeric;
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
  v_bh := greatest(coalesce(nullif(d->>'baseline_drive_hours', '')::numeric, 0), 0);
  v_bm := greatest(coalesce(nullif(d->>'baseline_miles', '')::numeric, 0), 0);
  -- The plan's own drive, and never less than the round trip the list price covers: a crew
  -- sent to a property next door is still a crew sent out and back.
  select greatest(coalesce(p.drive_hours, 0), v_bh), greatest(coalesce(p.drive_miles, 0), v_bm)
    into v_hours, v_miles
    from public.roof_care_plans p where p.id = p_plan;
  if not found then
    return null;
  end if;
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
grant execute on function public.roof_care_trip_charge(uuid) to service_role;

notify pgrst, 'reload schema';
