-- The service bucket's fourth read clause narrowed to PHOTOS (owner, Oct 21: "go with d").
--
-- 20261021120000_service_objects_fence.sql let a technician read any file under a live ticket at
-- the same property as one of their own — so the History at this property fold can sign those
-- photos under their login. That clause was wider than the fold needs: a receipt or a signature
-- under such a ticket was signable too, given its path (paths are not handed out and carry a
-- time and a random suffix, so this closes a door nobody could find, not one anybody used).
--
-- Now the same-property clause admits a file only when a service_job_photos row of that ticket
-- names it (storage_path = the object) and the row is not the signature. The caller's OWN
-- ticket's files (photos, signature, receipts) stay as they were — they upload and sign those.
-- Invoice PDFs and everything else unchanged. Policies unchanged (they call this function).
-- Idempotent. Pinned by src/lib/service-objects-history-photos.test.ts.
create or replace function public.service_object_readable(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when object_name like 'invoices/%' then
      public.is_admin() or public.is_manager() or public.is_sales_pm()
    when split_part(object_name, '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      public.has_access('customers')
      or (public.has_access('service') and not public.is_technician())
      or (public.has_access('service') and exists (
            select 1 from public.service_jobs j
             where j.id = split_part(object_name, '/', 1)::uuid and j.deleted_at is null
               and (j.technician_id = auth.uid() or public.is_on_crew(j.id))))
      or (public.has_access('service') and exists (
            select 1
              from public.service_jobs j
              join public.service_jobs mine on mine.site_id = j.site_id
              join public.service_job_photos ph on ph.service_job_id = j.id
             where j.id = split_part(object_name, '/', 1)::uuid and j.deleted_at is null
               and j.site_id is not null and mine.deleted_at is null
               and ph.storage_path = object_name and ph.role <> 'signature'
               and (mine.technician_id = auth.uid() or public.is_on_crew(mine.id))))
    else
      public.has_access('customers')
      or (public.has_access('service') and not public.is_technician())
  end;
$$;
revoke all on function public.service_object_readable(text) from public;
grant execute on function public.service_object_readable(text) to authenticated, service_role;
