-- The statewide loader hit the API statement timeout (about 8 s) on whole-county steps:
-- matching 4,000 footprints to addresses, promoting points, trimming. Each step now takes a
-- p_limit and does that many rows per call; callers loop until a call returns fewer than the
-- limit. Same results, short statements, and the app stays responsive during a load.

-- The old two-argument versions must go first: a new signature would otherwise sit beside them
-- as an overload and calls through the API become ambiguous.
drop function if exists public.fill_footprint_addresses(text, numeric);
drop function if exists public.promote_commercial_points(text, numeric);
drop function if exists public.trim_address_points(text, numeric);
alter table public.buildings add column if not exists address_checked_at timestamptz;

create or replace function public.fill_footprint_addresses(p_county text, p_max_m numeric default 100, p_limit integer default 400)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with todo as (
    select b.id, b.centroid_lat, b.centroid_lng, b.roof_sqft
      from public.buildings b
     where b.county = p_county
       and b.source in ('ornl', 'ky911')
       and coalesce(b.address1, '') = ''
       and b.address_checked_at is null
       and b.centroid_lat is not null and b.centroid_lng is not null
       and b.deleted_at is null
     order by b.id
     limit p_limit
  ),
  candidates as (
    select t.id as building_id,
           greatest(p_max_m, sqrt(coalesce(t.roof_sqft, 0) * 0.092903)) as radius_m,
           (
             select p.id
             from public.address_points p
             where p.county = p_county
               and coalesce(p.kind, '') <> 'other'
               and p.lat between t.centroid_lat - 0.003 and t.centroid_lat + 0.003
               and p.lng between t.centroid_lng - 0.004 and t.centroid_lng + 0.004
             order by
               ((p.lat - t.centroid_lat) * 111320) ^ 2
               + ((p.lng - t.centroid_lng) * 111320 * cos(radians(t.centroid_lat))) ^ 2
             limit 1
           ) as point_id
    from todo t
  ),
  matched as (
    select c.building_id, p.id, p.address, p.city, p.zip, p.landmark, p.kind, p.place_type
    from candidates c
    join public.address_points p on p.id = c.point_id
    join public.buildings b on b.id = c.building_id
    where sqrt(((p.lat - b.centroid_lat) * 111320) ^ 2
               + ((p.lng - b.centroid_lng) * 111320 * cos(radians(b.centroid_lat))) ^ 2) <= c.radius_m
  ),
  updated as (
    update public.buildings b
       set address1 = m.address,
           city = coalesce(b.city, m.city),
           zip = coalesce(b.zip, m.zip),
           name = case when b.name = '' and m.landmark is not null then m.landmark else b.name end,
           land_use = coalesce(b.land_use, case when m.kind = 'commercial' then m.place_type end),
           address_checked_at = now()
      from matched m
     where b.id = m.building_id
    returning b.id, m.id as point_id
  ),
  linked as (
    update public.address_points p set building_id = u.id
      from updated u where p.id = u.point_id
    returning 1
  ),
  -- Everything in this batch is stamped as checked, matched or not, so the next call moves on.
  stamped as (
    update public.buildings b set address_checked_at = now()
      from todo t where b.id = t.id and b.address_checked_at is null
    returning 1
  )
  select (select count(*) from todo) into n;
  return n;
end;
$$;

-- Buildings remember when the address matcher last looked at them; a fresh point import
-- clears the stamp on the county so they are looked at again.
alter table public.buildings add column if not exists address_checked_at timestamptz;
create index if not exists buildings_address_todo_idx
  on public.buildings (county, id) where deleted_at is null and address_checked_at is null;

create or replace function public.reset_address_checks(p_county text)
returns integer
language sql
security invoker
set search_path = public
as $$
  with u as (
    update public.buildings set address_checked_at = null
     where county = p_county and deleted_at is null and coalesce(address1, '') = ''
    returning 1
  )
  select count(*)::integer from u;
$$;
grant execute on function public.reset_address_checks(text) to authenticated;

create or replace function public.promote_commercial_points(p_county text, p_max_m numeric default 100, p_limit integer default 300)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with pts as (
    select p.*
      from public.address_points p
     where p.county = p_county and p.kind = 'commercial' and p.building_id is null
       and not exists (
         select 1 from public.buildings b
          where b.county = p_county and b.deleted_at is null
            and b.centroid_lat between p.lat - 0.003 and p.lat + 0.003
            and b.centroid_lng between p.lng - 0.004 and p.lng + 0.004
            and sqrt(((p.lat - b.centroid_lat) * 111320) ^ 2
                     + ((p.lng - b.centroid_lng) * 111320 * cos(radians(p.lat))) ^ 2)
                <= greatest(p_max_m, sqrt(coalesce(b.roof_sqft, 0) * 0.092903)))
     order by p.id
     limit p_limit
  ),
  ins as (
    insert into public.buildings as b
      (source_key, source, county, name, address1, city, zip, land_use, centroid_lat, centroid_lng,
       source_layer, imported_at, address_checked_at)
    select 'ky911:' || replace(p.source_key, 'ky911:', ''), 'ky911', p.county,
           coalesce(p.landmark, ''), p.address, p.city, p.zip, p.place_type, p.lat, p.lng,
           p.source_layer, now(), now()
      from pts p
    on conflict (source_key) do update set
      county = excluded.county,
      name = case when b.name = '' then excluded.name else b.name end,
      address1 = case when b.address1 = '' then excluded.address1 else b.address1 end,
      city = coalesce(b.city, excluded.city),
      zip = coalesce(b.zip, excluded.zip),
      land_use = coalesce(b.land_use, excluded.land_use),
      imported_at = now(),
      deleted_at = null
    returning b.id, b.source_key
  ),
  -- The promoted point is linked to its building, so it is never promoted twice and the trim keeps it.
  linked as (
    update public.address_points p set building_id = i.id
      from ins i where 'ky911:' || replace(p.source_key, 'ky911:', '') = i.source_key
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

create or replace function public.trim_address_points(p_county text, p_keep_m numeric default 100, p_limit integer default 5000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with gone as (
    delete from public.address_points p
     where p.id in (
       select id from public.address_points
        where county = p_county and coalesce(kind, '') <> 'commercial' and building_id is null
        limit p_limit)
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$$;

-- A safety net for the API role: 30 s instead of the default 8 s (RLS unchanged).
alter role authenticated set statement_timeout = '30s';
