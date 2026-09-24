-- Takeoff phase 1 (docs/planswift-research.md §4): the takeoffs table, the private storage
-- bucket that holds the plan PDFs / aerial screenshots, and the 'takeoff' access page.

-- Access page.
alter table public.profiles drop constraint if exists profiles_access_check;
alter table public.profiles add constraint profiles_access_check
  check (access <@ array['estimate','pricing','inventory','prospect','takeoff']::text[]);

-- One takeoff = one underlay file (a plan set PDF or an aerial screenshot), its pages with
-- their scale calibration, the material answers given up front, and the drawn objects.
create table if not exists public.takeoffs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled takeoff',
  status text not null default 'draft' check (status in ('draft','done')),
  underlay_kind text not null check (underlay_kind in ('pdf','image')),
  -- Storage object path inside bucket "takeoffs": <takeoff id>/<file name>.
  file_path text,
  file_name text,
  file_size bigint,
  -- [{ index, name, rotation, scale: { ax, ay, bx, by, feet } | null }] — image = one page.
  pages jsonb not null default '[]'::jsonb,
  -- Material answers asked before drawing (roof system, membrane, attachment, underlayment,
  -- deck, edge defaults, parapet defaults) — the new bid's defaults on Create bid.
  setup jsonb not null default '{}'::jsonb,
  -- Drawn objects: [{ id, kind: area|linear|count, page, points: [[x,y]…] (page px at scale 1),
  -- attrs }] — see src/lib/takeoff/model.ts for the shape.
  objects jsonb not null default '[]'::jsonb,
  building_id uuid references public.buildings(id) on delete set null,
  bid_id uuid references public.bids(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists takeoffs_updated_idx on public.takeoffs (updated_at desc);
drop trigger if exists takeoffs_updated_at on public.takeoffs;
create trigger takeoffs_updated_at before update on public.takeoffs
  for each row execute function public.update_updated_at_column();
alter table public.takeoffs enable row level security;
drop policy if exists takeoffs_read on public.takeoffs;
create policy takeoffs_read on public.takeoffs for select to authenticated
  using (public.has_access('takeoff') or public.has_access('estimate'));
drop policy if exists takeoffs_write on public.takeoffs;
create policy takeoffs_write on public.takeoffs for all to authenticated
  using (public.has_access('takeoff')) with check (public.has_access('takeoff'));

-- The bid ↔ takeoff link (the brief's spine): a bid made from a takeoff remembers it.
alter table public.bids add column if not exists takeoff_id uuid references public.takeoffs(id) on delete set null;

-- Private bucket for the underlay files. 100 MB per file; PDF and the two screenshot types.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('takeoffs', 'takeoffs', false, 104857600, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists takeoffs_objects_read on storage.objects;
create policy takeoffs_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'takeoffs' and (public.has_access('takeoff') or public.has_access('estimate')));
drop policy if exists takeoffs_objects_insert on storage.objects;
create policy takeoffs_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'takeoffs' and public.has_access('takeoff'));
drop policy if exists takeoffs_objects_update on storage.objects;
create policy takeoffs_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'takeoffs' and public.has_access('takeoff'))
  with check (bucket_id = 'takeoffs' and public.has_access('takeoff'));
drop policy if exists takeoffs_objects_delete on storage.objects;
create policy takeoffs_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'takeoffs' and public.has_access('takeoff'));
