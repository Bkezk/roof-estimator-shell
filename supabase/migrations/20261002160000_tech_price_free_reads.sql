-- Technicians no longer read repair prices or crew bill rates from the database (audit, Oct 2).
--
-- Every screen already hid them (templatesForViewer, listJobCrew), but RLS let any Service user
-- select repair_templates.unit_price (repair_templates_read: Service / Customers / Estimate) and
-- service_job_techs.bill_rate (service_job_techs_read: Service / Customers; and the lead's
-- service_job_techs_lead is FOR ALL, so it granted SELECT of their tickets' rates too). RLS
-- cannot hide one column, so:
--
-- 1. set_job_crew(p_job, p_rows): the crew write (src/lib/service-crew.server.ts writeCrew) as
--    one SECURITY DEFINER call. The lead's upsert needed to read service_job_techs for its
--    conflict handling (ON CONFLICT DO UPDATE checks the existing row against the SELECT
--    policies), so it moves in here BEFORE the reads narrow. Today's rules, unchanged: the
--    ticket's lead technician (leads_job) or an admin / a manager, with Service access; a rate
--    is set or changed only by an admin or a manager. A lead cannot see rates any more, so a
--    lead's row without a rate keeps the rate stored for that member (none for a new member);
--    a lead's row with a rate other than the stored one is refused (42501). The trigger
--    service_job_techs_rate_guard (20261001050000) still runs under it as a second check.
-- 2. Two price-free views for everyone who read the tables before, with the old read rule as
--    their WHERE clause: repair_templates_catalog (every column but unit_price) and
--    service_job_crew (every column but bill_rate). They are plain (security_invoker = false)
--    views: a view cannot carry RLS policies of its own, and a security_invoker view would apply
--    the narrowed base-table policies to the caller, so a technician would see nothing through
--    it. Run with the view owner's rights (the migration role, which owns the tables), the view
--    reads the table without its RLS, and its WHERE clause is the read rule (has_access reads
--    auth.uid(), the caller's). security_barrier keeps a caller's own predicates from running
--    before that clause. Select only, to authenticated: a one-table view is auto-updatable, and
--    a write through it would run with the owner's rights, so every other privilege is revoked
--    (Supabase's default privileges grant all on new relations to anon and authenticated).
-- 3. The base-table reads narrowed (writes unchanged: repair_templates_write and
--    service_job_techs_write, admins and managers):
--    - repair_templates_read: admins, managers, sales / project managers, and office users (not
--      ticked Technician) with Service or Estimate access. The app reads the table only for a
--      manager (the template lists' price branch, saveRepairTemplate's returned row).
--    - service_job_techs_read: admins, managers, and sales / project managers with Service or
--      Customers access (the invoice builder, invoices.server.ts buildLinesFromJob, runs as
--      whoever may build an invoice: seesInvoices). service_job_techs_lead is dropped: the lead
--      writes only through set_job_crew and reads the crew through service_job_crew.
--    Neither rule lets in anyone the old one did not.
--
-- Applying it: sections 1 and 2 only add; the app version that calls them works with or without
-- section 3. Section 3 is what the app before this change cannot live with (a technician's
-- template picker and crew names read the tables). Either run the whole file and publish the app
-- straight after, or run sections 1-2, publish, then run section 3.
--
-- Idempotent: create or replace, drop ... if exists before every create, grants re-stated.

-- 1. The crew write. ------------------------------------------------------------------------
create or replace function public.set_job_crew(p_job uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_manager boolean := public.is_admin() or public.is_manager();
  v_row jsonb;
  v_keep uuid[] := '{}';
  v_tech uuid;
  v_sort integer;
  v_rate numeric;
  v_old numeric;
  v_had boolean;
begin
  if not (public.has_access('service') and (v_manager or public.leads_job(p_job))) then
    raise exception 'Only the technician on this ticket or a manager says who is on the job'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'The crew must be a list' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_tech := (v_row->>'technician_id')::uuid;
    if v_tech is null then
      raise exception 'A crew row needs a technician' using errcode = '22023';
    end if;
    v_keep := v_keep || v_tech;
  end loop;
  -- The members not kept leave (as writeCrew's delete did: NOT IN the kept list).
  delete from public.service_job_techs t
   where t.service_job_id = p_job and not (t.technician_id = any (v_keep));
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_tech := (v_row->>'technician_id')::uuid;
    v_sort := coalesce((v_row->>'sort')::integer, 0);
    v_rate := (v_row->>'bill_rate')::numeric;
    if not v_manager then
      -- No row: v_had and v_old are null (a new member).
      select true, t.bill_rate into v_had, v_old
        from public.service_job_techs t
       where t.service_job_id = p_job and t.technician_id = v_tech;
      if v_rate is not null and (v_had is null or v_old is distinct from v_rate) then
        raise exception 'Only a manager sets a technician''s rate on a ticket' using errcode = '42501';
      end if;
      v_rate := v_old;
    end if;
    insert into public.service_job_techs (service_job_id, technician_id, sort, bill_rate)
    values (p_job, v_tech, v_sort, v_rate)
    on conflict (service_job_id, technician_id)
    do update set sort = excluded.sort, bill_rate = excluded.bill_rate;
  end loop;
end; $$;
revoke all on function public.set_job_crew(uuid, jsonb) from public;
revoke all on function public.set_job_crew(uuid, jsonb) from anon;
grant execute on function public.set_job_crew(uuid, jsonb) to authenticated;

-- 2. The price-free views. --------------------------------------------------------------------
create or replace view public.repair_templates_catalog
  with (security_invoker = false, security_barrier = true) as
  select t.id, t.name, t.category, t.unit, t.description, t.work_completed, t.favorite,
         t.usage_count, t.active, t.centerpoint_template_id, t.created_at, t.updated_at
    from public.repair_templates t
   where public.has_access('service') or public.has_access('customers')
      or public.has_access('estimate');
revoke all on public.repair_templates_catalog from public, anon, authenticated;
grant select on public.repair_templates_catalog to authenticated;

create or replace view public.service_job_crew
  with (security_invoker = false, security_barrier = true) as
  select c.id, c.service_job_id, c.technician_id, c.sort, c.created_at
    from public.service_job_techs c
   where public.has_access('service') or public.has_access('customers');
revoke all on public.service_job_crew from public, anon, authenticated;
grant select on public.service_job_crew to authenticated;

-- 3. The base-table reads, narrowed. ----------------------------------------------------------
drop policy if exists repair_templates_read on public.repair_templates;
create policy repair_templates_read on public.repair_templates for select to authenticated
  using (public.is_admin() or public.is_manager() or public.is_sales_pm()
         or (not public.is_technician()
             and (public.has_access('service') or public.has_access('estimate'))));

drop policy if exists service_job_techs_lead on public.service_job_techs;
drop policy if exists service_job_techs_read on public.service_job_techs;
create policy service_job_techs_read on public.service_job_techs for select to authenticated
  using (public.is_admin() or public.is_manager()
         or (public.is_sales_pm()
             and (public.has_access('service') or public.has_access('customers'))));
