-- Documents, phase 1 (owner, Oct 26): "bid advantage has a fairly robust document generator …
-- with or without cost, with or without pictures … save templates". The model is CenterPoint's
-- Build-a-Bid editor (the owner's screenshots: Modules / Variables / Insert PDF / Add Page / Save
-- Template As / Revisions), and the one rule that shapes everything here: "they need to be able
-- to edit it after its generated from the checkboxes". So a document is generated ONCE from a
-- template and the checkboxes (with or without cost, with or without pictures, marks, footer),
-- its variables are snapshotted from the record at that moment, and from then on it is its own
-- editable thing — the bid or ticket is never touched, and every save is a revision. Nothing is
-- automated: no document is made or sent without someone pressing the button. Idempotent.
--
-- 1. document_templates: the saved templates (pages jsonb = src/lib/documents/model.ts DocPage[],
--    options jsonb = DocOptions), one default per kind (bid / ticket) among the live ones.
-- 2. document_modules: saved modules (the "Save module" of the editor), one DocModule each.
-- 3. document_assets: the PDF library (Insert PDF): the file lives in the "documents" bucket at
--    library/<uuid>.pdf; the row keeps its name, page count and size. A delete keeps the file
--    (a document that inserted it still renders).
-- 4. documents: one per generated document, hanging off exactly one bid or one service ticket
--    (the check constraint), with the pages, the options it was made with, the variables
--    snapshot, a version counter (the stale-save rule, documents.functions.ts saveDocument), the
--    rendered PDF (docs/<id>/v<version>.pdf, rendered_version says which version it is), the
--    share link (token, views — GET /d/<token>, src/routes/d.$token.ts), and who it was sent to.
-- 5. document_revisions: every save (pages / title / options as saved), unique per version.
-- 6. Access: documents_access() = admin, manager, or Estimate / Invoices / Customers access —
--    whoever makes bids or deals with customers. Reads and document writes for all of them;
--    templates, modules and the PDF library are written by admins and managers only.
-- 7. document_share_viewed(p_token): the public route's view counter, the service role's alone,
--    the shape of invoice_share_viewed (20261013140000).
-- 8. Storage: the private "documents" bucket (PDFs and pictures, 25 MB) with documents_access().
-- 9. company_settings.website / .email: the Account variables (variables.ts account.website,
--    account.email) the letterhead prints.

-- 6 (first: the policies below use it). --------------------------------------------------------
create or replace function public.documents_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.is_manager()
      or public.has_access('estimate')
      or public.has_access('invoices')
      or public.has_access('customers');
$$;
revoke all on function public.documents_access() from public;
grant execute on function public.documents_access() to authenticated;
comment on function public.documents_access() is
  'Owner, Oct 26: who sees and makes documents — admins, managers, and Estimate / Invoices / Customers access.';

-- 1. ------------------------------------------------------------------------------------------
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bid', 'ticket')),
  name text not null,
  description text not null default '',
  pages jsonb not null default '[]'::jsonb,
  options jsonb not null,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text,
  deleted_at timestamptz
);
create unique index if not exists document_templates_one_default_per_kind
  on public.document_templates (kind) where is_default and deleted_at is null;
create index if not exists document_templates_kind_idx
  on public.document_templates (kind) where deleted_at is null;
drop trigger if exists document_templates_updated_at on public.document_templates;
create trigger document_templates_updated_at before update on public.document_templates
  for each row execute function public.update_updated_at_column();
alter table public.document_templates enable row level security;
drop policy if exists document_templates_read on public.document_templates;
create policy document_templates_read on public.document_templates for select to authenticated
  using (public.documents_access());
drop policy if exists document_templates_insert on public.document_templates;
create policy document_templates_insert on public.document_templates for insert to authenticated
  with check (public.documents_access() and (public.is_admin() or public.is_manager()));
drop policy if exists document_templates_update on public.document_templates;
create policy document_templates_update on public.document_templates for update to authenticated
  using (public.documents_access() and (public.is_admin() or public.is_manager()))
  with check (public.documents_access() and (public.is_admin() or public.is_manager()));
drop policy if exists document_templates_delete on public.document_templates;
create policy document_templates_delete on public.document_templates for delete to authenticated
  using (public.documents_access() and (public.is_admin() or public.is_manager()));
comment on table public.document_templates is
  'Owner, Oct 26: document templates (pages = DocPage[], options = the generate-time checkboxes); one default per kind among the live ones.';

-- 2. ------------------------------------------------------------------------------------------
create table if not exists public.document_modules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  module jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text,
  deleted_at timestamptz
);
drop trigger if exists document_modules_updated_at on public.document_modules;
create trigger document_modules_updated_at before update on public.document_modules
  for each row execute function public.update_updated_at_column();
alter table public.document_modules enable row level security;
drop policy if exists document_modules_read on public.document_modules;
create policy document_modules_read on public.document_modules for select to authenticated
  using (public.documents_access());
drop policy if exists document_modules_insert on public.document_modules;
create policy document_modules_insert on public.document_modules for insert to authenticated
  with check (public.documents_access() and (public.is_admin() or public.is_manager()));
drop policy if exists document_modules_update on public.document_modules;
create policy document_modules_update on public.document_modules for update to authenticated
  using (public.documents_access() and (public.is_admin() or public.is_manager()))
  with check (public.documents_access() and (public.is_admin() or public.is_manager()));
drop policy if exists document_modules_delete on public.document_modules;
create policy document_modules_delete on public.document_modules for delete to authenticated
  using (public.documents_access() and (public.is_admin() or public.is_manager()));
comment on table public.document_modules is
  'Owner, Oct 26: saved document modules (one DocModule each) the editor offers beside the built-in tiles.';

-- 3. ------------------------------------------------------------------------------------------
create table if not exists public.document_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null,
  page_count integer not null,
  size_bytes integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.document_assets enable row level security;
drop policy if exists document_assets_read on public.document_assets;
create policy document_assets_read on public.document_assets for select to authenticated
  using (public.documents_access());
drop policy if exists document_assets_insert on public.document_assets;
create policy document_assets_insert on public.document_assets for insert to authenticated
  with check (public.documents_access() and (public.is_admin() or public.is_manager()));
drop policy if exists document_assets_update on public.document_assets;
create policy document_assets_update on public.document_assets for update to authenticated
  using (public.documents_access() and (public.is_admin() or public.is_manager()))
  with check (public.documents_access() and (public.is_admin() or public.is_manager()));
drop policy if exists document_assets_delete on public.document_assets;
create policy document_assets_delete on public.document_assets for delete to authenticated
  using (public.documents_access() and (public.is_admin() or public.is_manager()));
comment on table public.document_assets is
  'Owner, Oct 26: the PDF library for Insert PDF — the file is in the documents bucket at library/<uuid>.pdf; a delete keeps the file.';

-- 4. ------------------------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bid', 'ticket')),
  bid_id uuid references public.bids(id) on delete cascade,
  service_job_id uuid references public.service_jobs(id) on delete cascade,
  account_id uuid,
  title text not null,
  template_id uuid references public.document_templates(id) on delete set null,
  pages jsonb not null,
  options jsonb not null,
  variables jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  pdf_path text,
  rendered_at timestamptz,
  rendered_version integer,
  share_token text unique,
  share_views integer not null default 0,
  share_last_viewed_at timestamptz,
  sent_at timestamptz,
  sent_to text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text,
  deleted_at timestamptz,
  constraint documents_one_record check (
    (kind = 'bid' and bid_id is not null and service_job_id is null)
    or (kind = 'ticket' and service_job_id is not null and bid_id is null)
  )
);
create index if not exists documents_bid_idx on public.documents (bid_id) where deleted_at is null;
create index if not exists documents_job_idx on public.documents (service_job_id) where deleted_at is null;
create index if not exists documents_account_idx on public.documents (account_id) where deleted_at is null;
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.update_updated_at_column();
alter table public.documents enable row level security;
drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (public.documents_access());
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.documents_access());
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.documents_access()) with check (public.documents_access());
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (public.documents_access());
comment on table public.documents is
  'Owner, Oct 26: a generated document (CenterPoint-style), off one bid or one ticket, edited on its own after generating; version moves on every save (the stale-save rule), the PDF and the share link hang off it.';
comment on column public.documents.variables is
  'The variables snapshot at generation / refresh (key → text), plus the reserved __sections key the Pricing Table is rebuilt from (src/lib/documents/server-pure.ts).';
comment on column public.documents.share_token is
  'The share link''s token (32 random bytes, base64url, 43 chars) — GET /d/<token> serves the PDF with no login. Null = no link.';

-- 5. ------------------------------------------------------------------------------------------
create table if not exists public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version integer not null,
  title text not null,
  pages jsonb not null,
  options jsonb not null,
  saved_by_name text,
  saved_at timestamptz not null default now(),
  unique (document_id, version)
);
alter table public.document_revisions enable row level security;
drop policy if exists document_revisions_read on public.document_revisions;
create policy document_revisions_read on public.document_revisions for select to authenticated
  using (public.documents_access());
drop policy if exists document_revisions_insert on public.document_revisions;
create policy document_revisions_insert on public.document_revisions for insert to authenticated
  with check (public.documents_access());
drop policy if exists document_revisions_update on public.document_revisions;
create policy document_revisions_update on public.document_revisions for update to authenticated
  using (public.documents_access()) with check (public.documents_access());
drop policy if exists document_revisions_delete on public.document_revisions;
create policy document_revisions_delete on public.document_revisions for delete to authenticated
  using (public.documents_access());
comment on table public.document_revisions is
  'Owner, Oct 26: every save of a document (the Revisions tab); restoring one saves it as a new version.';

-- 7. ------------------------------------------------------------------------------------------
-- The view counter: the public route's (service role) only — the shape of invoice_share_viewed.
-- Bumps the two counters alone, on a live link alone; a token nobody holds changes nothing.
create or replace function public.document_share_viewed(p_token text)
returns void language sql security definer set search_path = public as $$
  update public.documents
     set share_views = share_views + 1,
         share_last_viewed_at = now()
   where share_token = p_token
     and deleted_at is null
     and (coalesce(auth.role(), '') = 'service_role'
          or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated')));
$$;
revoke all on function public.document_share_viewed(text) from public;
revoke all on function public.document_share_viewed(text) from anon;
revoke all on function public.document_share_viewed(text) from authenticated;
grant execute on function public.document_share_viewed(text) to service_role;
comment on function public.document_share_viewed(text) is
  'Owner, Oct 26: counts a view of a document''s share link (share_views + 1, share_last_viewed_at = now). The service role''s only; GET /d/<token> calls it after serving the PDF.';

-- 8. ------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists documents_objects_read on storage.objects;
create policy documents_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.documents_access());
drop policy if exists documents_objects_insert on storage.objects;
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.documents_access());
drop policy if exists documents_objects_update on storage.objects;
create policy documents_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.documents_access())
  with check (bucket_id = 'documents' and public.documents_access());
drop policy if exists documents_objects_delete on storage.objects;
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.documents_access());

-- 9. ------------------------------------------------------------------------------------------
alter table public.company_settings
  add column if not exists website text,
  add column if not exists email text;
comment on column public.company_settings.website is
  'Owner, Oct 26: the company website the letterhead prints (document variable account.website).';
comment on column public.company_settings.email is
  'Owner, Oct 26: the company email the letterhead prints (document variable account.email).';
