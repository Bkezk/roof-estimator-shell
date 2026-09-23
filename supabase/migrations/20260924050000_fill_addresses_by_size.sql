-- fill_footprint_addresses: a big building's centre is far from its road-side address point,
-- so the search radius grows with the roof: max(p_max_m, sqrt(roof area in m²)).
-- 85,000 sq ft → about 89 m; a 5,000 sq ft shop keeps the 60 m floor.
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
           greatest(p_max_m, sqrt(coalesce(b.roof_sqft, 0) * 0.092903)) as radius_m,
           (
             select p.id
             from public.address_points p
             where p.county = p_county
               and p.lat between b.centroid_lat - 0.003 and b.centroid_lat + 0.003
               and p.lng between b.centroid_lng - 0.004 and b.centroid_lng + 0.004
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
               + ((p.lng - b.centroid_lng) * 111320 * cos(radians(b.centroid_lat))) ^ 2) <= c.radius_m
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
