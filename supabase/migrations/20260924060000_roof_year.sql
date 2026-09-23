-- Roof age for prospecting filters. A salesperson types the year the current roof went on
-- ("Roof installed (year)") straight on the building; saving a roof record with an install
-- date keeps it in step (newest install date wins). Filters use coalesce(roof_year, year_built):
-- with no re-roof on record, the original roof is as old as the building.
alter table public.buildings add column if not exists roof_year integer;
create index if not exists buildings_roof_year_idx on public.buildings (roof_year);
create index if not exists buildings_roof_sqft_idx on public.buildings (roof_sqft);

create or replace function public.sync_building_roof_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid := coalesce(new.building_id, old.building_id);
  y integer;
begin
  select max(extract(year from install_date))::integer into y
    from public.roofs where building_id = bid and install_date is not null;
  if y is not null then
    update public.buildings set roof_year = y where id = bid and roof_year is distinct from y;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists roofs_sync_roof_year on public.roofs;
create trigger roofs_sync_roof_year
  after insert or update of install_date or delete on public.roofs
  for each row execute function public.sync_building_roof_year();

-- Backfill from roofs already recorded.
update public.buildings b
   set roof_year = r.y
  from (select building_id, max(extract(year from install_date))::integer as y
          from public.roofs where install_date is not null group by building_id) r
 where r.building_id = b.id and b.roof_year is null;
