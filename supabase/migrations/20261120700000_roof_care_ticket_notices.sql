-- Roof Care: inspection tickets the site makes are announced (break test Nov 20, number 16).
--
-- A ticket a person opens tells the admins and the managers "Opened", and starts the
-- technician's reminder timer. A plan's inspection ticket made by the morning run
-- (roof_care_make_tickets, 6:40 AM Eastern) told nobody: it sat on the list until someone
-- happened to see it. The 8:00 reminder run now announces every plan inspection ticket that has
-- not been announced (src/lib/roof-care-ticket-announce.server.ts), and the app's own
-- announcement (a plan starting, a storm inspection a person adds) is remembered the same way,
-- so nobody is told twice.
--
-- What was announced is remembered here, beside the tickets, not on the ticket's own row: a
-- ticket's row is not written, so its "last changed" time and its history stay a person's.
--
--   claimed_at    a run took the ticket to announce it. Only one run can hold a ticket (the
--                 primary key), so two runs in the same minute send one notice between them.
--   announced_at  set only after the notice was written. A run that fails gives its tickets
--                 back; one that dies leaves a claim that the next run clears after 15 minutes.

create table if not exists public.roof_care_ticket_notices (
  service_job_id uuid primary key references public.service_jobs (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  announced_at timestamptz
);

comment on table public.roof_care_ticket_notices is
  'Which Roof Care plan inspection tickets have been announced (Opened notice, reminder timer). Written by the server only.';

alter table public.roof_care_ticket_notices enable row level security;
revoke all on table public.roof_care_ticket_notices from public, anon, authenticated;

-- Tickets that exist today were made while a person was at the screen, or are long known: none
-- of them is announced again.
insert into public.roof_care_ticket_notices (service_job_id, claimed_at, announced_at)
select j.id, j.created_at, j.created_at
  from public.service_jobs j
 where j.roof_care_visit_id is not null
on conflict (service_job_id) do nothing;

-- Take the plan inspection tickets that still have to be announced: live, not finished, tied to
-- a plan's inspection, with no notice written. `p_ids`: only these tickets (the app, right after
-- it made them); null: every one (the 8:00 run). Each ticket comes back to one caller only.
create or replace function public.roof_care_ticket_announce_claim(p_ids uuid[] default null)
returns table (
  id uuid,
  number integer,
  customer_name text,
  site_name text,
  description text,
  stage text,
  account_id uuid,
  technician_id uuid,
  scheduled_date date,
  plan text,
  visit_kind text,
  due_from date,
  due_by date
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- A claim nobody finished (a run that died): free again after 15 minutes.
  delete from public.roof_care_ticket_notices n
   where n.announced_at is null
     and n.claimed_at < now() - interval '15 minutes';
  return query
  with took as (
    insert into public.roof_care_ticket_notices (service_job_id)
    select j.id
      from public.service_jobs j
     where j.roof_care_visit_id is not null
       and j.deleted_at is null
       and j.stage in ('open', 'scheduled')
       and (p_ids is null or j.id = any (p_ids))
       and not exists (
         select 1 from public.roof_care_ticket_notices n where n.service_job_id = j.id)
     order by j.number
     limit 200
    on conflict (service_job_id) do nothing
    returning service_job_id
  )
  select j.id, j.number, j.customer_name, j.site_name, j.description, j.stage, j.account_id,
         j.technician_id, j.scheduled_date, p.plan, v.kind, v.due_from, v.due_by
    from took t
    join public.service_jobs j on j.id = t.service_job_id
    left join public.roof_care_visits v on v.id = j.roof_care_visit_id
    left join public.roof_care_plans p on p.id = v.plan_id
   order by j.number;
end;
$function$;

-- The end of a run: `p_written` true marks the tickets announced (their notice is written);
-- false gives them back for the next run. Only tickets still held and not yet announced change.
create or replace function public.roof_care_ticket_announce_finish(p_ids uuid[], p_written boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n integer;
begin
  if coalesce(p_written, false) then
    update public.roof_care_ticket_notices
       set announced_at = now()
     where service_job_id = any (p_ids) and announced_at is null;
  else
    delete from public.roof_care_ticket_notices
     where service_job_id = any (p_ids) and announced_at is null;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- The server alone (the site's own key): no signed-in person can hold back an announcement.
revoke all on function public.roof_care_ticket_announce_claim(uuid[]) from public, anon, authenticated;
revoke all on function public.roof_care_ticket_announce_finish(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.roof_care_ticket_announce_claim(uuid[]) to service_role;
grant execute on function public.roof_care_ticket_announce_finish(uuid[], boolean) to service_role;
