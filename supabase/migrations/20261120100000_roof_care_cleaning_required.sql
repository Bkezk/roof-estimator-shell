-- Roof Care: the cleaning a plan includes is answered before its inspection is finished (owner,
-- Nov 20: "those questions should be required").
--
-- Until now only the ticket workflow asked "Were the drains and scuppers cleaned?" and "Were the
-- gutters cleaned?". The server behind Complete checked nothing of it, and a manager who set Done
-- or Authorized from the ticket page's stage picker went straight past them.
--
-- The rule lives here, where every way of writing a stage ends up: a ticket that is a plan's own
-- inspection does not move into Done, Authorized, Invoiced or Closed from a stage before them
-- while a question the plan asks at that inspection is unanswered. It binds everybody: the
-- technician, the office, managers, admins, and the invoice's own stage change.
--
-- Only the MOVE is checked. A ticket already Done or later moves on as before. A storm
-- inspection is asked nothing, Roof Watch is asked nothing, Roof Care is asked the drains, Roof
-- Guard the drains and the gutters (roof_care_set_cleaning has the same three lines). A ticket
-- that is not a plan's inspection is never read.

create or replace function public.service_jobs_cleaning_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v record;
  v_open text := '';
begin
  if new.roof_care_visit_id is null
     or new.stage not in ('done', 'authorized', 'invoiced', 'closed')
     or coalesce(old.stage, '') in ('done', 'authorized', 'invoiced', 'closed')
  then
    return new;
  end if;
  select vi.kind, vi.drains_cleaned, vi.gutters_cleaned, p.plan into v
    from public.roof_care_visits vi
    join public.roof_care_plans p on p.id = vi.plan_id
   where vi.id = new.roof_care_visit_id;
  if not found then
    raise exception 'This ticket is a Roof Care plan inspection, but its plan could not be read, so what the plan includes here could not be checked. Nothing was changed. Ask an admin.';
  end if;
  if v.kind = 'storm' then
    return new;
  end if;
  if v.plan in ('care', 'guard') and v.drains_cleaned is null then
    v_open := v_open || ' Were the drains and scuppers cleaned?';
  end if;
  if v.plan = 'guard' and v.gutters_cleaned is null then
    v_open := v_open || ' Were the gutters cleaned?';
  end if;
  if v_open <> '' then
    raise exception 'Not answered yet:% This is a Roof Care plan inspection. Press Open ticket, answer Yes or No in the Checklist step, then finish the ticket.', v_open;
  end if;
  return new;
end;
$function$;

revoke all on function public.service_jobs_cleaning_rule() from public, anon, authenticated;

drop trigger if exists service_jobs_cleaning_rule on public.service_jobs;
create trigger service_jobs_cleaning_rule
  before update of stage on public.service_jobs
  for each row execute function public.service_jobs_cleaning_rule();

notify pgrst, 'reload schema';
