-- Service phase B, part 2 (docs/service-module-design.md §3, §5.3): contacts on accounts and
-- sites, and the technician's phone flow — the stage timeline, time entries from the stage
-- buttons, the repair template catalog, repairs with before / after photos, materials (already
-- inventory movements), closing notes and the customer's signature. Idempotent.

-- Contacts: a person at an account, optionally tied to specific sites.
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts(id) on delete cascade,
  name text not null,
  position text,
  email text,
  mobile text,
  office_phone text,
  is_billing boolean not null default false,
  notes text,
  centerpoint_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists crm_contacts_account_idx on public.crm_contacts (account_id);
drop trigger if exists crm_contacts_updated_at on public.crm_contacts;
create trigger crm_contacts_updated_at before update on public.crm_contacts
  for each row execute function public.update_updated_at_column();
alter table public.crm_contacts enable row level security;
drop policy if exists crm_contacts_read on public.crm_contacts;
create policy crm_contacts_read on public.crm_contacts for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists crm_contacts_write on public.crm_contacts;
create policy crm_contacts_write on public.crm_contacts for all to authenticated
  using (public.has_access('customers') or public.has_access('service'))
  with check (public.has_access('customers') or public.has_access('service'));

-- A contact on a site (site contacts for a ticket). No row = the account's contacts apply.
create table if not exists public.crm_site_contacts (
  site_id uuid not null references public.crm_sites(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  primary key (site_id, contact_id)
);
alter table public.crm_site_contacts enable row level security;
drop policy if exists crm_site_contacts_read on public.crm_site_contacts;
create policy crm_site_contacts_read on public.crm_site_contacts for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists crm_site_contacts_write on public.crm_site_contacts;
create policy crm_site_contacts_write on public.crm_site_contacts for all to authenticated
  using (public.has_access('customers') or public.has_access('service'))
  with check (public.has_access('customers') or public.has_access('service'));

-- A ticket's site contact and the field-flow columns.
alter table public.service_jobs
  add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null,
  -- Where the tech is inside a Scheduled ticket: null (not started) | en_route | on_site.
  add column if not exists field_status text check (field_status in ('en_route','on_site')),
  add column if not exists en_route_at timestamptz,
  add column if not exists on_site_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists closing_notes text,
  add column if not exists checked_in_with text,
  add column if not exists checked_out_with text,
  add column if not exists recommend_new_roof boolean not null default false,
  add column if not exists signature_path text,
  add column if not exists signed_at timestamptz,
  add column if not exists signed_by text;

-- The stage strip and the history timeline: one row per change.
create table if not exists public.service_job_events (
  id bigserial primary key,
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  kind text not null check (kind in ('stage','field','note','assign','photo','signature','edit')),
  stage text,
  field_status text,
  note text,
  by_user uuid default auth.uid(),
  by_name text,
  at timestamptz not null default now(),
  meta jsonb
);
create index if not exists service_job_events_job_idx on public.service_job_events (service_job_id, at);
alter table public.service_job_events enable row level security;
drop policy if exists service_job_events_read on public.service_job_events;
create policy service_job_events_read on public.service_job_events for select to authenticated
  using (public.has_access('service') or public.has_access('customers'));
drop policy if exists service_job_events_insert on public.service_job_events;
create policy service_job_events_insert on public.service_job_events for insert to authenticated
  with check (public.has_access('service'));

-- Time entries: what the invoice's travel / labor lines come from. Written by the stage
-- buttons (source buttons) and editable by hand (source manual).
create table if not exists public.service_time_entries (
  id bigserial primary key,
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  technician_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('travel','labor')),
  started_at timestamptz,
  ended_at timestamptz,
  hours numeric not null check (hours >= 0),
  helper_count integer not null default 0 check (helper_count between 0 and 9),
  source text not null default 'buttons' check (source in ('buttons','manual')),
  on_date date not null default current_date,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_time_entries_job_idx on public.service_time_entries (service_job_id);
drop trigger if exists service_time_entries_updated_at on public.service_time_entries;
create trigger service_time_entries_updated_at before update on public.service_time_entries
  for each row execute function public.update_updated_at_column();
alter table public.service_time_entries enable row level security;
drop policy if exists service_time_entries_read on public.service_time_entries;
create policy service_time_entries_read on public.service_time_entries for select to authenticated
  using (public.has_access('service') or public.has_access('customers'));
drop policy if exists service_time_entries_write on public.service_time_entries;
create policy service_time_entries_write on public.service_time_entries for all to authenticated
  using (public.has_access('service')) with check (public.has_access('service'));

-- Repair templates (CenterPoint's 475): the text on the Work Completed page and the quote
-- price. Imported once, then maintained here.
create table if not exists public.repair_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  unit text not null default 'EA',
  description text,
  work_completed text,
  unit_price numeric,
  favorite boolean not null default false,
  usage_count integer not null default 0,
  active boolean not null default true,
  centerpoint_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists repair_templates_name_idx on public.repair_templates (lower(name));
drop trigger if exists repair_templates_updated_at on public.repair_templates;
create trigger repair_templates_updated_at before update on public.repair_templates
  for each row execute function public.update_updated_at_column();
alter table public.repair_templates enable row level security;
drop policy if exists repair_templates_read on public.repair_templates;
create policy repair_templates_read on public.repair_templates for select to authenticated
  using (public.has_access('service') or public.has_access('customers') or public.has_access('estimate'));
drop policy if exists repair_templates_write on public.repair_templates;
create policy repair_templates_write on public.repair_templates for all to authenticated
  using (public.has_access('customers') or public.is_admin())
  with check (public.has_access('customers') or public.is_admin());

-- A repair done on a ticket (one Work Completed page each).
create table if not exists public.service_job_repairs (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  repair_template_id uuid references public.repair_templates(id) on delete set null,
  name text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default 'EA',
  problem_text text,
  resolution_text text,
  completed_on date not null default current_date,
  print_on_invoice boolean not null default true,
  sort integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_job_repairs_job_idx on public.service_job_repairs (service_job_id, sort);
drop trigger if exists service_job_repairs_updated_at on public.service_job_repairs;
create trigger service_job_repairs_updated_at before update on public.service_job_repairs
  for each row execute function public.update_updated_at_column();
alter table public.service_job_repairs enable row level security;
drop policy if exists service_job_repairs_read on public.service_job_repairs;
create policy service_job_repairs_read on public.service_job_repairs for select to authenticated
  using (public.has_access('service') or public.has_access('customers'));
drop policy if exists service_job_repairs_write on public.service_job_repairs;
create policy service_job_repairs_write on public.service_job_repairs for all to authenticated
  using (public.has_access('service')) with check (public.has_access('service'));

-- Photos (before / after per repair, or general) and the signature image live in the private
-- bucket "service" at <job id>/<file>; the row records where and when.
create table if not exists public.service_job_photos (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  repair_id uuid references public.service_job_repairs(id) on delete set null,
  role text not null default 'other' check (role in ('before','after','other','signature')),
  storage_path text not null,
  file_name text,
  file_size bigint,
  taken_at timestamptz,
  lat double precision,
  lng double precision,
  by_user uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists service_job_photos_job_idx on public.service_job_photos (service_job_id);
alter table public.service_job_photos enable row level security;
drop policy if exists service_job_photos_read on public.service_job_photos;
create policy service_job_photos_read on public.service_job_photos for select to authenticated
  using (public.has_access('service') or public.has_access('customers'));
drop policy if exists service_job_photos_write on public.service_job_photos;
create policy service_job_photos_write on public.service_job_photos for all to authenticated
  using (public.has_access('service')) with check (public.has_access('service'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service', 'service', false, 26214400, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists service_objects_read on storage.objects;
create policy service_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'service' and (public.has_access('service') or public.has_access('customers')));
drop policy if exists service_objects_insert on storage.objects;
create policy service_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'service' and public.has_access('service'));
drop policy if exists service_objects_delete on storage.objects;
create policy service_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'service' and (public.has_access('service') or public.is_admin()));

-- Repair template usage count for the favourites chips.
create or replace function public.bump_repair_template_usage()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.repair_template_id is not null then
    update public.repair_templates set usage_count = usage_count + 1 where id = new.repair_template_id;
  end if;
  return new;
end; $$;
drop trigger if exists service_job_repairs_usage on public.service_job_repairs;
create trigger service_job_repairs_usage after insert on public.service_job_repairs
  for each row execute function public.bump_repair_template_usage();

-- A starter set of repair templates from the CenterPoint report (names and the one price seen;
-- the full 475 come with the CenterPoint import). Only when the table is empty.
insert into public.repair_templates (name, category, unit, description, work_completed, unit_price, favorite)
select * from (values
 ('Drainage – Clogged Scupper/Drain','Drainage','EA','The existing drain / scupper is clogged and water is backing up.','Cleared the drain / scupper of debris and water tested it.',250::numeric,true),
 ('Drainage – Drain Flashing Failure','Drainage','EA','The drain flashing has failed and is letting water in.','Removed the failed flashing, cleaned and primed the area, installed new drain flashing and sealed it.',null,true),
 ('Membrane – Holes','Membrane','EA','Holes / punctures found in the roof membrane.','Cleaned and primed the area and installed a membrane patch over each hole.',null,true),
 ('Membrane – Open Seams','Membrane','LF','Open / failing seams in the roof membrane.','Cleaned the seam, primed and re-sealed it with seam tape / lap sealant.',null,true),
 ('Membrane – Blisters','Membrane','EA','Blisters in the membrane.','Cut, dried and patched the blistered area.',null,false),
 ('Flashing – Wall Flashing Failure','Flashing','LF','Base / wall flashing is failing and letting water in.','Re-secured and re-sealed the wall flashing; installed new termination where needed.',null,true),
 ('Flashing – Curb / Unit Flashing','Flashing','EA','Flashing at a curb or rooftop unit is failing.','Repaired and re-sealed the curb flashing.',null,false),
 ('Penetration – Pipe Boot / Pipe Flashing','Penetrations','EA','A pipe boot / pipe flashing is failing.','Installed / re-sealed the pipe boot and clamped it.',null,true),
 ('Penetration – Pitch Pocket','Penetrations','EA','A pitch pocket has dried out / cracked.','Cleaned out and refilled the pitch pocket with pourable sealer.',null,false),
 ('Metal – Coping / Edge Metal','Sheet metal','LF','Coping or edge metal is loose or open at the joints.','Re-secured the metal and sealed the joints.',null,false),
 ('Metal – Screws Backing Out (metal roof)','Sheet metal','EA','Screws backing out on the metal roof allowing water in.','Replaced the screws with oversized / rivet fasteners and sealed the heads.',null,false),
 ('A/C – Condensate Drains on Roof','HVAC','EA','Condensate lines draining onto the roof.','Extended / redirected the condensate lines to a drain.',250,false),
 ('Previous Repair Failure','General','EA','A previous repair has failed.','Removed the failed repair and re-did it properly.',null,true),
 ('Debris Removal / Cleaning','General','EA','Debris on the roof and in the drains.','Removed debris and cleaned the drains / gutters.',null,false),
 ('Leak Investigation / Water Test','General','EA','Leak reported; source not visible.','Inspected the area and water tested until the source was found.',null,true),
 ('Other Repair','General','EA',null,null,null,false)
) as v(name, category, unit, description, work_completed, unit_price, favorite)
where not exists (select 1 from public.repair_templates);
