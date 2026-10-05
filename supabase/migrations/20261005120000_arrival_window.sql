-- A ticket's arrival window (service study M1, owner Oct 5): optional, blank = any time that
-- day. CenterPoint shows "Morning (8-10am)" with the ETA; the portal had the day only. The
-- labels live in src/lib/arrival-window.ts; the column keeps the key. Idempotent.
alter table public.service_jobs add column if not exists arrival_window text;
alter table public.service_jobs drop constraint if exists service_jobs_arrival_window_check;
alter table public.service_jobs
  add constraint service_jobs_arrival_window_check
  check (arrival_window is null or arrival_window in ('morning', 'midday', 'afternoon'));
comment on column public.service_jobs.arrival_window is
  'Optional arrival window on the scheduled day: morning (8-10), midday (10-1), afternoon (1-4); null = any time.';
