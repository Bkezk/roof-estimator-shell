-- Follow-ups are management's (owner, Oct 1): "the follow-up and overdue things are so management
-- can keep reps / account managers responsible, so they shouldn't be able to turn them off or
-- disable due dates — that's only for managers". Snoozing or closing a follow-up by hand is an
-- admin's or a manager's; the automatic sync (src/lib/followups.server.ts syncFollowup: the item
-- is invoiced / closed / won / lost / unassigned / reassigned) keeps closing rows for everyone.
-- Date moves are logged: an opportunity's "Expected close moved …" line goes in the contact log
-- as a plain note (method 'note') that does not count as a contact. Idempotent.

-- 1. A snooze is recorded (snoozed_until) so My Work can say "Snoozed until …" and the trigger
-- can see it; the sync's closes are marked (closed_by_sync), because the sync also writes a
-- closed_reason ("stage invoiced", "status won", "reassigned", …) and so cannot be told apart
-- from a manual close by the reason alone.
alter table public.crm_followups add column if not exists snoozed_until timestamptz;
alter table public.crm_followups add column if not exists closed_by_sync boolean not null default false;

-- 2. The rule. A signed-in user who is neither an admin nor a manager may not snooze, close by
-- hand, or delete a follow-up. The service role (the published app's server, the cron) and SQL
-- run with no signed-in user (the SQL editor, migrations) are the system and pass.
create or replace function public.crm_followups_manager_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null
     or public.is_admin() or public.is_manager() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  -- A snooze: the status becomes 'snoozed', or a new snoozed_until is set.
  if (new.status = 'snoozed' and old.status is distinct from 'snoozed')
     or (new.snoozed_until is not null and new.snoozed_until is distinct from old.snoozed_until) then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  -- A manual close: closed, and not by the sync.
  if new.status = 'closed' and old.status is distinct from 'closed'
     and not coalesce(new.closed_by_sync, false) then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists crm_followups_manager_only on public.crm_followups;
create trigger crm_followups_manager_only before update on public.crm_followups
  for each row execute function public.crm_followups_manager_only();
drop trigger if exists crm_followups_manager_only_delete on public.crm_followups;
create trigger crm_followups_manager_only_delete before delete on public.crm_followups
  for each row execute function public.crm_followups_manager_only();

-- 3. The contact log takes a plain note (method 'note': "Expected close moved from … to …").
-- A note is not a contact: it does not stamp contacted_at or move an Open opportunity to
-- Contacted, so pushing a date never makes an item look touched.
alter table public.crm_contact_log drop constraint if exists crm_contact_log_method_check;
alter table public.crm_contact_log add constraint crm_contact_log_method_check
  check (method in ('called','texted','emailed','visited','other','note'));

create or replace function public.crm_contact_log_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.method = 'note' then
    return new;
  end if;
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
