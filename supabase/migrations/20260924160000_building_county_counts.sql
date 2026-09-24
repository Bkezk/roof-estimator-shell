-- The county filter on the Buildings page counted rows in the server function, and the API's
-- 1,000-row page meant only the first county showed once the state was loaded. Count in SQL.
create or replace function public.building_county_counts()
returns table(county text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select county, count(*) as n
    from public.buildings
   where deleted_at is null and coalesce(county, '') <> ''
   group by county
   order by n desc, county;
$$;
grant execute on function public.building_county_counts() to authenticated;
