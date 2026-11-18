-- "Viewable to technicians", unticked, means a technician does not see it (owner, Nov 18, of
-- the audit: "fix please").
--
-- The tick decided only what showed in the history pop-up on LATER tickets at the property. On
-- the ticket itself the rule was "whoever can see the ticket sees its whole log", so the
-- ticket's own technician still read an unticked office note in Activity, and the message after
-- unticking said "Technicians can no longer see it".
--
-- Now a technician-only login (is_technician(): ticked Technician, no office page) reads, on a
-- ticket or an opportunity it can see:
--   - every entry ticked "Viewable to technicians";
--   - its own entries;
--   - the lines the site writes itself: a date or hold line (method note) and the close-out's
--     "Service done" summary (method service). These never carried the tick.
-- Everyone else reads what they read before. Writing is unchanged.
--
-- Safe with the older site still published. Safe to run twice.
drop policy if exists crm_contact_log_read on public.crm_contact_log;
create policy crm_contact_log_read on public.crm_contact_log for select to authenticated
  using (
    ((kind = 'ticket' and exists (select 1 from public.service_jobs j where j.id = item_id))
      or (kind = 'opportunity'
          and exists (select 1 from public.crm_opportunities o where o.id = item_id)))
    and (
      not (select public.is_technician())
      or tech_visible
      or by_user = (select auth.uid())
      or method in ('note', 'service')
    )
  );
