-- A place for the owner's working papers that the site is being built from (owner, Nov 18:
-- "put this info in a place of enduring memory because we will come back to it"): the text of
-- a draft flyer, the numbers of a costing sheet, a list still to be decided. Kept here, not in
-- the code, because the code is readable by anyone and these are the office's own.
--
-- Admins only, read and write. Nothing on the site shows this table yet.
-- Safe to run twice.
create table if not exists public.office_reference_notes (
  key text primary key,
  title text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null
);
alter table public.office_reference_notes enable row level security;
revoke all on public.office_reference_notes from anon;
grant select, insert, update, delete on public.office_reference_notes to authenticated;
grant all on public.office_reference_notes to service_role;
drop policy if exists office_reference_notes_admin on public.office_reference_notes;
create policy office_reference_notes_admin on public.office_reference_notes
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
