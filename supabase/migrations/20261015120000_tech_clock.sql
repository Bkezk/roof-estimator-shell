-- The technician's clock, CenterPoint-style (owner, Oct 15: "the technicians clock into travel,
-- then clock into the job; while they're out, if they're going to another job they clock into
-- travel for that job, then into the job once they get there, then they can edit time later").
-- One running clock per technician: travel to, or labor on, one ticket since started_at.
-- Closing it (On site, Leave site, Complete, or Start travel to another ticket) writes a
-- service_time_entries row with the real start and end (source 'clock'), hours to the quarter
-- hour; the technician can edit the times afterwards (the office always could). Applied live
-- Oct 15. Additive and idempotent.
create table if not exists public.service_tech_clock (
  technician_id uuid primary key references public.profiles(id) on delete cascade,
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  kind text not null check (kind in ('travel','labor')),
  started_at timestamptz not null default now(),
  helper_count integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.service_tech_clock is
  'Owner, Oct 15: one running clock per technician (CenterPoint-style): travel to or labor on a ticket since started_at. Closing it writes a service_time_entries row (source clock).';
alter table public.service_tech_clock enable row level security;
-- Own row: the technician. The office (Service access) reads every clock (the board, the
-- office ticket page) and may act on a technician's behalf.
drop policy if exists service_tech_clock_read on public.service_tech_clock;
create policy service_tech_clock_read on public.service_tech_clock for select to authenticated
  using (technician_id = auth.uid() or public.has_access('service') or public.has_access('customers'));
drop policy if exists service_tech_clock_write on public.service_tech_clock;
create policy service_tech_clock_write on public.service_tech_clock for all to authenticated
  using (technician_id = auth.uid() or public.has_access('service'))
  with check (technician_id = auth.uid() or public.has_access('service'));

-- A time entry the clock wrote says so.
alter table public.service_time_entries drop constraint if exists service_time_entries_source_check;
alter table public.service_time_entries add constraint service_time_entries_source_check
  check (source in ('buttons','manual','clock'));
