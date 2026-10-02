-- Service child tables, the "service" bucket and hard deletes of tickets (audit, Oct 2).
--
-- 1. Time, repairs and photos: writing them needed only Service access (20260927130000), so any
--    Service user could write time, repairs and photos on any ticket, around the app's own rule
--    (service-field.functions.ts ownJob). Now a write needs Service access and one of: an admin
--    or a manager; an office user (not ticked Technician); the ticket's lead technician
--    (leads_job) or a member of its crew (is_on_crew). Reads are unchanged.
-- 2. The "service" bucket: insert / delete had no path or role guard, so any Service user could
--    delete any ticket's photos. Now insert, update and delete need: for a ticket's files
--    (<ticket id>/...) the same rule as 1 for that ticket; for invoice PDFs (invoices/...) an
--    admin, a manager or a sales / project manager (who finalise invoices; the read policy
--    already limits invoices/ to them); for anything else an admin or a manager. Reads unchanged.
-- 3. A ticket that has invoices is not hard-deleted (its invoices would cascade away with it):
--    "Void or delete the invoices first". The app deletes tickets softly (deleted_at).
-- 4. One live repair ticket per inspection (service_jobs.from_job_id): the server returns the
--    existing one (service-inspection.functions.ts createRepairFromInspection); this index closes
--    the race of two requests at once. Created only when the data has no duplicates already.
--
-- Idempotent: create or replace, drop ... if exists before every create.

-- 1. Who may write on a ticket's time, repairs and photos.
create or replace function public.works_on_ticket(job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_access('service')
     and (public.is_admin() or public.is_manager() or not public.is_technician()
          or public.leads_job(job) or public.is_on_crew(job));
$$;
revoke all on function public.works_on_ticket(uuid) from public;
grant execute on function public.works_on_ticket(uuid) to authenticated;

drop policy if exists service_time_entries_write on public.service_time_entries;
create policy service_time_entries_write on public.service_time_entries for all to authenticated
  using (public.works_on_ticket(service_job_id))
  with check (public.works_on_ticket(service_job_id));

drop policy if exists service_job_repairs_write on public.service_job_repairs;
create policy service_job_repairs_write on public.service_job_repairs for all to authenticated
  using (public.works_on_ticket(service_job_id))
  with check (public.works_on_ticket(service_job_id));

drop policy if exists service_job_photos_write on public.service_job_photos;
create policy service_job_photos_write on public.service_job_photos for all to authenticated
  using (public.works_on_ticket(service_job_id))
  with check (public.works_on_ticket(service_job_id));

-- 2. Who may write an object in the "service" bucket, by its path. The first path segment is
-- cast to a ticket id only when it is shaped like one (the CASE keeps the cast from running on
-- anything else).
create or replace function public.service_object_writable(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when object_name like 'invoices/%' then
      public.is_admin() or public.is_manager() or public.is_sales_pm()
    when split_part(object_name, '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      public.works_on_ticket(split_part(object_name, '/', 1)::uuid)
    else
      public.is_admin() or public.is_manager()
  end;
$$;
revoke all on function public.service_object_writable(text) from public;
grant execute on function public.service_object_writable(text) to authenticated;

drop policy if exists service_objects_insert on storage.objects;
create policy service_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'service' and public.service_object_writable(name));
drop policy if exists service_objects_update on storage.objects;
create policy service_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'service' and public.service_object_writable(name))
  with check (bucket_id = 'service' and public.service_object_writable(name));
drop policy if exists service_objects_delete on storage.objects;
create policy service_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'service' and public.service_object_writable(name));

-- 3. No hard delete of a ticket that has invoices (void ones included: they are the record).
create or replace function public.service_jobs_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.invoices i where i.service_job_id = old.id) then
    raise exception 'Void or delete the invoices first' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.service_jobs_delete_guard() from public;

drop trigger if exists service_jobs_delete_guard on public.service_jobs;
create trigger service_jobs_delete_guard before delete on public.service_jobs
  for each row execute function public.service_jobs_delete_guard();

-- 4. One live repair ticket per inspection.
do $$
begin
  if exists (
    select 1 from public.service_jobs
     where from_job_id is not null and deleted_at is null
     group by from_job_id having count(*) > 1
  ) then
    raise notice 'service_jobs_from_job_live_idx not created: an inspection already has more than one live repair ticket';
  else
    create unique index if not exists service_jobs_from_job_live_idx
      on public.service_jobs (from_job_id)
      where from_job_id is not null and deleted_at is null;
  end if;
end;
$$;
