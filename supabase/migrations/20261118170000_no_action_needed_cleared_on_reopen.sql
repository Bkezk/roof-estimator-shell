-- "No action needed" does not outlive the inspection it was chosen for (owner, Nov 18, of the
-- audit: "fix please").
--
-- An inspection marked "No action needed" left the Owner page's Needs attention list for good.
-- If the ticket was then reopened and inspected again, with new problems, the old choice still
-- stood and the row never came back. Now the choice is cleared when the ticket goes back to
-- Open or Scheduled from Done or later, so the redone inspection is looked at afresh.
--
-- Only "No action needed" is cleared. A repair ticket or a bid that came of the inspection is a
-- real record and keeps its link. Who may press the button, and taking it back by hand, are the
-- site's (service-inspection.functions.ts).
--
-- Safe with the older site still published. Safe to run twice.
create or replace function public.service_jobs_reopen_clears_no_action()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.inspection_outcome = 'none'
     and old.stage in ('done', 'authorized', 'invoiced', 'closed')
     and new.stage in ('open', 'scheduled')
  then
    new.inspection_outcome := null;
    new.inspection_outcome_at := null;
    new.inspection_outcome_by := null;
  end if;
  return new;
end;
$function$;
drop trigger if exists service_jobs_reopen_clears_no_action on public.service_jobs;
create trigger service_jobs_reopen_clears_no_action
  before update of stage on public.service_jobs
  for each row execute function public.service_jobs_reopen_clears_no_action();
revoke all on function public.service_jobs_reopen_clears_no_action() from public, anon, authenticated;
