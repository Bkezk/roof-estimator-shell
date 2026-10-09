-- Office users create, dispatch and move a ticket's date, logged (owner, Oct 9: "lets make
-- office users able to create, dispatch, and move a tickets date but make that activity
-- logged"). The app twin is `dispatchesTickets` (src/lib/access.ts) = admin or manager
-- (`managesTickets`), or anyone who is not technician-only (`isOffice`) with Service access.
-- Money stays a manager's: crew $/hour, labor rate, repair prices, invoices, Service Rates,
-- deleting a ticket — none of those policies move here.
--
-- What blocked office dispatch, read across every service_jobs policy and trigger:
--   1. service_jobs_insert (20261001050000_ticket_money_managers.sql): Service and admin or
--      manager. Widened to the office: `not public.is_technician()` — since
--      20261008190000 a technician-only user (role user, ticked Technician, no page beyond
--      Service and Inventory); an office person ticked Technician is NOT this, so they create
--      too. A technician-only user still cannot insert.
--   2. set_job_crew (20261002160000_tech_price_free_reads.sql), SECURITY DEFINER: "the lead or a
--      manager". assignServiceJob / saveServiceJob re-lead the crew's row 0 after a technician
--      change (service-crew.server.ts syncCrewLead → writeCrew → set_job_crew), so an office
--      dispatch of any ticket that already has crew rows was refused there. Widened to the
--      office with Service, for who is on the job only: the rate branch is unchanged (a
--      non-manager's row keeps the stored rate; a different rate is refused), and so is the
--      service_job_techs_rate_guard trigger behind it.
-- Not touched, because they already let the office through or do not bind it:
--   - service_jobs_update (20261006190000_stage_backwards_lock.sql): `not is_technician() or
--     admin or manager or (own ticket, technician stages)` — the office passes both sides.
--   - service_jobs_stage_rule (20261006190000): guards only Authorized / Invoiced / Closed, both
--     ways; a dispatch sets Open / Scheduled.
--   - service_jobs_stamp_assigned, service_jobs_stage_log, service_jobs_stage_changed,
--     service_jobs_updated_at: stamps and logs, no refusal.
--   - service_jobs_delete_guard / service_jobs_delete: deleting stays a manager's (the app
--     soft-deletes; deleteServiceJob is managesTickets).
--   - service_job_events_insert (20260927130000): has_access('service') — the Timeline's "Date
--     moved …" row (logTicketDateMove) is the office's to write already.
--   - crm_followups (20261002140000_followup_guard.sql): the follow-up sync runs through
--     followup_sync_upsert / followup_sync_close, which check the item, not the caller's role.
--
-- LOGGING (verified, not changed): service_jobs_audit (20261005130000_ticket_audit.sql; audit_row
-- last rewritten in 20261009100000_tasks_tracking.sql) writes every insert / update / delete of a
-- ticket to audit_log with by_name and by_role — the ticket's History fold (AuditHistory entity
-- 'ticket', admins and managers). A date move also lands on the ticket's Timeline
-- (service_job_events "Date moved from … to …", logTicketDateMove). audit_row()'s role branch
-- knows admin / manager / sales / technician / user: an office user reads as 'sales' when they
-- hold the Invoices page (is_sales_pm) and 'user' otherwise — left as is here (changing it means
-- rewriting audit_row(); reported instead).
--
-- Idempotent: the policy is dropped first; the function is create or replace.

-- 1. Creating a ticket: a manager, an admin, or the office (not technician-only) with Service.
drop policy if exists service_jobs_insert on public.service_jobs;
create policy service_jobs_insert on public.service_jobs for insert to authenticated
  with check (
    public.has_access('service')
    and (public.is_admin() or public.is_manager() or not public.is_technician())
  );

-- 2. set_job_crew: the office may say who is on the job (dispatch re-leads row 0); rates stay a
-- manager's. The body is 20261002160000_tech_price_free_reads.sql's exactly, plus the office
-- term in the caller check.
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
  if not (public.has_access('service')
          and (v_manager or public.leads_job(p_job) or not public.is_technician())) then
    raise exception 'Only the technician on this ticket, the office or a manager says who is on the job'
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
