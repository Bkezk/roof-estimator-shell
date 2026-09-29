-- Approximate addresses (owner, Sep 29). About 29 % of the Kentucky outlines have no 911
-- address point inside the exact match radius (100 m, or the roof's own size): rural shops and
-- barns set back from the road. The loader (scripts/load-kentucky.ts) now makes a second pass
-- over those, and the owner's three rules apply:
--   1. the nearest 911 address point within 300 m (not further);
--   2. only when it is clearly nearest: the next-nearest point (with a different address) is
--      at least twice as far; two close contenders leave the address blank;
--   3. stored flagged as approximate, with the distance, so the app shows "≈ 123 Main St" and
--      "approximate: nearest address point, 180 m away — confirm on site".
-- A person typing the address clears the flag (saveBuilding in src/lib/prospect.functions.ts).
-- Apply while the loader is NOT running (DDL during a load stalled PostgREST, docs/TODO.md 3).

alter table public.buildings
  add column if not exists address_approx boolean not null default false;
alter table public.buildings
  add column if not exists address_approx_m numeric;

comment on column public.buildings.address_approx is
  'address1 is a guess: the nearest 911 address point 100-300 m from the building, clearly nearer than any other (loader approximate pass). False for exact matches and anything a person typed; a typed address clears it.';
comment on column public.buildings.address_approx_m is
  'For an approximate address: metres from the building to the 911 address point it came from. Null otherwise.';

-- Same field rules as before for exact matches (address always, city / zip only when empty,
-- the landmark as the name of an unnamed building, the place type as land use when the point
-- reads commercial). New: `approx` (default false) and `approx_m`. An approximate match never
-- sets land use: the point's place type describes the addressed structure, not this building.
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
      id uuid, address text, city text, zip text, landmark text, kind text, place_type text,
      approx boolean, approx_m numeric)
  ),
  up as (
    update public.buildings b
       set address1 = s.address,
           city = coalesce(b.city, s.city),
           zip = coalesce(b.zip, s.zip),
           name = case when b.name = '' and s.landmark is not null and not coalesce(s.approx, false) then s.landmark else b.name end,
           land_use = coalesce(
             b.land_use,
             case when s.kind = 'commercial' and not coalesce(s.approx, false) then s.place_type end),
           address_approx = coalesce(s.approx, false),
           address_approx_m = case when coalesce(s.approx, false) then round(s.approx_m) end,
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
