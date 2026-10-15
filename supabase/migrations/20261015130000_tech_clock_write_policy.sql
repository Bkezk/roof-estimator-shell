-- service_tech_clock write policy, tightened (Oct 15, same day as the table): technicians have
-- Service access, so "has_access('service')" let any technician move another technician's clock.
-- Own row, or the office: admins, managers, and Service users who are not technicians.
-- Applied live Oct 15. Idempotent.
drop policy if exists service_tech_clock_write on public.service_tech_clock;
create policy service_tech_clock_write on public.service_tech_clock for all to authenticated
  using (technician_id = auth.uid() or public.is_admin() or public.is_manager()
         or (public.has_access('service') and not public.is_technician()))
  with check (technician_id = auth.uid() or public.is_admin() or public.is_manager()
         or (public.has_access('service') and not public.is_technician()));
