-- Storm call points (owner, Sep 28): no history, just "has a major weather event hit this
-- building in the last week". NOAA's Storm Prediction Center publishes one CSV per day of every
-- hail, wind and tornado report (time, size or speed, county, state, lat/lon). The app pulls the
-- last window_days of files (nightly cron, and throttled when a Prospecting user opens the
-- Buildings page), keeps the Kentucky rows in storm_reports, and match_storm_reports() marks
-- every building within the radius of a report that clears the thresholds. buildings.last_storm_*
-- is the denormalised "latest hit in the window" the list filters and sorts on; hits and reports
-- older than 30 days are pruned, so nothing accumulates.

create table if not exists public.storm_settings (
  id integer primary key default 1 check (id = 1),
  window_days integer not null default 7 check (window_days between 1 and 30),
  min_hail_in numeric not null default 1.0 check (min_hail_in >= 0),
  min_wind_mph numeric not null default 58 check (min_wind_mph >= 0),
  hail_radius_mi numeric not null default 3 check (hail_radius_mi between 0.25 and 25),
  wind_radius_mi numeric not null default 3 check (wind_radius_mi between 0.25 and 25),
  tornado_radius_mi numeric not null default 5 check (tornado_radius_mi between 0.25 and 25),
  states text[] not null default '{KY}',
  last_fetch_at timestamptz,
  last_fetch_note text,
  updated_at timestamptz not null default now()
);
insert into public.storm_settings (id) values (1) on conflict (id) do nothing;
alter table public.storm_settings enable row level security;
drop policy if exists storm_settings_read on public.storm_settings;
create policy storm_settings_read on public.storm_settings for select to authenticated using (true);
drop policy if exists storm_settings_write on public.storm_settings;
create policy storm_settings_write on public.storm_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.storm_reports (
  id bigserial primary key,
  report_date date not null,
  kind text not null check (kind in ('hail','wind','tornado')),
  report_time text not null default '',
  -- hail: inches; wind: mph; tornado: EF number. Null = the report says UNK.
  magnitude numeric,
  location text,
  county text,
  state text not null,
  lat double precision not null,
  lng double precision not null,
  comments text,
  fetched_at timestamptz not null default now(),
  unique (report_date, kind, report_time, lat, lng)
);
create index if not exists storm_reports_date_idx on public.storm_reports (report_date desc);
alter table public.storm_reports enable row level security;
drop policy if exists storm_reports_read on public.storm_reports;
create policy storm_reports_read on public.storm_reports for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate') or public.has_access('customers'));
drop policy if exists storm_reports_write on public.storm_reports;
create policy storm_reports_write on public.storm_reports for all to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));

create table if not exists public.building_storm_hits (
  building_id uuid not null references public.buildings(id) on delete cascade,
  report_id bigint not null references public.storm_reports(id) on delete cascade,
  distance_mi numeric not null,
  primary key (building_id, report_id)
);
create index if not exists building_storm_hits_report_idx on public.building_storm_hits (report_id);
alter table public.building_storm_hits enable row level security;
drop policy if exists building_storm_hits_read on public.building_storm_hits;
create policy building_storm_hits_read on public.building_storm_hits for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate') or public.has_access('customers'));

alter table public.buildings
  add column if not exists last_storm_at date,
  add column if not exists last_storm_kind text,
  add column if not exists last_storm_magnitude numeric,
  add column if not exists last_storm_miles numeric;
create index if not exists buildings_storm_idx on public.buildings (last_storm_at desc)
  where deleted_at is null and last_storm_at is not null;
-- The matcher scans a lat/lng box per report; the existing index leads with county.
create index if not exists buildings_centroid_idx on public.buildings (centroid_lat, centroid_lng)
  where deleted_at is null;

-- Great-circle miles between two points.
create or replace function public.miles_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 3958.8 * acos(least(1.0, greatest(-1.0,
    cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2 - lng1))
    + sin(radians(lat1)) * sin(radians(lat2)))));
$$;

-- Mark the buildings near each qualifying report in the window, refresh buildings.last_storm_*,
-- and prune reports older than 30 days. SECURITY DEFINER: runs for the cron's service role and
-- for a Prospecting user (who may not update other columns of buildings under RLS).
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

  -- Latest hit in the window per building; hail beats wind beats tornado on the same day only
  -- by magnitude order, the newest date always wins.
  with latest as (
    select distinct on (h.building_id) h.building_id, sr.report_date, sr.kind, sr.magnitude, h.distance_mi
      from public.building_storm_hits h
      join public.storm_reports sr on sr.id = h.report_id
     where sr.report_date >= current_date - s.window_days
     order by h.building_id, sr.report_date desc, sr.magnitude desc nulls last, h.distance_mi asc
  )
  update public.buildings b
     set last_storm_at = l.report_date, last_storm_kind = l.kind,
         last_storm_magnitude = l.magnitude, last_storm_miles = l.distance_mi
    from latest l
   where b.id = l.building_id
     and (b.last_storm_at is distinct from l.report_date or b.last_storm_kind is distinct from l.kind
          or b.last_storm_magnitude is distinct from l.magnitude or b.last_storm_miles is distinct from l.distance_mi);
  -- Fell out of the window: clear the flag.
  update public.buildings b
     set last_storm_at = null, last_storm_kind = null, last_storm_magnitude = null, last_storm_miles = null
   where b.last_storm_at is not null
     and not exists (
       select 1 from public.building_storm_hits h join public.storm_reports sr on sr.id = h.report_id
        where h.building_id = b.id and sr.report_date >= current_date - s.window_days);
  select count(*) into n_flagged from public.buildings where deleted_at is null and last_storm_at is not null;

  delete from public.storm_reports where report_date < current_date - 30;
  return query select n_reports, n_new, n_flagged;
end $$;
revoke all on function public.match_storm_reports() from public;
grant execute on function public.match_storm_reports() to authenticated, service_role;

-- Who gets the "storm hit N buildings" note: every Prospecting login (admins included).
create or replace function public.prospect_user_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where (p.role = 'admin' or 'prospect' = any(p.access))
     and (auth.role() = 'service_role' or public.has_access('prospect'));
$$;
revoke all on function public.prospect_user_ids() from public;
grant execute on function public.prospect_user_ids() to authenticated, service_role;

-- The fetch stamp is written by the throttled in-app pass as a Prospecting user.
create or replace function public.stamp_storm_fetch(note text)
returns void language sql security definer set search_path = public as $$
  update public.storm_settings set last_fetch_at = now(), last_fetch_note = note where id = 1
    and (auth.role() = 'service_role' or public.has_access('prospect'));
$$;
revoke all on function public.stamp_storm_fetch(text) from public;
grant execute on function public.stamp_storm_fetch(text) to authenticated, service_role;

-- Flagged buildings per county, for the "Storms this week" panel (RLS applies).
create or replace function public.building_county_counts_storm()
returns table (county text, n bigint) language sql stable security invoker set search_path = public as $$
  select b.county, count(*) from public.buildings b
   where b.deleted_at is null and b.last_storm_at is not null
   group by b.county;
$$;
revoke all on function public.building_county_counts_storm() from public;
grant execute on function public.building_county_counts_storm() to authenticated, service_role;
