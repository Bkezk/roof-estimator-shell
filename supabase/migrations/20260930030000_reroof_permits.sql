-- Re-roof marking (owner, Sep 29: "The marking buildings as done is very useful, please
-- implement it showing when it was done and who did it"). A commercial re-roof permit means the
-- roof was just replaced and the job went to the roofer who pulled the permit: not a lead, but
-- a building salespeople should not call on. The lead refresh (src/lib/reroof.server.ts, run
-- at the end of refreshLeads) reads Metro Nashville's "Building Commercial - Roofing / Siding"
-- permits, keeps them here, and for each re-roof finds the building (same address, else the
-- nearest building within 40 m of the permit point) and writes one roof record on it
-- (section "Whole roof (permit)", installed on the issue date, installer = the permit holder).
-- A permit that finds no building (Tennessee buildings not loaded yet) is tried again on every
-- refresh for 12 months. Nashville only today: Louisville's permit layer has no roofing type
-- and no description, Chattanooga's holds only new construction.
--
-- Written by the refresh like the leads table (the service-role client when the server has the
-- key, else the Prospecting user's own session, so the write policy matches leads_write).
-- Idempotent. Apply before the next lead refresh; until then the step fails and says so in the
-- refresh's red line (the leads themselves still save).

create table if not exists public.reroof_permits (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('nashville_permits')),
  permit_no text not null,
  issued_on date not null,
  contractor text,
  cost numeric,
  address text,
  city text,
  state text not null default 'TN',
  lat double precision,
  lng double precision,
  description text,
  sqft numeric,
  roof_type text,
  building_id uuid references public.buildings(id) on delete set null,
  roof_id uuid references public.roofs(id) on delete set null,
  match_method text check (match_method in ('address','point')),
  matched_at timestamptz,
  raw jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source, permit_no)
);
comment on table public.reroof_permits is
  'Commercial re-roof permits (Metro Nashville Roofing / Siding) and the building each marked. matched_at set = handled (a roof record deleted by hand is not written again).';
comment on column public.reroof_permits.contractor is
  'The permit''s Contact: the roofer, or the applicant (a GC, a permit expediter, a person).';
create index if not exists reroof_permits_pending_idx
  on public.reroof_permits (issued_on desc) where matched_at is null;
create index if not exists reroof_permits_building_idx on public.reroof_permits (building_id);

alter table public.reroof_permits enable row level security;
drop policy if exists reroof_permits_read on public.reroof_permits;
create policy reroof_permits_read on public.reroof_permits for select to authenticated
  using (public.has_access('prospect'));
drop policy if exists reroof_permits_write on public.reroof_permits;
create policy reroof_permits_write on public.reroof_permits for all to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));

-- What the Buildings row line shows at a glance ("re-roofed Mar 2026 by Pinaire Roofing").
alter table public.buildings add column if not exists last_reroof_on date;
alter table public.buildings add column if not exists last_reroof_by text;
comment on column public.buildings.last_reroof_on is
  'Issue date of the newest re-roof permit matched to this building (reroof_permits); only moves forward.';
comment on column public.buildings.last_reroof_by is
  'Who pulled that re-roof permit (the permit''s contact: usually the roofer).';

-- Found while building this (Sep 29): sync_building_roof_year set roof_year to the newest roof
-- record's year even when a newer year had been typed on the building, so adding an older
-- record lowered it. The newest known year now wins (typed or recorded).
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
    update public.buildings
       set roof_year = greatest(coalesce(roof_year, 0), y)
     where id = bid and (roof_year is null or roof_year < y);
  end if;
  return coalesce(new, old);
end;
$$;
