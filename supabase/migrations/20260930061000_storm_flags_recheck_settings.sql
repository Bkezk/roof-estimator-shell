-- match_storm_reports() (20260928150000_storm_reports.sql) chose each building's latest hit, and
-- decided which flags to clear, from every stored hit in the window without checking the report
-- against today's settings. Hits are kept until the 30-day prune, so after an admin tightened a
-- threshold, the radius or the watched states ("Changes apply from the next refresh"), the next
-- refresh still flagged buildings from hits that no longer count. Both steps now apply the same
-- rule as the matching loop: a watched state, the kind's minimum, and the hit within the kind's
-- radius. Same signature and grants; safe to re-run.

create or replace function public.match_storm_reports()
returns table (reports_in_window integer, new_hits integer, buildings_flagged integer)
language plpgsql security definer set search_path = public as $$
declare
  s public.storm_settings%rowtype;
  r record;
  radius numeric;
  n_reports integer := 0;
  n_new integer := 0;
  n_flagged integer := 0;
  inserted integer;
begin
  if not (auth.role() = 'service_role' or public.has_access('prospect')) then
    raise exception 'Prospecting access required';
  end if;
  select * into s from public.storm_settings where id = 1;
  for r in
    select * from public.storm_reports
     where report_date >= current_date - s.window_days
       and state = any(s.states)
       and ((kind = 'hail' and magnitude is not null and magnitude >= s.min_hail_in)
         or (kind = 'wind' and (magnitude is null or magnitude >= s.min_wind_mph))
         or kind = 'tornado')
  loop
    n_reports := n_reports + 1;
    radius := case r.kind when 'hail' then s.hail_radius_mi when 'wind' then s.wind_radius_mi else s.tornado_radius_mi end;
    insert into public.building_storm_hits (building_id, report_id, distance_mi)
    select b.id, r.id, round(public.miles_between(r.lat, r.lng, b.centroid_lat, b.centroid_lng)::numeric, 2)
      from public.buildings b
     where b.deleted_at is null
       and b.centroid_lat between r.lat - radius / 69.0 and r.lat + radius / 69.0
       and b.centroid_lng between r.lng - radius / (69.0 * cos(radians(r.lat))) and r.lng + radius / (69.0 * cos(radians(r.lat)))
       and public.miles_between(r.lat, r.lng, b.centroid_lat, b.centroid_lng) <= radius
    on conflict do nothing;
    get diagnostics inserted = row_count;
    n_new := n_new + inserted;
  end loop;

  -- Latest hit in the window per building that still counts under today's settings; the newest
  -- date wins, then the bigger magnitude, then the nearer report.
  with latest as (
    select distinct on (h.building_id) h.building_id, sr.report_date, sr.kind, sr.magnitude, h.distance_mi
      from public.building_storm_hits h
      join public.storm_reports sr on sr.id = h.report_id
     where sr.report_date >= current_date - s.window_days
       and sr.state = any(s.states)
       and ((sr.kind = 'hail' and sr.magnitude is not null and sr.magnitude >= s.min_hail_in)
         or (sr.kind = 'wind' and (sr.magnitude is null or sr.magnitude >= s.min_wind_mph))
         or sr.kind = 'tornado')
       and h.distance_mi <= case sr.kind when 'hail' then s.hail_radius_mi
                                         when 'wind' then s.wind_radius_mi
                                         else s.tornado_radius_mi end
     order by h.building_id, sr.report_date desc, sr.magnitude desc nulls last, h.distance_mi asc
  )
  update public.buildings b
     set last_storm_at = l.report_date, last_storm_kind = l.kind,
         last_storm_magnitude = l.magnitude, last_storm_miles = l.distance_mi
    from latest l
   where b.id = l.building_id
     and (b.last_storm_at is distinct from l.report_date or b.last_storm_kind is distinct from l.kind
          or b.last_storm_magnitude is distinct from l.magnitude or b.last_storm_miles is distinct from l.distance_mi);
  -- No hit that counts (fell out of the window, or the settings were tightened): clear the flag.
  update public.buildings b
     set last_storm_at = null, last_storm_kind = null, last_storm_magnitude = null, last_storm_miles = null
   where b.last_storm_at is not null
     and not exists (
       select 1 from public.building_storm_hits h join public.storm_reports sr on sr.id = h.report_id
        where h.building_id = b.id
          and sr.report_date >= current_date - s.window_days
          and sr.state = any(s.states)
          and ((sr.kind = 'hail' and sr.magnitude is not null and sr.magnitude >= s.min_hail_in)
            or (sr.kind = 'wind' and (sr.magnitude is null or sr.magnitude >= s.min_wind_mph))
            or sr.kind = 'tornado')
          and h.distance_mi <= case sr.kind when 'hail' then s.hail_radius_mi
                                            when 'wind' then s.wind_radius_mi
                                            else s.tornado_radius_mi end);
  select count(*) into n_flagged from public.buildings where deleted_at is null and last_storm_at is not null;

  delete from public.storm_reports where report_date < current_date - 30;
  return query select n_reports, n_new, n_flagged;
end $$;
revoke all on function public.match_storm_reports() from public;
grant execute on function public.match_storm_reports() to authenticated, service_role;
