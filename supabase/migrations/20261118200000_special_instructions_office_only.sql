-- Special instructions the office keeps to itself (owner, Nov 18: "add a viewable to technicians
-- check box next to special instructions for the office"; chosen: the box starts ticked, and an
-- unticked box hides the instructions from technicians everywhere).
--
-- A row's columns cannot be hidden from one reader and shown to another, so instructions that
-- are not for technicians are kept in a table of their own that a technician-only login cannot
-- read at all:
--
--   service_jobs.notes_tech_visible   the tick box. True for every ticket there is and every
--                                     new one, so nothing changes until someone unticks it.
--   service_jobs.notes                the instructions while the box is ticked (as before).
--   service_job_office_notes          the instructions while the box is NOT ticked; then
--                                     service_jobs.notes is empty.
--
-- The site moves the text between the two when the box changes (ticket-instructions.ts).
-- Safe with the older site still published: it does not know the box, and every ticket starts
-- ticked. Safe to run twice.
alter table public.service_jobs
  add column if not exists notes_tech_visible boolean not null default true;

create table if not exists public.service_job_office_notes (
  service_job_id uuid primary key references public.service_jobs(id) on delete cascade,
  notes text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_by_name text
);
alter table public.service_job_office_notes enable row level security;
revoke all on public.service_job_office_notes from anon;
grant select, insert, update, delete on public.service_job_office_notes to authenticated;
grant all on public.service_job_office_notes to service_role;

-- The office reads and writes them for a ticket it can read. A technician-only login: nothing.
drop policy if exists service_job_office_notes_office on public.service_job_office_notes;
create policy service_job_office_notes_office on public.service_job_office_notes
  for all to authenticated
  using (
    not (select public.is_technician())
    and exists (select 1 from public.service_jobs j where j.id = service_job_id)
  )
  with check (
    not (select public.is_technician())
    and exists (select 1 from public.service_jobs j where j.id = service_job_id)
  );

-- Only the office changes the box. A technician's save of their own ticket cannot tick it, and
-- cannot write instructions on a ticket whose box is unticked (they do not see that box).
create or replace function public.service_jobs_instructions_rule()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if (select public.is_technician()) then
    if new.notes_tech_visible is distinct from old.notes_tech_visible then
      raise exception 'Only the office chooses whether technicians see the special instructions'
        using errcode = '42501';
    end if;
    if not old.notes_tech_visible and new.notes is distinct from old.notes then
      new.notes := old.notes;
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists service_jobs_instructions_rule on public.service_jobs;
create trigger service_jobs_instructions_rule
  before update of notes, notes_tech_visible on public.service_jobs
  for each row execute function public.service_jobs_instructions_rule();
revoke all on function public.service_jobs_instructions_rule() from public, anon, authenticated;
