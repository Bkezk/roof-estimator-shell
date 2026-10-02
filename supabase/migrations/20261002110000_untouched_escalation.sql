-- Untouched-work escalation on its own clock (audit, Oct 2). The escalation to the admins and the
-- "also escalate to" people only went out when the item's own follow-up reminder fired, so with
-- the live settings (ticket untouched after 2 days; first reminder after 1 day, then every 3) the
-- first escalation landed on day 4. The reminder pass (src/lib/notify.server.ts
-- dispatchDueReminders) now escalates every item crm_untouched() returns past its limit on the
-- first pass after the limit, then again every ticket_every_days / opportunity_every_days, and
-- records when on the item (escalated_at) so the cron and the app's page-load pass never send
-- the same escalation twice: each pass claims the item (a conditional update of escalated_at)
-- before sending, exactly as it claims a follow-up's reminder. Idempotent.
--
-- crm_untouched() is unchanged: it already lets the service role through
-- (auth.role() = 'service_role', 20260928120000_untouched.sql), so the cron sees every item.

-- 1. When the item was last escalated (null: never, or not since its latest assignment).
alter table public.service_jobs add column if not exists escalated_at timestamptz;
alter table public.crm_opportunities add column if not exists escalated_at timestamptz;

-- 2. A new assignment is a new item: handing it to someone else (or unassigning it) clears
-- escalated_at, so the new assignee gets the full limit and, if it sits again, the escalation
-- goes out again on the first pass past the limit. Same bodies as 20260928120000 plus the reset.
create or replace function public.service_jobs_stamp_assigned()
returns trigger language plpgsql as $$
begin
  if new.technician_id is null then
    new.assigned_at := null;
    new.escalated_at := null;
  elsif tg_op = 'INSERT' or new.technician_id is distinct from old.technician_id then
    new.assigned_at := now();
    new.escalated_at := null;
  end if;
  return new;
end $$;

create or replace function public.crm_opportunities_stamp_assigned()
returns trigger language plpgsql as $$
begin
  if new.assignee_id is null then
    new.assigned_at := null;
    new.escalated_at := null;
  elsif tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    new.assigned_at := now();
    new.escalated_at := null;
  end if;
  return new;
end $$;
-- (The triggers from 20260928120000 already call these functions; nothing to recreate.)

-- 3. Stamping escalated_at is bookkeeping, not an edit: it must not move updated_at (the lists
-- sort by it and show it as "updated"). Every other update stamps updated_at exactly as
-- update_updated_at_column() does.
create or replace function public.touch_updated_at_unless_escalation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.escalated_at is distinct from old.escalated_at
     and (to_jsonb(new) - 'escalated_at' - 'updated_at')
         = (to_jsonb(old) - 'escalated_at' - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.touch_updated_at_unless_escalation() from public;

drop trigger if exists service_jobs_updated_at on public.service_jobs;
create trigger service_jobs_updated_at before update on public.service_jobs
  for each row execute function public.touch_updated_at_unless_escalation();
drop trigger if exists crm_opportunities_updated_at on public.crm_opportunities;
create trigger crm_opportunities_updated_at before update on public.crm_opportunities
  for each row execute function public.touch_updated_at_unless_escalation();
