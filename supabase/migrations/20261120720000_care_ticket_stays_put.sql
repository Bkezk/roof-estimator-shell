-- Roof Care: a plan's inspection ticket stays the plan's inspection (break test Nov 20, number
-- 18).
--
-- Until now such a ticket could be moved to another property or customer, or changed to a
-- Repair, and it still counted as the plan's inspection: the plan showed an inspection done
-- that was never made at its property. Now the database refuses each of the three, in plain
-- words. Its technician, date, notes and stage change as before.
--
-- A rule of its own (service_jobs_care_plan_rule and service_jobs_cleaning_rule are not
-- touched). One change is let through: the customer following the property (the property was
-- moved to another customer when two customers were merged; the ticket goes with it).

create or replace function public.service_jobs_care_ticket_stays()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if old.roof_care_visit_id is null or new.roof_care_visit_id is null then
    return new;
  end if;
  -- A property or customer row removed outright empties the ticket's pointer on its way out;
  -- that is not a move, and the plan's own tie to the row decides whether it may go.
  if new.site_id is null and old.site_id is not null
     and not exists (select 1 from public.crm_sites s where s.id = old.site_id)
  then
    return new;
  end if;
  if new.account_id is null and old.account_id is not null
     and not exists (select 1 from public.crm_accounts a where a.id = old.account_id)
  then
    return new;
  end if;
  if new.site_id is distinct from old.site_id then
    raise exception 'Ticket #% is a Roof Care plan inspection for its property. It cannot be moved to another property. For work somewhere else, open a new ticket there.', old.number
      using errcode = '23514';
  end if;
  if new.account_id is distinct from old.account_id
     and not exists (
       select 1 from public.crm_sites s
        where s.id = new.site_id and s.account_id = new.account_id)
  then
    raise exception 'Ticket #% is a Roof Care plan inspection for its customer. It cannot be moved to another customer. For work for someone else, open a new ticket for them.', old.number
      using errcode = '23514';
  end if;
  if new.service_type is distinct from old.service_type then
    raise exception 'Ticket #% is a Roof Care plan inspection. It cannot be changed to another kind of ticket. For a repair, start a repair ticket from this inspection once it is done.', old.number
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.service_jobs_care_ticket_stays() from public, anon, authenticated;

drop trigger if exists service_jobs_care_ticket_stays on public.service_jobs;
create trigger service_jobs_care_ticket_stays
  before update of site_id, account_id, service_type on public.service_jobs
  for each row execute function public.service_jobs_care_ticket_stays();
