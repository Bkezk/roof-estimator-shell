-- Tennessee buildings (owner, Sep 29: "we cover TN as well … whole state"). The Tennessee
-- loader (scripts/load-tennessee.ts) sends `state = 'TN'` with each row; the Kentucky loader
-- and the app send no state, which stays 'KY' as before. Everything else is the Sep 24 function
-- (20260924090000_prospecting_commercial_rule.sql) unchanged.
--
-- State is treated like county: the source's value wins when it gives one, otherwise the
-- stored value stays (so a Kentucky refresh never touches a row's state). The recordset is
-- read twice (insert, and the state lookup on conflict), at most 200 rows a call.
--
-- No new `source` value: Tennessee rows are source 'ornl' with source_key 'usa:<BUILD_ID>'
-- (Kentucky's are 'ornl:<BUILD_ID>' from the state's copy), source_layer = the USA Structures
-- layer URL. Apply this BEFORE the first Tennessee load: the old function ignores `state`, and
-- the loader stops if its first rows come back as 'KY'.
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
        source_layer text, created_by uuid, created_by_name text, state text)
  ),
  up as (
    insert into public.buildings as b
      (source_key, source, county, name, address1, city, zip, land_use, roof_sqft, perimeter_ft,
       height_ft, footprint, centroid_lat, centroid_lng, source_layer, imported_at, deleted_at,
       created_by, created_by_name, state)
    select source_key, source, county, coalesce(name,''), coalesce(address1,''), city, zip,
           land_use, roof_sqft, perimeter_ft, height_ft, footprint, centroid_lat, centroid_lng,
           source_layer, now(), null, created_by, created_by_name, coalesce(nullif(state, ''), 'KY')
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
      -- excluded.state is already defaulted to 'KY', so look at what the caller actually sent.
      state        = coalesce(
                       (select nullif(s.state, '') from src s
                         where s.source_key = excluded.source_key limit 1),
                       b.state),
      imported_at  = now(),
      deleted_at   = null
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$$;
grant execute on function public.upsert_buildings(jsonb) to authenticated;
