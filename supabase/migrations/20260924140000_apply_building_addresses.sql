-- The statewide loader now matches 911 address points to buildings in memory and writes the
-- results in one batch per county (scripts/load-kentucky.ts). Same field rules as
-- fill_footprint_addresses: address always, city / zip only when empty, the landmark as the name
-- of an unnamed building, the place type as land use when the point reads commercial.
create or replace function public.apply_building_addresses(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with src as (
    select * from jsonb_to_recordset(rows) as r(
      id uuid, address text, city text, zip text, landmark text, kind text, place_type text)
  ),
  up as (
    update public.buildings b
       set address1 = s.address,
           city = coalesce(b.city, s.city),
           zip = coalesce(b.zip, s.zip),
           name = case when b.name = '' and s.landmark is not null then s.landmark else b.name end,
           land_use = coalesce(b.land_use, case when s.kind = 'commercial' then s.place_type end),
           address_checked_at = now()
      from src s
     where b.id = s.id
       and b.deleted_at is null
       and coalesce(b.address1, '') = ''
       and coalesce(s.address, '') <> ''
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$$;
grant execute on function public.apply_building_addresses(jsonb) to authenticated;
