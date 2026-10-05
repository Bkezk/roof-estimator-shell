-- The Authorized stage (service study M9, owner Oct 5): "manager/owner move through the steps
-- to scheduled; it appears on the techs side; the tech moves it to completed; the owner then
-- moves it to authorized once reviewed, and then the manager moves it to invoiced and closed."
-- "The manager can move it past authorize if need be." Idempotent.
--
-- 1. 'authorized' joins the ticket stages, between 'done' and 'invoiced'.
-- 2. Authorized is a manager's stage, like Invoiced and Closed (the stage rule trigger; the app
--    twin is OFFICE_STAGES in src/lib/ticket-stage.ts). A technician's RLS already stops at
--    'open' / 'scheduled' / 'done' (service_jobs_update, 20260930093000), so an Authorized
--    ticket is read-only to them.
-- 3. set_ticket_stage_from_invoice may also set 'authorized': voiding the last live invoice of
--    an Invoiced / Closed ticket sends it back to Authorized (it was reviewed already), and
--    whoever may void (a sales / project manager too) does it through this path. Only when the
--    ticket has no final / sent / paid invoice left. The rest of the function is
--    20261001080000_audit_triggers_stage_rule.sql's.
-- (Marking an invoice paid no longer closes the ticket — owner, Oct 5: "close by hand" — that
-- is the app's change; the function still accepts 'closed' for a paid invoice.)

-- 1. ------------------------------------------------------------------------------------------
alter table public.service_jobs drop constraint if exists service_jobs_stage_check;
alter table public.service_jobs add constraint service_jobs_stage_check
  check (stage in ('open', 'scheduled', 'done', 'authorized', 'invoiced', 'closed'));

-- 2. ------------------------------------------------------------------------------------------
create or replace function public.service_jobs_stage_rule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage in ('authorized', 'invoiced', 'closed')
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage)
     and auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin()
     and not public.is_manager()
     and coalesce(current_setting('jbk.stage_from_invoice', true), '') <> 'on'
  then
    raise exception 'Only a manager authorizes, invoices or closes a ticket' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.service_jobs_stage_rule() from public;

drop trigger if exists service_jobs_stage_rule on public.service_jobs;
create trigger service_jobs_stage_rule before insert or update of stage on public.service_jobs
  for each row execute function public.service_jobs_stage_rule();

-- 3. ------------------------------------------------------------------------------------------
create or replace function public.set_ticket_stage_from_invoice(
  p_job uuid,
  p_stage text,
  p_invoice uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
  v_name text;
begin
  if auth.uid() is not null and not (public.is_admin() or public.is_manager() or public.is_sales_pm()) then
    raise exception 'Invoices are a manager''s or sales''' using errcode = '42501';
  end if;
  if p_stage = 'invoiced' then
    select exists (
      select 1 from public.invoices i
      where i.service_job_id = p_job
        and (p_invoice is null or i.id = p_invoice)
        and i.status in ('final', 'sent', 'paid')
    ) into v_ok;
  elsif p_stage = 'closed' then
    select exists (
      select 1 from public.invoices i
      where i.service_job_id = p_job
        and (p_invoice is null or i.id = p_invoice)
        and i.status = 'paid'
    ) into v_ok;
  elsif p_stage = 'authorized' then
    -- Back from Invoiced / Closed once no final / sent / paid invoice is left (a void).
    select exists (
      select 1 from public.service_jobs j
      where j.id = p_job and j.stage in ('invoiced', 'closed')
    ) and not exists (
      select 1 from public.invoices i
      where i.service_job_id = p_job and i.status in ('final', 'sent', 'paid')
    ) into v_ok;
  else
    raise exception 'An invoice sets a ticket Invoiced, Closed or back to Authorized, not %', p_stage;
  end if;
  if not v_ok then
    raise exception '%',
      case p_stage
        when 'invoiced' then 'The ticket has no final invoice for that'
        when 'closed' then 'The ticket has no paid invoice for that'
        else 'The ticket still has a live invoice, or is not Invoiced or Closed'
      end;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), p.email) into v_name
    from public.profiles p where p.id = auth.uid();

  perform set_config('jbk.stage_from_invoice', 'on', true);
  update public.service_jobs
     set stage = p_stage,
         invoice_id = case when p_stage = 'invoiced' then coalesce(p_invoice, invoice_id)
                           else invoice_id end,
         updated_by_name = coalesce(v_name, updated_by_name)
   where id = p_job;
  perform set_config('jbk.stage_from_invoice', '', true);
end;
$$;
revoke all on function public.set_ticket_stage_from_invoice(uuid, text, uuid) from public, anon;
grant execute on function public.set_ticket_stage_from_invoice(uuid, text, uuid) to authenticated;
