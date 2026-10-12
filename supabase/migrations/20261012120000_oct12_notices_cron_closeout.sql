-- Owner batch, Oct 12 — the database side of items 6, 8 and 10. Idempotent.
--
-- 1. Item 8 (Admin › Reminders, Delivery health): two stamps on crm_settings —
--    last_cron_at, written by the scheduled job alone (/api/cron/reminders, stamp_cron), so the
--    page can tell a dead cron from the app's own load-time pass (both stamp last_dispatch_at);
--    last_dispatch_failed, how many sends failed on the last pass (stamp_dispatch_result, which
--    stamps last_dispatch_at with it), for "N reminders failed to send on the last pass — they
--    retry on the next pass".
-- 2. Item 10a: followup_unclaim_reminder — the reminder pass's undo of its claim when the send
--    failed (src/lib/notify.server.ts unclaimReminder), so the next pass retries instead of
--    waiting every_days. Mirrors followup_claim_reminder: only where the row still holds what the
--    claim wrote (the same optimistic lock, the other way round), only when open, under the
--    jbk.followup_sync flag the guard trigger accepts. Who may: the system, or a Customers /
--    Service / Estimate user, as the claim.
-- 3. Item 6: set_ticket_stage_from_invoice keeps a Closed ticket Closed when a second invoice on
--    it is finalised ('invoiced' on a Closed ticket is a no-op, not a reopen). The rest of the
--    function is 20261005140000_authorized_stage.sql's.
-- 4. Item 10b: a user with push on and no device is not a failed delivery. notify() no longer
--    writes "no device has push turned on" to push_error; the rows that carry it are cleared so
--    the Recent failures list shows real email / push errors only.

-- 1. ------------------------------------------------------------------------------------------
alter table public.crm_settings add column if not exists last_cron_at timestamptz;
alter table public.crm_settings
  add column if not exists last_dispatch_failed integer not null default 0;
comment on column public.crm_settings.last_cron_at is
  'Owner, Oct 12: the last run of the SCHEDULED reminders job (/api/cron/reminders; stamp_cron). The app''s own pass stamps last_dispatch_at only.';
comment on column public.crm_settings.last_dispatch_failed is
  'Owner, Oct 12: how many sends failed on the last reminder pass (stamp_dispatch_result); a failed reminder is put back and retried on the next pass.';

-- The scheduled job's stamp: the system only (the route runs with the service role).
create or replace function public.stamp_cron()
returns void language sql security definer set search_path = public as $$
  update public.crm_settings set last_cron_at = now() where id = 1
    and (coalesce(auth.role(), '') = 'service_role'
         or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated')));
$$;
revoke all on function public.stamp_cron() from public;
revoke all on function public.stamp_cron() from anon;
revoke all on function public.stamp_cron() from authenticated;
grant execute on function public.stamp_cron() to service_role;

-- The pass's stamp with its failed count: the system, or a Customers / Service / Estimate user,
-- exactly as stamp_dispatch() (20261002090000_service_role_helpers.sql), which stays for an app
-- built before this migration.
create or replace function public.stamp_dispatch_result(p_failed integer)
returns void language sql security definer set search_path = public as $$
  update public.crm_settings
     set last_dispatch_at = now(),
         last_dispatch_failed = greatest(0, coalesce(p_failed, 0))
   where id = 1
     and (coalesce(auth.role(), '') = 'service_role'
          or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))
          or public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
$$;
revoke all on function public.stamp_dispatch_result(integer) from public;
revoke all on function public.stamp_dispatch_result(integer) from anon;
grant execute on function public.stamp_dispatch_result(integer) to authenticated, service_role;

-- 2. ------------------------------------------------------------------------------------------
create or replace function public.followup_unclaim_reminder(
  p_id uuid,
  p_expected timestamptz,
  p_next timestamptz,
  p_sent integer,
  p_last timestamptz
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_system boolean := public.followup_is_system();
  v_n integer;
begin
  if not (v_system or public.has_access('customers') or public.has_access('service')
          or public.has_access('estimate')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform set_config('jbk.followup_sync', 'on', true);
  update public.crm_followups
     set next_remind_at = p_next,
         reminders_sent = greatest(0, coalesce(p_sent, 0)),
         last_reminded_at = p_last
   where id = p_id
     and status = 'open'
     and next_remind_at = p_expected;
  get diagnostics v_n = row_count;
  perform set_config('jbk.followup_sync', '', true);
  return v_n = 1;
end $$;
revoke all on function public.followup_unclaim_reminder(uuid, timestamptz, timestamptz, integer, timestamptz) from public;
revoke all on function public.followup_unclaim_reminder(uuid, timestamptz, timestamptz, integer, timestamptz) from anon;
grant execute on function public.followup_unclaim_reminder(uuid, timestamptz, timestamptz, integer, timestamptz) to authenticated, service_role;

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
    -- Owner, Oct 12 (item 6): a Closed ticket stays Closed — a second invoice finalised on it
    -- never reopens it to Invoiced. Nothing to do; the invoice itself is already final.
    if exists (select 1 from public.service_jobs j where j.id = p_job and j.stage = 'closed') then
      return;
    end if;
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

-- 4. ------------------------------------------------------------------------------------------
update public.notifications set push_error = null where push_error = 'no device has push turned on';
