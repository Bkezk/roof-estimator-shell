-- Ticket money and control are a manager's (owner, Oct 1): "Estimate pricing can be seen by
-- anyone who has the check and it lives separately from any other pricing. The invoice /
-- repairs / bids etc all pull from estimate pricing but invoices, repairs etc can be edited as
-- they are made if needed. However only the managers / admins can see and edit the prices on
-- invoices / repairs / inspections etc. ... The manager creates the tickets; reps do not create
-- tickets, the reps are just responding to what is assigned to them. Also the per-technician
-- charge is separate from estimate pricing and can be edited per job."
--
-- The app twin is `managesTickets` (src/lib/access.ts) = admin or manager. Estimate Pricing
-- (has_access('pricing')) is untouched here. Visibility is untouched: service_jobs read / update
-- stay as 20260930091000 / 20260930093000 left them (a technician still reads and updates the
-- tickets assigned to them; the field flow needs it). Idempotent.

-- 1. Creating a ticket: a manager's or an admin's.
drop policy if exists service_jobs_insert on public.service_jobs;
create policy service_jobs_insert on public.service_jobs for insert to authenticated
  with check (public.has_access('service') and (public.is_admin() or public.is_manager()));

-- 2. Invoices and their lines: admins and managers only (the "Service or Customers access and
-- not a technician" branch is gone). Invoice lines copy their prices (rate, cost_rate); editing
-- them never writes back to the rate or pricing tables.
drop policy if exists invoices_office on public.invoices;
create policy invoices_office on public.invoices for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());
drop policy if exists invoice_lines_office on public.invoice_lines;
create policy invoice_lines_office on public.invoice_lines for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());

-- Invoice PDFs live in the "service" bucket under invoices/; the rest of the bucket (ticket
-- photos, signatures, aerial markups) keeps its Service / Customers read.
drop policy if exists service_objects_read on storage.objects;
create policy service_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'service'
    and (public.has_access('service') or public.has_access('customers'))
    and (name not like 'invoices/%' or public.is_admin() or public.is_manager())
  );

-- 3. Service Rates (Admin › Service Rates): admins and managers. The invoice builder
-- (invoices.server.ts loadRates, getCrewRateDefaults) runs as the signed-in manager; no cron
-- route reads service_rates, and the service role bypasses RLS anyway (named here for clarity).
drop policy if exists service_rates_read on public.service_rates;
create policy service_rates_read on public.service_rates for select to authenticated
  using (public.is_admin() or public.is_manager() or auth.role() = 'service_role');
drop policy if exists service_rates_write on public.service_rates;
create policy service_rates_write on public.service_rates for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());
-- The material markup and tax rate are edited on the same page (setServiceRates).
drop policy if exists service_settings_write on public.service_settings;
create policy service_settings_write on public.service_settings for update to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());

-- 4. Repair templates carry a price (unit_price): written by admins and managers. Read is
-- unchanged (reps pick templates on the close-out): RLS cannot hide one column, so the server
-- functions that list templates for a ticket blank unit_price for anyone but a manager
-- (src/lib/ticket-money.ts templatesForViewer).
drop policy if exists repair_templates_write on public.repair_templates;
create policy repair_templates_write on public.repair_templates for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());
-- A rep adding a repair still bumps the template's usage count (the favourites chips): the
-- trigger now runs as its owner instead of under the rep's (now read-only) template access.
create or replace function public.bump_repair_template_usage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.repair_template_id is not null then
    update public.repair_templates set usage_count = usage_count + 1 where id = new.repair_template_id;
  end if;
  return new;
end; $$;

-- 5. The technicians' default bill rates (Admin › Users): admins and managers only.
create or replace function public.technician_bill_rates()
returns table (id uuid, default_bill_rate numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.default_bill_rate
    from public.profiles p
   where (public.is_admin() or public.is_manager())
     and p.default_bill_rate is not null;
$$;
revoke all on function public.technician_bill_rates() from public;
grant execute on function public.technician_bill_rates() to authenticated;

-- 6. The crew (service_job_techs) and its per-job rate (bill_rate). A manager writes anything.
-- The lead technician of a ticket answers "who is on this job" (setJobCrew): they may add and
-- remove crew rows of their own ticket, but never set or change a rate — a new member comes in
-- with bill_rate NULL (the default), a kept member keeps the rate the manager set. Policies are
-- split by who; the rate rule needs the old row, so it is a trigger
-- (service_job_techs_rate_guard; pure twin: src/lib/ticket-money.ts crewRowWriteAllowed).
-- RLS cannot hide the bill_rate column from a reader; listJobCrew blanks it for non-managers.
create or replace function public.leads_job(job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.service_jobs j
     where j.id = job and j.technician_id = auth.uid() and j.deleted_at is null
  );
$$;
revoke all on function public.leads_job(uuid) from public;
grant execute on function public.leads_job(uuid) to authenticated;

drop policy if exists service_job_techs_write on public.service_job_techs;
create policy service_job_techs_write on public.service_job_techs for all to authenticated
  using (public.has_access('service') and (public.is_admin() or public.is_manager()))
  with check (public.has_access('service') and (public.is_admin() or public.is_manager()));
drop policy if exists service_job_techs_lead on public.service_job_techs;
create policy service_job_techs_lead on public.service_job_techs for all to authenticated
  using (public.has_access('service') and public.leads_job(service_job_id))
  with check (public.has_access('service') and public.leads_job(service_job_id));

-- An upsert's insert attempt reaches BEFORE INSERT before the conflict turns it into an update,
-- so an insert carrying the rate the row already has is let through (it becomes a no-op update).
create or replace function public.service_job_techs_rate_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.bill_rate is null or exists (
      select 1 from public.service_job_techs t
       where t.service_job_id = new.service_job_id
         and t.technician_id = new.technician_id
         and t.bill_rate = new.bill_rate
    ) then
      return new;
    end if;
  elsif new.service_job_id is not distinct from old.service_job_id
    and new.technician_id is not distinct from old.technician_id
    and new.bill_rate is not distinct from old.bill_rate then
    return new;
  end if;
  raise exception 'Only a manager sets a technician''s rate on a ticket' using errcode = '42501';
end; $$;
drop trigger if exists service_job_techs_rate_guard on public.service_job_techs;
create trigger service_job_techs_rate_guard before insert or update on public.service_job_techs
  for each row execute function public.service_job_techs_rate_guard();
