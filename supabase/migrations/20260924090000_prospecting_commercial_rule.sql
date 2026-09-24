-- Prospecting: statewide load rules (owner, Sep 24).
--   * An import never overwrites what a person typed or an earlier match filled in.
--   * "Commercial" = footprint >= the size floor (5,000 sq ft) OR a 911 address point whose
--     place type / landmark name reads commercial, whatever the size. Houses are excluded by
--     word; the county vocabularies are free text, so the rule is word-based and forgiving.
--   * Address points keep only what matched or sits near a building (trim), and carry `kind`.

-- 1. Sources: ky911 = a building promoted from a named / typed address point.
alter table public.buildings drop constraint if exists buildings_source_check;
alter table public.buildings
  add constraint buildings_source_check
  check (source in ('manual','won_bid','pva','import','ornl','facility','ky911'));

-- 2. Upsert that keeps typed data. Keyed on source_key. Geometry, size, county and stamps
--    refresh; name / address / city / zip / land_use fill only when empty.
create or replace function public.upsert_buildings(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with src as (
    select *
      from jsonb_to_recordset(rows) as r(
        source_key text, source text, county text, name text, address1 text, city text, zip text,
        land_use text, roof_sqft numeric, perimeter_ft numeric, height_ft numeric,
        footprint jsonb, centroid_lat double precision, centroid_lng double precision,
        source_layer text, created_by uuid, created_by_name text)
  ),
  up as (
    insert into public.buildings as b
      (source_key, source, county, name, address1, city, zip, land_use, roof_sqft, perimeter_ft,
       height_ft, footprint, centroid_lat, centroid_lng, source_layer, imported_at, deleted_at,
       created_by, created_by_name)
    select source_key, source, county, coalesce(name,''), coalesce(address1,''), city, zip,
           land_use, roof_sqft, perimeter_ft, height_ft, footprint, centroid_lat, centroid_lng,
           source_layer, now(), null, created_by, created_by_name
      from src
      where source_key is not null
    on conflict (source_key) do update set
      county       = coalesce(excluded.county, b.county),
      name         = case when b.name = '' then coalesce(excluded.name, '') else b.name end,
      address1     = case when b.address1 = '' then coalesce(excluded.address1, '') else b.address1 end,
      city         = coalesce(b.city, excluded.city),
      zip          = coalesce(b.zip, excluded.zip),
      land_use     = coalesce(b.land_use, excluded.land_use),
      roof_sqft    = coalesce(excluded.roof_sqft, b.roof_sqft),
      perimeter_ft = coalesce(excluded.perimeter_ft, b.perimeter_ft),
      height_ft    = coalesce(excluded.height_ft, b.height_ft),
      footprint    = coalesce(excluded.footprint, b.footprint),
      centroid_lat = coalesce(excluded.centroid_lat, b.centroid_lat),
      centroid_lng = coalesce(excluded.centroid_lng, b.centroid_lng),
      source_layer = coalesce(excluded.source_layer, b.source_layer),
      imported_at  = now(),
      deleted_at   = null
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$$;
grant execute on function public.upsert_buildings(jsonb) to authenticated;

-- 3. What a 911 place type / landmark says: commercial, residential, other (not a roof) or
--    null (untyped). Word-based: counties type "Commercial - Retail", "COMM", "Commercail",
--    "BEVERLYS TP", "CoWOOWOO"…  A landmark name alone counts as commercial (schools,
--    churches, dealerships, motels are the names that get typed).
create or replace function public.classify_place(place_type text, landmark text)
returns text
language sql
immutable
as $$
  select case
    -- "Residential - Garage or Shop", "Residence-Cabin": the county said so.
    when p ~ '^\s*(resid|resd|reisd|resit|residence)' then 'residential'
    -- Businesses first, so "HOME IMPROVEMENT", "MOBILE HOME SALES", "FUNERAL HOME", "BUSINESS
    -- COMPLEX", "GAS STATION", "CELL PHONE COMPANY" read as the businesses they are.
    when p ~ '(store|shop|retail|supply|improvement|decor|dealer|sales|office|market|restaur|resturant|restsurant|funeral|nursing|assisted|hospice|company|complex|clubhouse|rackhouse|gas station|fuel station|fire station|police station|radio station|train.station|sawmill|distill)'
      then 'commercial'
    when p ~ '(resid|resd|reisd|resit|single|multi|mulit|\mapt\M|apt_|apart|duplex|triplex|fourplex|sixplex|townhouse|condo|mobil|moblie|\mmh\M|swmh|dwmh|trailer|trlr|cabin|camp|\mrv\M|\mhouse\M|home\M|household|shed|barn|farm|\mag\M|agri|garage|outbuild|out build|parsonage|dwelling|\mres\M|\mresi\M|\mr\M|\mmf\M|homeless|airbnb)'
      then 'residential'
    when p ~ '(tower|\mcell|antenna|pond|lake|creek|river|gate|mile|marker|intersection|bridge|crossing|trestle|ramp|underpass|overpass|\mlot\M|land\M|vacant|vacabt|park\M|picnic|field|court\M|pool|cemet|hydrant|meter|vault|pump|substation|switching|well\M|tank|pipeline|gas line|transmission|walkway|way\M|trail|dock|boat|helipad|road|street|alias|temp|waypoint|gps|milepoint|no structure|feature|site\M|tract|parcel|block|property|acrs|greenbelt|playground|common area|access point|security|traffic|bus stop|recycle|mailbox|unknown|unkown|n/a|other\M|^0$|rd \d|road \d|rail|electric|gas\M|water\M|sewer|utility|telco|teleco|telecom|infrastructure|tennis|soccer|football|baseball|softball|body of water|dry hydrant|exit|construction|new const|home const|seasonal|outdoor|golf course|disc golf|greenhouse|grain|chicken|dairy|pole barn|abandon|pavilion|shelter|cave|arena)'
      then 'other'
    when p ~ '(comm|cafe|\mbar\M|pizza|donut|ice cream|coffee|fast food|food|grocery|mall|plaza|medic|health|hosp|clinic|dentist|doctor|pharm|drug|optom|veterin|church|relig|worship|convent|school|college|universit|daycare|child care|preschool|classroom|librar|museum|theat|cinema|bowling|fitness|gym|golf|stadium|hotel|motel|\minn\M|lodg|bank|insur|attorney|lawyer|account|financ|real estate|salon|nail|hair|barber|clean|laundr|industr|indistr|indust|manufact|factory|plant\M|warehouse|storage|mill\M|hardware|lumber|auto|\mcar\M|tire|rental|towing|truck|station|fuel|convenien|civic|govern|goverm|city hall|justice|police|sheriff|fire|\mems\M|ambulance|post office|detention|prison|jail|armory|club|venue|event|convention|business|profession|center\M|centre|department|radio|shipping|pest|photograph|thrift|antique|boutique|jewl|jewel|shoe|clothing|book|video|sport|pet\M|liquor|smoke|vape|tattoo|hangar|hanger|airport|marina|racetrack|campground|recreation|public|emergency|maintenance|outreach|nutrition|consumer|historical|barrel)'
      then 'commercial'
    when nullif(trim(coalesce(landmark, '')), '') is not null then 'commercial'
    else null
  end
  from (select lower(coalesce(place_type, '')) as p) x;
$$;

alter table public.address_points add column if not exists kind text;
alter table public.address_points add column if not exists building_id uuid references public.buildings(id) on delete set null;
create index if not exists address_points_building_idx on public.address_points (building_id);
create index if not exists address_points_kind_idx on public.address_points (county, kind);
create or replace function public.address_points_set_kind()
returns trigger language plpgsql as $$
begin
  new.kind := public.classify_place(new.place_type, new.landmark);
  return new;
end;
$$;
drop trigger if exists address_points_kind on public.address_points;
create trigger address_points_kind before insert or update of place_type, landmark
  on public.address_points for each row execute function public.address_points_set_kind();
update public.address_points set kind = public.classify_place(place_type, landmark) where kind is null;

-- 4. Match footprints to the nearest address point. Floor raised to 100 m (Hardin: 70 % of
--    footprints have a point within 60 m, 78 % within 100 m); still grows with roof size. A
--    residential point never names a building (it may still lend the street address).
create or replace function public.fill_footprint_addresses(p_county text, p_max_m numeric default 100)
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
           greatest(p_max_m, sqrt(coalesce(b.roof_sqft, 0) * 0.092903)) as radius_m,
           (
             select p.id
             from public.address_points p
             where p.county = p_county
               and coalesce(p.kind, '') <> 'other'
               and p.lat between b.centroid_lat - 0.003 and b.centroid_lat + 0.003
               and p.lng between b.centroid_lng - 0.004 and b.centroid_lng + 0.004
             order by
               ((p.lat - b.centroid_lat) * 111320) ^ 2
               + ((p.lng - b.centroid_lng) * 111320 * cos(radians(b.centroid_lat))) ^ 2
             limit 1
           ) as point_id
    from public.buildings b
    where b.county = p_county
      and b.source in ('ornl', 'ky911')
      and coalesce(b.address1, '') = ''
      and b.centroid_lat is not null and b.centroid_lng is not null
      and b.deleted_at is null
  ),
  matched as (
    -- Explicit columns: address_points has its own building_id (the link), so p.* would make
    -- m.building_id ambiguous.
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
           land_use = coalesce(b.land_use, case when m.kind = 'commercial' then m.place_type end)
      from matched m
     where b.id = m.building_id
    returning b.id, m.id as point_id
  ),
  linked as (
    -- Remember which point named the building, so the trim keeps it and a re-run is stable.
    update public.address_points p set building_id = u.id
      from updated u where p.id = u.point_id
    returning 1
  )
  select count(*) into n from updated;
  return n;
end;
$$;

-- 5. Named / commercially typed points that no stored building claimed become buildings of
--    their own (source ky911); the loader attaches the footprint (size, outline) afterwards.
create or replace function public.promote_commercial_points(p_county text, p_max_m numeric default 100)
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
     where p.county = p_county and p.kind = 'commercial'
       and not exists (
         select 1 from public.buildings b
          where b.county = p_county and b.deleted_at is null
            and b.centroid_lat between p.lat - 0.003 and p.lat + 0.003
            and b.centroid_lng between p.lng - 0.004 and p.lng + 0.004
            and sqrt(((p.lat - b.centroid_lat) * 111320) ^ 2
                     + ((p.lng - b.centroid_lng) * 111320 * cos(radians(p.lat))) ^ 2)
                <= greatest(p_max_m, sqrt(coalesce(b.roof_sqft, 0) * 0.092903)))
  ),
  ins as (
    insert into public.buildings as b
      (source_key, source, county, name, address1, city, zip, land_use, centroid_lat, centroid_lng,
       source_layer, imported_at)
    select 'ky911:' || replace(p.source_key, 'ky911:', ''), 'ky911', p.county,
           coalesce(p.landmark, ''), p.address, p.city, p.zip, p.place_type, p.lat, p.lng,
           p.source_layer, now()
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
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;
grant execute on function public.promote_commercial_points(text, numeric) to authenticated;

-- Spatial-ish indexes the matching, promotion and trim queries lean on (bounding boxes).
create index if not exists buildings_county_centroid_idx
  on public.buildings (county, centroid_lat, centroid_lng) where deleted_at is null;
create index if not exists address_points_county_lat_lng_idx
  on public.address_points (county, lat, lng);

-- 6. Trim: keep a county's points that are commercial or that named a building; the rest
--    are houses the prospects never need (re-pulled monthly anyway). Hardin: 56,335 → ~4,000.
create or replace function public.trim_address_points(p_county text, p_keep_m numeric default 100)
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
     where p.county = p_county
       and coalesce(p.kind, '') <> 'commercial'
       and p.building_id is null
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$$;
grant execute on function public.trim_address_points(text, numeric) to authenticated;

-- 7. When a county's data was last refreshed, and what it produced (the Buildings page shows it).
create table if not exists public.data_refreshes (
  id bigserial primary key,
  county text not null,
  ran_at timestamptz not null default now(),
  ran_by text,                       -- 'browser' | 'scheduled' | a person
  buildings integer,
  addressed integer,
  promoted integer,
  points_kept integer,
  facilities integer,
  notes text
);
create index if not exists data_refreshes_county_idx on public.data_refreshes (county, ran_at desc);
alter table public.data_refreshes enable row level security;
drop policy if exists "data_refreshes read" on public.data_refreshes;
create policy "data_refreshes read" on public.data_refreshes for select to authenticated using (true);
drop policy if exists "data_refreshes write" on public.data_refreshes;
create policy "data_refreshes write" on public.data_refreshes for insert to authenticated
  with check (public.has_access('prospect'));
