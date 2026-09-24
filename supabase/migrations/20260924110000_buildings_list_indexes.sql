-- The Buildings list sorts by last update, biggest roof or oldest roof and filters by county;
-- with 150,000+ rows and the loader writing, the unindexed sort hit the statement timeout.
create index if not exists buildings_updated_idx on public.buildings (updated_at desc) where deleted_at is null;
create index if not exists buildings_county_updated_idx on public.buildings (county, updated_at desc) where deleted_at is null;
create index if not exists buildings_county_roof_idx on public.buildings (county, roof_sqft desc) where deleted_at is null;
create index if not exists buildings_roof_year_built_idx on public.buildings (roof_year, year_built) where deleted_at is null;
