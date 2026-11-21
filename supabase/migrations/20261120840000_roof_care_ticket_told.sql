-- Roof Care: who has been told about a plan inspection ticket the site made (owner, Nov 20:
-- "go with 4").
--
-- The 8:00 run announces the tickets the morning run made (20261120700000): the people on the
-- tickets' "Each step" line hear "Opened", in groups (people with the same tickets share one
-- notice). When the notice of one group could not be written, its tickets are given back and
-- told on the next run. Until now that next run told EVERY group again, so the people whose
-- notice had gone out the first time heard the same tickets twice.
--
-- Who was told which ticket is now kept here, written right after each notice. A later run
-- leaves out, for each person, the tickets they have already heard: only who has not heard is
-- told. The rows go with their ticket when it is removed.

create table if not exists public.roof_care_ticket_told (
  service_job_id uuid not null references public.service_jobs (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  told_at timestamptz not null default now(),
  primary key (service_job_id, profile_id)
);

comment on table public.roof_care_ticket_told is
  'Who was told "Opened" about a Roof Care plan inspection ticket the site made. Written by the server only.';

create index if not exists roof_care_ticket_told_profile_idx
  on public.roof_care_ticket_told (profile_id);

alter table public.roof_care_ticket_told enable row level security;
revoke all on table public.roof_care_ticket_told from public, anon, authenticated;

-- Who has already been told about these tickets.
create or replace function public.roof_care_ticket_told_list(p_ids uuid[])
returns table (service_job_id uuid, profile_id uuid)
language sql
stable
security definer
set search_path = public
as $function$
  select t.service_job_id, t.profile_id
    from public.roof_care_ticket_told t
   where t.service_job_id = any (coalesce(p_ids, '{}'::uuid[]));
$function$;

-- These people were just told about these tickets. Telling it twice changes nothing.
create or replace function public.roof_care_ticket_told_mark(p_jobs uuid[], p_people uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n integer;
begin
  insert into public.roof_care_ticket_told (service_job_id, profile_id)
  select j.id, pr.id
    from public.service_jobs j
   cross join public.profiles pr
   where j.id = any (coalesce(p_jobs, '{}'::uuid[]))
     and pr.id = any (coalesce(p_people, '{}'::uuid[]))
  on conflict (service_job_id, profile_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.roof_care_ticket_told_list(uuid[]) from public, anon, authenticated;
revoke all on function public.roof_care_ticket_told_mark(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.roof_care_ticket_told_list(uuid[]) to service_role;
grant execute on function public.roof_care_ticket_told_mark(uuid[], uuid[]) to service_role;

notify pgrst, 'reload schema';
