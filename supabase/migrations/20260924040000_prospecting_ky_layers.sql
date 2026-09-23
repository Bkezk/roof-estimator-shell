-- Prospecting: statewide Kentucky layers (ORNL building footprints, NG911 address points,
-- facility point layers such as Ky_Schools) alongside the per-county PVA parcels.
-- Verified against the owner's samples in src/lib/gis/fixtures (2026-09-24).

-- Where a building came from. 'ornl' = building footprint, 'facility' = a state facility list
-- (schools, hospitals, …). Address points are NOT buildings (they are one per structure, mostly
-- homes) — they live in address_points and only lend an address to footprints.
alter table public.buildings drop constraint if exists buildings_source_check;
alter table public.buildings
  add constraint buildings_source_check
  check (source in ('manual','won_bid','pva','import','ornl','facility'));

-- The import's own key ("ornl:9847973", "Ky_Schools:1010") so a re-import updates, not duplicates.
alter table public.buildings add column if not exists source_key text;
create unique index if not exists buildings_source_key_uidx on public.buildings (source_key);
-- Footprint height when the layer publishes one (feet).
alter table public.buildings add column if not exists height_ft numeric;

create table if not exists public.address_points (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,           -- NG911 Site_NGUID
  county text,
  address text not null,
  city text,
  zip text,
  landmark text,
  place_type text,
  lat double precision not null,
  lng double precision not null,
  source_layer text,
  imported_at timestamptz not null default now()
);
create index if not exists address_points_county_idx on public.address_points (county);
create index if not exists address_points_lat_lng_idx on public.address_points (lat, lng);

alter table public.address_points enable row level security;
drop policy if exists "address_points read" on public.address_points;
create policy "address_points read" on public.address_points
  for select to authenticated using (public.has_access('prospect'));
drop policy if exists "address_points write" on public.address_points;
create policy "address_points write" on public.address_points
  for all to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));

-- Give every footprint in a county that has no street address the nearest 911 address point
-- within p_max_m metres (equirectangular distance; fine at this scale). Returns rows updated.
create or replace function public.fill_footprint_addresses(p_county text, p_max_m numeric default 60)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with candidates as (
    select b.id as building_id,
           (
             select p.id
             from public.address_points p
             where p.county = p_county
               and p.lat between b.centroid_lat - 0.002 and b.centroid_lat + 0.002
               and p.lng between b.centroid_lng - 0.003 and b.centroid_lng + 0.003
             order by
               ((p.lat - b.centroid_lat) * 111320) ^ 2
               + ((p.lng - b.centroid_lng) * 111320 * cos(radians(b.centroid_lat))) ^ 2
             limit 1
           ) as point_id
    from public.buildings b
    where b.county = p_county
      and b.source = 'ornl'
      and coalesce(b.address1, '') = ''
      and b.centroid_lat is not null and b.centroid_lng is not null
      and b.deleted_at is null
  ),
  matched as (
    select c.building_id, p.*
    from candidates c
    join public.address_points p on p.id = c.point_id
    join public.buildings b on b.id = c.building_id
    where sqrt(((p.lat - b.centroid_lat) * 111320) ^ 2
               + ((p.lng - b.centroid_lng) * 111320 * cos(radians(b.centroid_lat))) ^ 2) <= p_max_m
  ),
  updated as (
    update public.buildings b
       set address1 = m.address,
           city = coalesce(b.city, m.city),
           zip = coalesce(b.zip, m.zip),
           name = case when b.name = '' and m.landmark is not null then m.landmark else b.name end,
           land_use = coalesce(b.land_use, m.place_type)
      from matched m
     where b.id = m.building_id
    returning b.id
  )
  select count(*) into n from updated;
  return n;
end;
$$;
grant execute on function public.fill_footprint_addresses(text, numeric) to authenticated;
