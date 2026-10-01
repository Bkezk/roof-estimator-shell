-- "Is there an opened date stamped on tickets or opportunities?" (owner, Oct 1). Idempotent: safe
-- to run again.
--
-- Both rows already keep created_at / created_by; the pages now show "Opened Sep 29 by RoAnna
-- Sims" under the title. What was missing is the date of each stage / status:
--
--   A. Opportunities keep only their current status. crm_opportunity_events is their log,
--      written by the database alone (trigger crm_opportunities_log): 'created' (with the status
--      it started at and the assignee), 'status' on every change of status, 'assign' on every
--      change of assignee. Existing opportunities get one backfilled 'created' row (at
--      created_at, by created_by; no status — what it started at is not known), so "Opened"
--      shows for them too.
--
--   B. Tickets: every change of stage now writes its timeline row (service_job_events, kind
--      'stage') from the database (trigger service_jobs_stage_log), including a new ticket's
--      first stage and the changes an invoice makes (set_ticket_stage_from_invoice: finalise /
--      send → Invoiced, paid → Closed), which were not on the timeline before. The app no
--      longer writes 'stage' rows (service-field.functions.ts setFieldStatus), so each change is
--      logged once.
--
-- Who: by_user = auth.uid(); by_name from profiles as audit_row() resolves it
-- (20261001110000_vendors.sql): full name, else email, else 'Unknown user'; no signed-in user
-- (the service role, migrations, the SQL editor) = 'system'. "Nothing for you or your team to
-- fill in."

-- ============================================================================================
-- 0. Who, by name — the exact resolution of audit_row(), shared by both triggers and the
-- backfill. Not callable by clients (the triggers run as the owner).
create or replace function public.event_actor_name(p_uid uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_name text;
begin
  if p_uid is null then
    return 'system';
  end if;
  select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unknown user')
    into v_name
    from public.profiles p where p.id = p_uid;
  if not found then
    v_name := 'Unknown user';
  end if;
  return v_name;
end;
$$;
revoke all on function public.event_actor_name(uuid) from public, anon, authenticated;

-- ============================================================================================
-- A1. The opportunity log.
create table if not exists public.crm_opportunity_events (
  id bigserial primary key,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  kind text not null check (kind in ('created', 'status', 'assign')),
  status text,
  assignee uuid,
  by_user uuid,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists crm_opportunity_events_opp_idx
  on public.crm_opportunity_events (opportunity_id, at);

-- Read: whoever reads the opportunity (the twin of crm_opportunities_read: Customers, Estimate,
-- or its assignee). No insert / update / delete policy: only the trigger writes, as the owner.
alter table public.crm_opportunity_events enable row level security;
drop policy if exists crm_opportunity_events_read on public.crm_opportunity_events;
create policy crm_opportunity_events_read on public.crm_opportunity_events for select to authenticated
  using (exists (
    select 1 from public.crm_opportunities o
     where o.id = crm_opportunity_events.opportunity_id
       and (public.has_access('customers') or public.has_access('estimate') or o.assignee_id = auth.uid())
  ));
drop policy if exists crm_opportunity_events_insert on public.crm_opportunity_events;
drop policy if exists crm_opportunity_events_write on public.crm_opportunity_events;
revoke insert, update, delete, truncate on public.crm_opportunity_events from anon, authenticated;
grant select on public.crm_opportunity_events to authenticated;

-- A2. The trigger. SECURITY DEFINER (owned by the migration's role, the tables' owner), so its
-- insert is not subject to the log's RLS (which has no insert policy).
create or replace function public.crm_opportunities_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.event_actor_name(auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.crm_opportunity_events (opportunity_id, kind, status, assignee, by_user, by_name, at)
    values (new.id, 'created', new.status, new.assignee_id, v_uid, v_name, coalesce(new.created_at, now()));
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.crm_opportunity_events (opportunity_id, kind, status, by_user, by_name)
    values (new.id, 'status', new.status, v_uid, v_name);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.crm_opportunity_events (opportunity_id, kind, assignee, by_user, by_name)
    values (new.id, 'assign', new.assignee_id, v_uid, v_name);
  end if;
  return null;
end;
$$;
revoke all on function public.crm_opportunities_log() from public;

drop trigger if exists crm_opportunities_log on public.crm_opportunities;
create trigger crm_opportunities_log after insert or update of status, assignee_id
  on public.crm_opportunities
  for each row execute function public.crm_opportunities_log();

-- A3. Backfill: one 'created' row per existing opportunity (at created_at, by created_by),
-- skipping any that already has one (so running this again adds nothing).
insert into public.crm_opportunity_events (opportunity_id, kind, status, assignee, by_user, by_name, at)
select o.id, 'created', null, null, o.created_by, public.event_actor_name(o.created_by), o.created_at
  from public.crm_opportunities o
 where not exists (
   select 1 from public.crm_opportunity_events e
    where e.opportunity_id = o.id and e.kind = 'created'
 );

-- ============================================================================================
-- B. A ticket's stage, on its timeline, from the database. SECURITY DEFINER for the same reason
-- as crm_contact_log_apply (which already writes service_job_events): a technician's or an
-- invoice's change is logged whatever service_job_events_insert allows the caller.
create or replace function public.service_jobs_stage_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.service_job_events (service_job_id, kind, stage, by_user, by_name, at)
    values (new.id, 'stage', new.stage, auth.uid(), public.event_actor_name(auth.uid()), now());
  end if;
  return null;
end;
$$;
revoke all on function public.service_jobs_stage_log() from public;

drop trigger if exists service_jobs_stage_log on public.service_jobs;
create trigger service_jobs_stage_log after insert or update of stage on public.service_jobs
  for each row execute function public.service_jobs_stage_log();
