-- Price List Import audit + revert: one run per confirmed import, one change row per cell
-- written (old → new). Revert restores `old_price` on every change whose cell still holds
-- `new_price` and marks the run reverted. Admin-only writes through the server functions.
create table if not exists public.price_import_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  file_name text not null,
  cells_written integer not null default 0,
  cells_changed integer not null default 0,
  reverted_at timestamptz,
  reverted_by uuid,
  revert_note text
);
create table if not exists public.price_import_changes (
  id bigserial primary key,
  run_id uuid not null references public.price_import_runs(id) on delete cascade,
  screen_id text not null,
  row_label text not null,
  price_col text not null,
  item_no text not null,
  sheet_description text,
  old_price numeric,
  new_price numeric not null,
  reverted_at timestamptz
);
create index if not exists price_import_changes_run_idx on public.price_import_changes(run_id);

alter table public.price_import_runs enable row level security;
alter table public.price_import_changes enable row level security;
drop policy if exists price_import_runs_read on public.price_import_runs;
create policy price_import_runs_read on public.price_import_runs for select to authenticated using (true);
drop policy if exists price_import_runs_write on public.price_import_runs;
create policy price_import_runs_write on public.price_import_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists price_import_changes_read on public.price_import_changes;
create policy price_import_changes_read on public.price_import_changes for select to authenticated using (true);
drop policy if exists price_import_changes_write on public.price_import_changes;
create policy price_import_changes_write on public.price_import_changes for all to authenticated using (public.is_admin()) with check (public.is_admin());
