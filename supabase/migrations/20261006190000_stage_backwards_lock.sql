-- Nobody but a manager moves a ticket out of Authorized, Invoiced or Closed, and a technician
-- cannot edit one (owner, Oct 6). Proven live on Oct 6: a technician moved their own Authorized
-- ticket back to Done (and edited its notes), and their Closed ticket back to Open. Two gaps:
--
-- 1. The stage rule (service_jobs_stage_rule, last 20261005140000_authorized_stage.sql) guarded
--    only moves INTO Authorized / Invoiced / Closed; a move OUT of them was anyone's. Now a
--    non-manager is refused when the ticket's stage is one of those and the stage changes. The
--    exemptions are the ones the forward rule already had: the service role, SQL with no user
--    (migrations, the SQL editor) and the invoice path — set_ticket_stage_from_invoice is
--    SECURITY DEFINER, sets jbk.stage_from_invoice, and sends an Invoiced / Closed ticket back to
--    Authorized when its last live invoice is voided. That function is not touched here.
-- 2. A technician's update policy (service_jobs_update, 20260930093000_manager_role.sql) checked
--    the stage on the NEW row only (WITH CHECK), so a technician could rewrite an Authorized /
--    Invoiced / Closed ticket of theirs: set a technician stage, or keep the stage and edit the
--    rest. Now both sides require the technician's stages — the row as it is (USING) and as it
--    will be (WITH CHECK). Admins, managers and office users (not ticked Technician) are
--    unchanged, so the office still saves an Invoiced ticket, and a technician still saves and
--    marks Done their own Open / Scheduled ticket (saveServiceJob, setFieldStatus).
--
-- The app twin is stageProblem (src/lib/ticket-stage.ts), which now reads the current stage, and
-- saveServiceJob's TECH_LOCKED_MESSAGE. Idempotent.

-- 1. ------------------------------------------------------------------------------------------
create or replace function public.service_jobs_stage_rule()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_exempt boolean;
begin
  -- Who the rule does not bind: no user (SQL, migrations), the service role (the app's system
  -- client), admins and managers, and the invoice path (set_ticket_stage_from_invoice).
  v_exempt := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role'
    or public.is_admin()
    or public.is_manager()
    or coalesce(current_setting('jbk.stage_from_invoice', true), '') = 'on';
  if v_exempt then
    return new;
  end if;
  -- Into Authorized / Invoiced / Closed (20261005140000).
  if new.stage in ('authorized', 'invoiced', 'closed')
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage)
  then
    raise exception 'Only a manager authorizes, invoices or closes a ticket' using errcode = '42501';
  end if;
  -- Out of them (owner, Oct 6).
  if tg_op = 'UPDATE'
     and old.stage in ('authorized', 'invoiced', 'closed')
     and new.stage is distinct from old.stage
  then
    raise exception 'Only a manager moves a ticket out of Authorized, Invoiced or Closed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.service_jobs_stage_rule() from public;

drop trigger if exists service_jobs_stage_rule on public.service_jobs;
create trigger service_jobs_stage_rule before insert or update of stage on public.service_jobs
  for each row execute function public.service_jobs_stage_rule();

-- 2. ------------------------------------------------------------------------------------------
drop policy if exists service_jobs_update on public.service_jobs;
create policy service_jobs_update on public.service_jobs for update to authenticated
  using (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or public.is_manager()
         or (technician_id = auth.uid() and stage in ('open', 'scheduled', 'done')))
  )
  with check (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or public.is_manager()
         or (technician_id = auth.uid() and stage in ('open', 'scheduled', 'done')))
  );
