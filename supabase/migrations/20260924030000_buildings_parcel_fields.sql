-- Prospecting: what a Kentucky PVA parcel import fills that the manual form did not have
-- (verified on the owner's Webster County sample, src/lib/gis/fixtures/webster-parcels.json).
-- A parcel is LAND, so its area is lot_sqft — roof_sqft stays for building footprints.
alter table public.buildings add column if not exists lot_sqft numeric;
alter table public.buildings add column if not exists deed text;          -- deed book-page; a change = ownership transfer
alter table public.buildings add column if not exists tax_year integer;
alter table public.buildings add column if not exists source_layer text;  -- the ArcGIS layer URL it came from
alter table public.buildings add column if not exists imported_at timestamptz;

-- The importer upserts on (county, parcel_id). PostgREST's ON CONFLICT cannot name a partial
-- index's predicate, so the unique index must be a plain one (NULL parcel ids never conflict).
drop index if exists public.buildings_county_parcel_idx;
create unique index if not exists buildings_county_parcel_uidx on public.buildings (county, parcel_id);
