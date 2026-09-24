-- Prospects are a working list, not every commercial building in the state (owner, Sep 24).
-- A building becomes a prospect when someone flags it (Add building, tap-to-add, "Add to my
-- prospects" on a search result, a warranty lead); the stage moves as the sale does. The monthly
-- data refresh never touches these columns (upsert_buildings only fills empty fields).
-- Plain nullable columns first (instant); the check constraint is added NOT VALID so it never
-- scans the 150k-row table while the loader is writing (validate later, when idle).
alter table public.buildings
  add column if not exists prospect_stage text,
  add column if not exists prospect_owner_name text,
  add column if not exists prospected_at timestamptz;
alter table public.buildings
  add constraint buildings_prospect_stage_check
  check (prospect_stage in ('prospect', 'contacted', 'quoted', 'won', 'dead')) not valid;
create index if not exists buildings_prospects_idx
  on public.buildings (prospected_at desc) where prospect_stage is not null and deleted_at is null;
