-- The county filter and the "Storm hits" county chips grouped buildings by county NAME only, so
-- the 34 names both states use (Lawrence, Franklin, Warren, Knox, …) merged Kentucky's county
-- with Tennessee's. Both counts now group by county and state. "state" is 'TN', or 'KY' for
-- every row not marked TN — the Buildings list's own state filter (listBuildings: TN = 'TN',
-- KY = anything else).
--
-- The result type changes, which CREATE OR REPLACE cannot do, so each function is dropped and
-- created again (safe to re-run).

drop function if exists public.building_county_counts();
create function public.building_county_counts()
returns table(county text, state text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select b.county, case when b.state = 'TN' then 'TN' else 'KY' end, count(*)
    from public.buildings b
   where b.deleted_at is null and coalesce(b.county, '') <> ''
   group by 1, 2
   order by 3 desc, 1, 2;
$$;
grant execute on function public.building_county_counts() to authenticated, service_role;

-- Flagged buildings per county and state, for the "Storm hits" chips (RLS applies).
drop function if exists public.building_county_counts_storm();
create function public.building_county_counts_storm()
returns table(county text, state text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select b.county, case when b.state = 'TN' then 'TN' else 'KY' end, count(*)
    from public.buildings b
   where b.deleted_at is null and b.last_storm_at is not null
   group by 1, 2;
$$;
revoke all on function public.building_county_counts_storm() from public;
grant execute on function public.building_county_counts_storm() to authenticated, service_role;

notify pgrst, 'reload schema';
