-- Sites inside a property (owner, Oct 6: "change sites to properties … currently they are using
-- the description to label sites within the properties so properties also should have a sites
-- form that can be added"). In CenterPoint two tickets at one property (Cumberland Valley National
-- Bank, 1520 U.S. 27 South) are told apart only by their description ("CVNB Somerset"). Here a
-- property (crm_sites, "Property" in the interface since Oct 6) has named sites, and a ticket
-- picks one: location_id, with its name snapshotted (as site_name is for the property).
-- Reads and writes follow the property's own policies (crm_sites_read / crm_sites_write).
-- Idempotent.
create table if not exists public.property_sites (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.crm_sites(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  notes text,
  sort integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists property_sites_property_idx on public.property_sites (property_id);
comment on table public.property_sites is
  'Named sites inside a property (a branch, a building) that a ticket can name.';
drop trigger if exists property_sites_updated_at on public.property_sites;
create trigger property_sites_updated_at before update on public.property_sites
  for each row execute function public.update_updated_at_column();

alter table public.property_sites enable row level security;
drop policy if exists property_sites_read on public.property_sites;
create policy property_sites_read on public.property_sites for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists property_sites_write on public.property_sites;
create policy property_sites_write on public.property_sites for all to authenticated
  using (public.has_access('customers') or public.has_access('service'))
  with check (public.has_access('customers') or public.has_access('service'));

alter table public.service_jobs
  add column if not exists location_id uuid references public.property_sites(id) on delete set null;
alter table public.service_jobs add column if not exists location_name text;
comment on column public.service_jobs.location_id is 'The site inside the property (property_sites).';
comment on column public.service_jobs.location_name is 'The site''s name when the ticket was saved.';
