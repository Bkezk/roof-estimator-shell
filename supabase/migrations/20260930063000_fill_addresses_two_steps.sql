-- fill_footprint_addresses (20260924130000_prospecting_chunked_steps.sql) wrote a matched
-- building's address in one data-modifying CTE (`updated`) and stamped every building of the
-- batch as checked in another (`stamped`) — the same rows, updated twice by one statement.
-- Postgres applies only one of the two updates to such a row, and which one is not defined: the
-- stamp won, so matched buildings were marked checked with no address and never looked at again.
-- Now two statements: write the matched rows (address and stamp together), then stamp the rest of
-- the batch. Same signature, same result for callers (the batch size); safe to re-run.
-- Buildings stamped with no address by the old version: `reset_address_checks(county)` (or the
-- next point import, which clears the county's stamps) has them looked at again.

create or replace function public.fill_footprint_addresses(p_county text, p_max_m numeric default 100, p_limit integer default 400)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(t.id), '{}') into ids
    from (
      select b.id
        from public.buildings b
       where b.county = p_county
         and b.source in ('ornl', 'ky911')
         and coalesce(b.address1, '') = ''
         and b.address_checked_at is null
         and b.centroid_lat is not null and b.centroid_lng is not null
         and b.deleted_at is null
       order by b.id
       limit p_limit
    ) t;
  if cardinality(ids) = 0 then
    return 0;
  end if;

  -- 1. Each building's nearest usable point within its radius: address, city / zip when empty,
  --    the landmark as the name, the place type as the class — and the checked stamp.
  with candidates as (
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
    from public.buildings t
    where t.id = any(ids)
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
  )
  -- One building per point (two outlines can share their nearest point).
  update public.address_points p set building_id = u.id
    from (select distinct on (point_id) point_id, id from updated order by point_id, id) u
   where p.id = u.point_id;

  -- 2. Everything else in this batch is stamped as checked, so the next call moves on.
  update public.buildings b
     set address_checked_at = now()
   where b.id = any(ids)
     and b.address_checked_at is null;

  return cardinality(ids);
end;
$$;
