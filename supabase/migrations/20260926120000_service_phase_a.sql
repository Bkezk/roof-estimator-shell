-- Service phase A (docs/service-module-design.md §6, §11; owner, Sep 26): customer accounts
-- (the CRM hub), service jobs linked to them, technicians, vehicle drivers, and material used on
-- a service job taken off the tech's own vehicle. CenterPoint still dispatches and invoices; the
-- ticket / invoice numbers it issues are typed onto the job. Idempotent.

-- Access pages: 'service' (tickets; techs get only this) and 'customers' (the CRM: accounts,
-- sites, contacts). A profile marked technician appears on the board and can be assigned.
alter table public.profiles add column if not exists technician boolean not null default false;
alter table public.profiles drop constraint if exists profiles_access_check;
alter table public.profiles add constraint profiles_access_check
  check (access <@ array['estimate','pricing','inventory','prospect','takeoff','service','customers']::text[]);

create or replace function public.is_technician()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.technician from public.profiles p where p.id = auth.uid()), false);
$$;

-- Customer profile: a company / group or an individual. Bids, tickets and (later) opportunities
-- hang off it. Prospecting's buildings are NOT the CRM (owner, Sep 26).
create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'company' check (kind in ('company','individual')),
  contact_name text,
  phone text,
  email text,
  address1 text,
  address2 text,
  city text,
  state text,
  zip text,
  billing_instructions text,
  -- The 6-digit CenterPoint "External Identifier" (likely the Sage customer number).
  external_id text,
  notes text,
  source text not null default 'manual' check (source in ('manual','prospect','import')),
  centerpoint_company_id text,
  created_by uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists crm_accounts_name_idx on public.crm_accounts (lower(name));
drop trigger if exists crm_accounts_updated_at on public.crm_accounts;
create trigger crm_accounts_updated_at before update on public.crm_accounts
  for each row execute function public.update_updated_at_column();
alter table public.crm_accounts enable row level security;
drop policy if exists crm_accounts_read on public.crm_accounts;
create policy crm_accounts_read on public.crm_accounts for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists crm_accounts_write on public.crm_accounts;
create policy crm_accounts_write on public.crm_accounts for all to authenticated
  using (public.has_access('customers') or public.has_access('service'))
  with check (public.has_access('customers') or public.has_access('service'));

-- A site (property) of an account: where the roof is. An account may have many.
create table if not exists public.crm_sites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  name text not null,
  address1 text,
  address2 text,
  city text,
  state text,
  zip text,
  technician_instructions text,
  notes text,
  centerpoint_property_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists crm_sites_account_idx on public.crm_sites (account_id);
create index if not exists crm_sites_name_idx on public.crm_sites (lower(name));
drop trigger if exists crm_sites_updated_at on public.crm_sites;
create trigger crm_sites_updated_at before update on public.crm_sites
  for each row execute function public.update_updated_at_column();
alter table public.crm_sites enable row level security;
drop policy if exists crm_sites_read on public.crm_sites;
create policy crm_sites_read on public.crm_sites for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists crm_sites_write on public.crm_sites;
create policy crm_sites_write on public.crm_sites for all to authenticated
  using (public.has_access('customers') or public.has_access('service'))
  with check (public.has_access('customers') or public.has_access('service'));

-- Who drives which service vehicle (owner, Sep 26): up to two users per vehicle, a user may be on
-- two vehicles, admins change it, history is kept (to_date closes a row).
create table if not exists public.vehicle_drivers (
  id bigserial primary key,
  location_id text not null references public.inventory_locations(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_date date not null default current_date,
  to_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_drivers_user_idx on public.vehicle_drivers (user_id, to_date);
create index if not exists vehicle_drivers_vehicle_idx on public.vehicle_drivers (location_id, to_date);
alter table public.vehicle_drivers enable row level security;
drop policy if exists vehicle_drivers_read on public.vehicle_drivers;
create policy vehicle_drivers_read on public.vehicle_drivers for select to authenticated using (true);
drop policy if exists vehicle_drivers_write on public.vehicle_drivers;
create policy vehicle_drivers_write on public.vehicle_drivers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Service jobs (repair tickets). Numbers continue past CenterPoint's (5,49x in Sep 2026) from
-- 6000 so the two never collide while both run; invoice # = ticket # later (design §4).
create sequence if not exists public.service_job_number_seq start with 6000;
create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('public.service_job_number_seq'),
  account_id uuid references public.crm_accounts(id) on delete set null,
  site_id uuid references public.crm_sites(id) on delete set null,
  -- Snapshots so the list reads without joins and survives a deleted account.
  customer_name text not null default '',
  site_name text,
  site_address text,
  description text not null default '',
  service_type text not null default 'leak'
    check (service_type in ('leak','scope','warranty','inspection','other')),
  po_number text,
  technician_id uuid references public.profiles(id) on delete set null,
  helper_count integer not null default 0 check (helper_count between 0 and 9),
  scheduled_date date,
  stage text not null default 'open'
    check (stage in ('open','scheduled','done','invoiced','closed')),
  notes text,
  centerpoint_ticket text,
  centerpoint_invoice text,
  created_by uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists service_jobs_updated_idx on public.service_jobs (updated_at desc);
create index if not exists service_jobs_account_idx on public.service_jobs (account_id);
create index if not exists service_jobs_tech_idx on public.service_jobs (technician_id, stage);
drop trigger if exists service_jobs_updated_at on public.service_jobs;
create trigger service_jobs_updated_at before update on public.service_jobs
  for each row execute function public.update_updated_at_column();
alter table public.service_jobs enable row level security;
-- Everyone with Service reads every ticket; a technician edits only their own, office users
-- (Service without the technician tick) and admins edit any.
drop policy if exists service_jobs_read on public.service_jobs;
create policy service_jobs_read on public.service_jobs for select to authenticated
  using (public.has_access('service') or public.has_access('customers'));
drop policy if exists service_jobs_insert on public.service_jobs;
create policy service_jobs_insert on public.service_jobs for insert to authenticated
  with check (public.has_access('service'));
drop policy if exists service_jobs_update on public.service_jobs;
create policy service_jobs_update on public.service_jobs for update to authenticated
  using (public.has_access('service') and (not public.is_technician() or public.is_admin() or technician_id = auth.uid()))
  with check (public.has_access('service'));
drop policy if exists service_jobs_delete on public.service_jobs;
create policy service_jobs_delete on public.service_jobs for delete to authenticated
  using (public.is_admin());

-- Bids link to the hub too (the Setup typeahead, design §11); filled in by the estimator later.
alter table public.bids add column if not exists account_id uuid references public.crm_accounts(id) on delete set null;
alter table public.bids add column if not exists site_id uuid references public.crm_sites(id) on delete set null;

-- Material used on a service job: an ordinary 'consumed' movement that names the job. The
-- vehicle write-off ('vehicle_used') is no longer offered (history rows stay).
alter table public.inventory_movements
  add column if not exists service_job_id uuid references public.service_jobs(id) on delete set null,
  add column if not exists service_job_name text;
create index if not exists inventory_movements_service_job_idx on public.inventory_movements (service_job_id);
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.has_access('estimate')
    or ((public.has_access('inventory') or public.has_access('service'))
        and reason in ('leftover','consumed','transfer_out','transfer_in'))
  );

-- The "A job" picker: bids and open service jobs together (a field login reads neither table).
create or replace function public.inventory_job_options()
returns table (kind text, id uuid, name text, status text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'bid'::text as kind, b.id, b.name, b.status, b.updated_at
    from public.bids b
   where b.deleted_at is null and auth.uid() is not null
  union all
  select 'service'::text, s.id,
         '#' || s.number || ' ' || s.customer_name || case when s.description <> '' then ' — ' || s.description else '' end,
         s.stage, s.updated_at
    from public.service_jobs s
   where s.deleted_at is null and auth.uid() is not null
   order by updated_at desc
   limit 800;
$$;
revoke all on function public.inventory_job_options() from public;
grant execute on function public.inventory_job_options() to authenticated;

-- The assignee roster for a ticket: technicians first, then admins and office users with
-- Service access. SECURITY DEFINER because profiles RLS hides other users' rows.
create or replace function public.technician_options()
returns table (id uuid, full_name text, email text, technician boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.technician
    from public.profiles p
   where public.has_access('service')
     and (p.technician or p.role = 'admin' or 'service' = any(p.access))
   order by p.technician desc, coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.technician_options() from public;
grant execute on function public.technician_options() to authenticated;

-- Owner, Sep 27: a technician sees only tickets assigned to them and can move a ticket only as
-- far as Done; Invoiced and Closed are the office's. Office users and admins are unchanged.
drop policy if exists service_jobs_read on public.service_jobs;
create policy service_jobs_read on public.service_jobs for select to authenticated
  using (
    public.has_access('customers')
    or (public.has_access('service')
        and (not public.is_technician() or public.is_admin() or technician_id = auth.uid()))
  );
drop policy if exists service_jobs_insert on public.service_jobs;
create policy service_jobs_insert on public.service_jobs for insert to authenticated
  with check (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin()
         or (technician_id = auth.uid() and stage in ('open','scheduled','done')))
  );
drop policy if exists service_jobs_update on public.service_jobs;
create policy service_jobs_update on public.service_jobs for update to authenticated
  using (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or technician_id = auth.uid())
  )
  with check (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin()
         or (technician_id = auth.uid() and stage in ('open','scheduled','done')))
  );

-- Owner, Sep 27: a technician may put a piece back on the truck against a ticket ("released"
-- with a service_job_id); the server caps it at what the ticket took.
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.has_access('estimate')
    or ((public.has_access('inventory') or public.has_access('service'))
        and (reason in ('leftover','consumed','transfer_out','transfer_in')
             or (reason = 'released' and service_job_id is not null)))
  );
