-- Time, repairs and photos on a ticket follow its stage for a technician (owner, Oct 6). The
-- rule: a technician changes time, repairs and materials only on a ticket they are on while it
-- is Open / Scheduled / Done; a manager or an admin at any stage before Invoiced; anyone else
-- (office, sales) as before for their role but never on an Invoiced / Closed ticket. The server
-- functions apply the whole rule (src/lib/field-edit-lock.ts fieldEditProblem, called by
-- saveTimeEntry / deleteTimeEntry / saveJobRepair / deleteJobRepair and by addMovement); the
-- database adds the technician's half for the child tables, so a technician's own client cannot
-- write time or a repair on their Authorized / Invoiced / Closed ticket around the app.
--
-- The write policies of 20261002120000_service_child_rls.sql (works_on_ticket: Service access and
-- one of admin / manager / office / the lead / the crew) gain a second term, ticket_open_for_tech:
-- true for anyone who is not a plain technician, and for a technician only while the ticket is
-- Open / Scheduled / Done. Both sides (USING for update / delete, WITH CHECK for insert /
-- update). Reads are untouched: the read policies (service_time_entries_read and the two others,
-- 20260927130000) stand on their own. works_on_ticket itself is unchanged (the "service" storage
-- bucket keeps using it), and inventory_movements' policies are not touched — addMovement is the
-- gate there. Idempotent.

create or replace function public.ticket_open_for_tech(job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_technician() or public.is_admin() or public.is_manager()
      or exists (
        select 1 from public.service_jobs j
         where j.id = job and j.stage in ('open', 'scheduled', 'done')
      );
$$;
revoke all on function public.ticket_open_for_tech(uuid) from public;
grant execute on function public.ticket_open_for_tech(uuid) to authenticated;

drop policy if exists service_time_entries_write on public.service_time_entries;
create policy service_time_entries_write on public.service_time_entries for all to authenticated
  using (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id))
  with check (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id));

drop policy if exists service_job_repairs_write on public.service_job_repairs;
create policy service_job_repairs_write on public.service_job_repairs for all to authenticated
  using (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id))
  with check (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id));

drop policy if exists service_job_photos_write on public.service_job_photos;
create policy service_job_photos_write on public.service_job_photos for all to authenticated
  using (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id))
  with check (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id));
