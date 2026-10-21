-- The "service" storage bucket's files — ticket photos, signatures and purchase-order receipts
-- under "<ticket id>/…", invoice PDFs under "invoices/…" — fenced for a technician (owner, Oct 21,
-- after History at this property shipped: "go ahead and land it").
--
-- Until now service_objects_read (last 20261001070000_sales_invoices_audit.sql) let ANY login
-- with the Service or Customers page read, and so sign a link to, any file in the bucket but the
-- invoice PDFs; service_objects_delete (20260927130000_service_field.sql) let any Service login
-- delete any file. The rows that name the files (service_job_photos, service_job_purchase_orders)
-- were fenced today (20261021110000_site_history.sql); this closes the files themselves, and the
-- delete.
--
-- Reads (service_object_readable, the twin of service_object_writable from 20261002120000):
--   invoices/…      admins, managers and sales / project managers, as before;
--   <ticket id>/…   Customers access; Service access without the technician kind (the office,
--                   managers, admins); a technician for a live ticket they lead or are on the
--                   crew of; and a technician for a live ticket at the SAME PROPERTY as one they
--                   lead or crew — the History at this property fold signs those photos under the
--                   technician's own login (service-history.functions.ts siteHistory);
--   anything else   the office (Customers access or Service without the technician kind).
-- Deletes: the write rule (service_object_writable: the people who work that ticket; invoice
-- PDFs the invoicers'), or an admin.
--
-- Every technician path still passes: the ticket page's thumbnails and the photo viewer sign
-- their own ticket's paths (field-utils.ts useSignedUrl); the close-out's signature and the
-- receipts likewise; the history signs paths of tickets at their property. Idempotent. Pinned by
-- src/lib/service-objects-fence.test.ts.
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
             where j.id = split_part(object_name, '/', 1)::uuid and j.deleted_at is null
               and j.site_id is not null and mine.deleted_at is null
               and (mine.technician_id = auth.uid() or public.is_on_crew(mine.id))))
    else
      public.has_access('customers')
      or (public.has_access('service') and not public.is_technician())
  end;
$$;
revoke all on function public.service_object_readable(text) from public;
grant execute on function public.service_object_readable(text) to authenticated, service_role;

drop policy if exists service_objects_read on storage.objects;
create policy service_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'service' and public.service_object_readable(name));

drop policy if exists service_objects_delete on storage.objects;
create policy service_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'service' and (public.is_admin() or public.service_object_writable(name)));
