-- Prospecting phase 1 (docs/roofing-ops-portal-brief.md): the territory roof database's core
-- tables — buildings, roofs, tasks-lite — and the nullable link columns on bids.
--
-- Access is the new 'prospect' page flag on profiles.access. Estimate users may READ buildings
-- and roofs (a bid links to one); only Prospecting users write them; deletes are soft
-- (deleted_at) and only admins hard-delete. No PostGIS yet: a footprint is GeoJSON in jsonb plus
-- a centroid, enough for the map and for "Create bid from building"; spatial queries come with
-- the parcel ingest. Idempotent.

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  address1 text not null default '',
  address2 text,
  city text,
  state text not null default 'KY',
  zip text,
  county text,
  parcel_id text,
  owner_name text,
  owner_address text,
  land_use text,
  building_sqft numeric,
  roof_sqft numeric,
  perimeter_ft numeric,
  year_built integer,
  stories integer,
  footprint jsonb,
  centroid_lat double precision,
  centroid_lng double precision,
  own_book boolean not null default false,
  source text not null default 'manual' check (source in ('manual','won_bid','pva','import')),
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists buildings_county_parcel_idx
  on public.buildings (county, parcel_id) where parcel_id is not null and deleted_at is null;
create index if not exists buildings_name_idx on public.buildings (lower(name));
create index if not exists buildings_county_idx on public.buildings (county);
drop trigger if exists update_buildings_updated_at on public.buildings;
create trigger update_buildings_updated_at before update on public.buildings
  for each row execute function public.update_updated_at_column();
alter table public.buildings enable row level security;
drop policy if exists buildings_read on public.buildings;
create policy buildings_read on public.buildings for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate'));
drop policy if exists buildings_insert on public.buildings;
create policy buildings_insert on public.buildings for insert to authenticated
  with check (public.has_access('prospect'));
drop policy if exists buildings_update on public.buildings;
create policy buildings_update on public.buildings for update to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));
drop policy if exists buildings_delete on public.buildings;
create policy buildings_delete on public.buildings for delete to authenticated
  using (public.is_admin());

create table if not exists public.roofs (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  section_name text not null default 'Roof',
  roof_type text,            -- what is up there now (single ply, BUR, metal, …)
  roof_system text,          -- our system when we installed it (Duro-Last, Duro-Bond, …)
  area_sqft numeric,
  install_date date,
  installer text,
  warranty_type text,
  warranty_expires date,
  last_inspection date,
  bid_id uuid references public.bids(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists roofs_building_idx on public.roofs (building_id);
create index if not exists roofs_warranty_idx on public.roofs (warranty_expires);
drop trigger if exists update_roofs_updated_at on public.roofs;
create trigger update_roofs_updated_at before update on public.roofs
  for each row execute function public.update_updated_at_column();
alter table public.roofs enable row level security;
drop policy if exists roofs_read on public.roofs;
create policy roofs_read on public.roofs for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate'));
drop policy if exists roofs_write on public.roofs;
create policy roofs_write on public.roofs for all to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));

-- Tasks-lite: where triggers and building follow-ups land until the CRM exists (it adopts
-- this table).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  due_date date,
  assignee uuid,
  assignee_name text,
  status text not null default 'open' check (status in ('open','done')),
  source text not null default 'manual',
  building_id uuid references public.buildings(id) on delete set null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists tasks_building_idx on public.tasks (building_id);
create index if not exists tasks_open_idx on public.tasks (status, due_date);
drop trigger if exists update_tasks_updated_at on public.tasks;
create trigger update_tasks_updated_at before update on public.tasks
  for each row execute function public.update_updated_at_column();
alter table public.tasks enable row level security;
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate'));
drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks for all to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));

-- Nullable link columns on bids (the brief's spine). takeoff_id / opportunity_id get their
-- foreign keys when those tables exist.
alter table public.bids add column if not exists building_id uuid references public.buildings(id) on delete set null;
alter table public.bids add column if not exists roof_id uuid references public.roofs(id) on delete set null;
alter table public.bids add column if not exists takeoff_id uuid;
alter table public.bids add column if not exists opportunity_id uuid;
create index if not exists bids_building_idx on public.bids (building_id);
