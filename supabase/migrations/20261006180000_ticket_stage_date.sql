-- The day a ticket entered its current stage, for the ticket list's cards (owner, Oct 6: "more
-- details on the tickets so before you click one at a glance you can see … stage date"; as
-- CenterPoint's list shows Stage Date). Set by the database whenever the stage changes; filled in
-- for existing tickets from their timeline's last 'stage' row for that stage, else the day the
-- ticket was made. Idempotent.
alter table public.service_jobs add column if not exists stage_changed_at timestamptz;
comment on column public.service_jobs.stage_changed_at is
  'When the ticket entered its current stage (set on insert and on every stage change).';

create or replace function public.service_job_stage_changed()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.stage_changed_at := coalesce(new.stage_changed_at, now());
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists service_jobs_stage_changed on public.service_jobs;
create trigger service_jobs_stage_changed before insert or update of stage on public.service_jobs
  for each row execute function public.service_job_stage_changed();

update public.service_jobs j
   set stage_changed_at = coalesce(
     (select max(e.at) from public.service_job_events e
       where e.service_job_id = j.id and e.kind = 'stage' and e.stage = j.stage),
     j.created_at)
 where j.stage_changed_at is null;
