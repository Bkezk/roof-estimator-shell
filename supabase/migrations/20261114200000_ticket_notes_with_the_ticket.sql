-- A technician reads a ticket's notes and hours only with the ticket (security audit, Nov 14;
-- owner: "go with the technician fix pls").
--
-- Found: a technician opens a ticket only when it is theirs or they are on its crew
-- (service_jobs_read). The ticket's photos and repairs follow that. Its activity notes
-- (service_job_events) and its time entries (service_time_entries) did not: anyone with the
-- Service page could read every row. No screen shows a technician another ticket's notes, but a
-- technician's sign-in used directly against the database could read all of them. Measured on
-- the live database: a technician on no ticket saw 0 tickets, 358 notes and 20 time entries.
--
-- This file gives both tables the rule the photos and the repairs already have:
--   * Customers access: everything, as before;
--   * Service access and not a technician (office, managers, admins): everything, as before;
--   * a technician: the rows of a live ticket they lead or are on the crew of, and the rows
--     they made themselves (their own notes, their own hours).
--
-- Only the two read rules change. Who may write is untouched. Idempotent. No data changes.
alter policy "service_job_events_read" on public.service_job_events using (
  (select public.has_access('customers'))
  or (
    (select public.has_access('service'))
    and (
      not (select public.is_technician())
      or by_user = (select auth.uid())
      or exists (
        select 1
          from public.service_jobs j
         where j.id = service_job_events.service_job_id
           and j.deleted_at is null
           and (j.technician_id = (select auth.uid()) or public.is_on_crew(j.id))
      )
    )
  )
);

alter policy "service_time_entries_read" on public.service_time_entries using (
  (select public.has_access('customers'))
  or (
    (select public.has_access('service'))
    and (
      not (select public.is_technician())
      or technician_id = (select auth.uid())
      or exists (
        select 1
          from public.service_jobs j
         where j.id = service_time_entries.service_job_id
           and j.deleted_at is null
           and (j.technician_id = (select auth.uid()) or public.is_on_crew(j.id))
      )
    )
  )
);
