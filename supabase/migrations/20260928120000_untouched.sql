-- Untouched work (owner, Sep 28): tickets and opportunities get assigned and then sit, and
-- nobody can see whether the customer was ever reached or the job ever started. This records
-- when an item was handed to someone (assigned_at) and when the customer was last reached
-- (contacted_at, stamped by a one-tap contact log), defines "untouched" once in crm_untouched(),
-- and lets the reminder pass escalate untouched items to admins past an admin-set limit.

-- 1. Settings: the untouched limits and who gets the escalation.
alter table public.crm_settings
  add column if not exists ticket_untouched_days integer not null default 2
    check (ticket_untouched_days between 0 and 365),
  add column if not exists opportunity_untouched_days integer not null default 3
    check (opportunity_untouched_days between 0 and 365),
  add column if not exists escalate_to_admins boolean not null default true,
  add column if not exists escalate_user_ids uuid[] not null default '{}';

-- 2. When was it handed to someone, and when was the customer last reached.
alter table public.service_jobs
  add column if not exists assigned_at timestamptz,
  add column if not exists contacted_at timestamptz;
alter table public.crm_opportunities
  add column if not exists assigned_at timestamptz,
  add column if not exists contacted_at timestamptz;

-- assigned_at follows the assignee column: stamped on every hand-over, cleared when unassigned.
create or replace function public.service_jobs_stamp_assigned()
returns trigger language plpgsql as $$
begin
  if new.technician_id is null then
    new.assigned_at := null;
  elsif tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id then
    new.assigned_at := now();
  end if;
  return new;
end $$;
drop trigger if exists service_jobs_stamp_assigned on public.service_jobs;
create trigger service_jobs_stamp_assigned
  before insert or update of technician_id on public.service_jobs
  for each row execute function public.service_jobs_stamp_assigned();

create or replace function public.crm_opportunities_stamp_assigned()
returns trigger language plpgsql as $$
begin
  if new.assignee_id is null then
    new.assigned_at := null;
  elsif tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    new.assigned_at := now();
  end if;
  return new;
end $$;
drop trigger if exists crm_opportunities_stamp_assigned on public.crm_opportunities;
create trigger crm_opportunities_stamp_assigned
  before insert or update of assignee_id on public.crm_opportunities
  for each row execute function public.crm_opportunities_stamp_assigned();

-- Backfill: existing assignments count from their last change (created_at would make every old
-- ticket look weeks untouched on day one). An opportunity already past Open was contacted.
update public.service_jobs set assigned_at = updated_at
 where technician_id is not null and assigned_at is null;
update public.crm_opportunities set assigned_at = updated_at
 where assignee_id is not null and assigned_at is null;
update public.crm_opportunities set contacted_at = updated_at
 where status <> 'open' and contacted_at is null;

-- 3. The contact log: one row per call / text / email / visit, on a ticket or an opportunity.
create table if not exists public.crm_contact_log (
  id bigserial primary key,
  kind text not null check (kind in ('ticket','opportunity')),
  item_id uuid not null,
  method text not null check (method in ('called','texted','emailed','visited','other')),
  note text,
  by_user uuid default auth.uid(),
  by_name text,
  at timestamptz not null default now()
);
create index if not exists crm_contact_log_item_idx on public.crm_contact_log (kind, item_id, at desc);
alter table public.crm_contact_log enable row level security;
-- Whoever may see the item may see and add to its log (the item tables' own RLS decides).
drop policy if exists crm_contact_log_read on public.crm_contact_log;
create policy crm_contact_log_read on public.crm_contact_log for select to authenticated
  using (
    (kind = 'ticket' and exists (select 1 from public.service_jobs j where j.id = item_id))
    or (kind = 'opportunity' and exists (select 1 from public.crm_opportunities o where o.id = item_id))
  );
drop policy if exists crm_contact_log_insert on public.crm_contact_log;
create policy crm_contact_log_insert on public.crm_contact_log for insert to authenticated
  with check (
    by_user = auth.uid()
    and ((kind = 'ticket' and exists (select 1 from public.service_jobs j where j.id = item_id))
      or (kind = 'opportunity' and exists (select 1 from public.crm_opportunities o where o.id = item_id)))
  );

-- Logging a contact stamps the item and, on an Open opportunity, moves it to Contacted. A ticket
-- also gets a timeline entry. SECURITY DEFINER: a technician may log on their own ticket even
-- though the ticket update policy limits what they may change.
alter table public.service_job_events drop constraint if exists service_job_events_kind_check;
alter table public.service_job_events add constraint service_job_events_kind_check
  check (kind in ('stage','field','note','assign','photo','signature','edit','contact'));

create or replace function public.crm_contact_log_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'ticket' then
    update public.service_jobs set contacted_at = new.at
     where id = new.item_id and (contacted_at is null or contacted_at < new.at);
    insert into public.service_job_events (service_job_id, kind, note, by_user, by_name, at, meta)
    values (new.item_id, 'contact', new.note, new.by_user, new.by_name, new.at,
            jsonb_build_object('method', new.method));
  else
    update public.crm_opportunities
       set contacted_at = greatest(coalesce(contacted_at, new.at), new.at),
           status = case when status = 'open' then 'contacted' else status end,
           updated_by_name = coalesce(new.by_name, updated_by_name)
     where id = new.item_id;
  end if;
  return new;
end $$;
drop trigger if exists crm_contact_log_apply on public.crm_contact_log;
create trigger crm_contact_log_apply after insert on public.crm_contact_log
  for each row execute function public.crm_contact_log_apply();

-- 4. What is untouched: assigned, and neither started nor contacted. Started = a ticket with a
-- scheduled day or a field status (en route / on site) or past Open; an opportunity past Open.
-- Every untouched item is returned with its limit so the app can show "no contact yet" before
-- the limit and red past it. SECURITY DEFINER with the item tables' read rules repeated, so the
-- assignee names come through (profiles hides other users' rows) and the cron's service role
-- sees everything.
create or replace function public.crm_untouched()
returns table (
  kind text, item_id uuid, title text, url text, account_name text,
  assignee_id uuid, assignee_name text, assigned_at timestamptz, limit_days integer
)
language sql stable security definer set search_path = public as $$
  with s as (
    select ticket_untouched_days as t, opportunity_untouched_days as o from public.crm_settings where id = 1
  ),
  who as (
    select auth.role() = 'service_role' as svc,
           public.has_access('customers') as cust,
           public.has_access('service') as serv,
           public.has_access('estimate') as est,
           public.is_technician() as tech,
           public.is_admin() as adm
  )
  select 'ticket', j.id,
         '#' || j.number || ' ' || j.customer_name || coalesce(' — ' || nullif(j.description, ''), ''),
         '/service?id=' || j.id, j.customer_name,
         j.technician_id, coalesce(nullif(trim(p.full_name), ''), p.email), j.assigned_at, s.t
    from public.service_jobs j
    cross join s cross join who
    left join public.profiles p on p.id = j.technician_id
   where j.deleted_at is null
     and j.technician_id is not null
     and j.stage = 'open' and j.scheduled_date is null and j.field_status is null
     and j.contacted_at is null
     and (who.svc or who.cust
          or (who.serv and (not who.tech or who.adm or j.technician_id = auth.uid())))
  union all
  select 'opportunity', o.id, o.title, '/opportunities?id=' || o.id, a.name,
         o.assignee_id, coalesce(nullif(trim(p.full_name), ''), p.email), o.assigned_at, s.o
    from public.crm_opportunities o
    cross join s cross join who
    left join public.profiles p on p.id = o.assignee_id
    left join public.crm_accounts a on a.id = o.account_id
   where o.deleted_at is null
     and o.assignee_id is not null
     and o.status = 'open' and o.contacted_at is null
     and (who.svc or who.cust or who.est or o.assignee_id = auth.uid());
$$;
revoke all on function public.crm_untouched() from public;
grant execute on function public.crm_untouched() to authenticated, service_role;

-- 5. Who hears about untouched items past the limit: admins (when the setting says so) plus any
-- users the admin names.
create or replace function public.escalation_recipients()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
    from public.profiles p, public.crm_settings s
   where s.id = 1
     and ((s.escalate_to_admins and p.role = 'admin') or p.id = any(s.escalate_user_ids))
     and (auth.role() = 'service_role' or public.has_access('customers')
          or public.has_access('service') or public.has_access('estimate'));
$$;
revoke all on function public.escalation_recipients() from public;
grant execute on function public.escalation_recipients() to authenticated, service_role;
