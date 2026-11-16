-- The inspection billing rules, in the database (audit, Nov 16; owner: "go for everything").
--
-- Found: "only a manager starts an inspection's first invoice" (Nov 16) lived in the app's
-- server code alone. On the live database, in a run that was rolled back, a sales login
--   * inserted a final invoice straight onto an authorized inspection, and the ticket moved to
--     Invoiced;
--   * set a ticket's invoice pointer to a made-up id, which the app read as "already billed";
-- and a login with Customers and Invoices but no Service access deleted a draft and could not
-- clear the ticket's pointer (no row matched, no error), so the inspection stayed "billed".
-- In the app, a sales login changed an inspection's Type to Repair, made the invoice and
-- changed the Type back.
--
-- Measured before this file: 0 invoices, 0 tickets with an invoice pointer, 0 inspections past
-- Authorized, 62 follow-ups whose link is a page of this site.
--
-- What this adds (all idempotent; no data changes):
--   1. invoices_inspection_rule    the first live invoice on an inspection is a manager's.
--   2. invoices_ticket_pointer     the database keeps service_jobs.invoice_id true when an
--                                  invoice is made, voided or deleted, whoever did it.
--   3. service_jobs_invoice_pointer_rule  a person can point a ticket only at a live invoice
--                                  of that ticket.
--   4. service_jobs_type_rule      to or from Inspection is a manager's once the ticket is
--                                  Authorized or later, or has an invoice.
--   5. service_jobs_stage_rule     an inspection goes past Authorized only with a live invoice,
--                                  whoever moves it (managers were exempt from every check).
--   6. crm_followups_url_internal  a follow-up's link is a page of this site, by the rule the
--                                  notifications follow (20261114190000): a technician could
--                                  store "x" on their own ticket's reminder, and every notice
--                                  made from it was then refused, so the reminder never went out.
--
-- Who the rules do not bind, as everywhere else: no user (SQL, migrations) and the service role
-- (the app's system client, a restore).

-- 1 ── The first live invoice on an inspection ─────────────────────────────────────────────
create or replace function public.invoices_inspection_rule()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_type text;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_admin()
     or public.is_manager()
  then
    return new;
  end if;
  if new.status = 'void' then
    return new;
  end if;
  -- An edit that neither moves the invoice to another ticket nor brings a void one back.
  if tg_op = 'UPDATE'
     and new.service_job_id is not distinct from old.service_job_id
     and old.status <> 'void'
  then
    return new;
  end if;
  select j.service_type into v_type from public.service_jobs j where j.id = new.service_job_id;
  if v_type = 'inspection' and not exists (
       select 1 from public.invoices i
        where i.service_job_id = new.service_job_id
          and i.status <> 'void'
          and i.id <> new.id)
  then
    raise exception 'Only a manager can bill an inspection' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists invoices_inspection_rule on public.invoices;
create trigger invoices_inspection_rule
  before insert or update of service_job_id, status on public.invoices
  for each row execute function public.invoices_inspection_rule();

-- 2 ── The ticket's pointer follows its invoices ───────────────────────────────────────────
create or replace function public.invoices_ticket_pointer()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'void' then
      update public.service_jobs
         set invoice_id = new.id
       where id = new.service_job_id and invoice_id is null;
    end if;
    return null;
  end if;
  -- Deleted, or voided: the ticket moves to its newest other live invoice, or to none.
  if tg_op = 'DELETE' or (new.status = 'void' and old.status <> 'void') then
    update public.service_jobs j
       set invoice_id = (
             select i.id from public.invoices i
              where i.service_job_id = old.service_job_id
                and i.status <> 'void'
                and i.id <> old.id
              order by i.created_at desc
              limit 1)
     where j.id = old.service_job_id and j.invoice_id = old.id;
  end if;
  return null;
end;
$function$;

drop trigger if exists invoices_ticket_pointer on public.invoices;
create trigger invoices_ticket_pointer
  after insert or delete or update of status on public.invoices
  for each row execute function public.invoices_ticket_pointer();

-- 3 ── A person points a ticket only at a live invoice of that ticket ──────────────────────
create or replace function public.service_jobs_invoice_pointer_rule()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.invoice_id is not null
     and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id)
     and not exists (
       select 1 from public.invoices i
        where i.id = new.invoice_id
          and i.service_job_id = new.id
          and i.status <> 'void')
  then
    raise exception 'A ticket points only at a live invoice of its own' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists service_jobs_invoice_pointer_rule on public.service_jobs;
create trigger service_jobs_invoice_pointer_rule
  before insert or update of invoice_id on public.service_jobs
  for each row execute function public.service_jobs_invoice_pointer_rule();

-- 4 ── To or from Inspection ───────────────────────────────────────────────────────────────
create or replace function public.service_jobs_type_rule()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_admin()
     or public.is_manager()
  then
    return new;
  end if;
  if (old.service_type = 'inspection') is distinct from (new.service_type = 'inspection')
     and (old.stage in ('authorized', 'invoiced', 'closed')
          or old.invoice_id is not null
          or exists (
            select 1 from public.invoices i
             where i.service_job_id = old.id and i.status <> 'void'))
  then
    raise exception 'Only a manager changes a ticket to or from Inspection once it is Authorized or has an invoice'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists service_jobs_type_rule on public.service_jobs;
create trigger service_jobs_type_rule
  before update of service_type on public.service_jobs
  for each row execute function public.service_jobs_type_rule();

-- 5 ── The stage rule: an inspection past Authorized needs a live invoice ──────────────────
-- The body below is the function as it stood (20261006190000_stage_backwards_lock.sql) with one
-- check added before the exemptions.
create or replace function public.service_jobs_stage_rule()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_exempt boolean;
begin
  -- Nov 16: an inspection ends at Authorized unless it is billed. This binds every person,
  -- managers and admins too (they were exempt from everything below); the invoice path passes
  -- because it only moves a ticket that has a final invoice.
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and new.service_type = 'inspection'
     and new.stage in ('invoiced', 'closed')
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage)
     and not exists (
       select 1 from public.invoices i
        where i.service_job_id = new.id and i.status <> 'void')
  then
    raise exception 'An inspection ends at Authorized. To bill it, press Invoice this inspection on the ticket first'
      using errcode = '42501';
  end if;
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
$function$;

-- 6 ── A follow-up's link is a page of this site ───────────────────────────────────────────
alter table public.crm_followups drop constraint if exists crm_followups_url_internal;
alter table public.crm_followups
  add constraint crm_followups_url_internal
  check (url = '' or url ~ '^/([^/\\[:cntrl:]][^\\[:cntrl:]]*)?$');

comment on constraint crm_followups_url_internal on public.crm_followups is
  'A link is a page of this site (or empty): one "/" first, never "//" or "/\", no backslash or control character.';

-- The trigger functions are not for calling: nobody but the owner executes them.
revoke all on function public.invoices_inspection_rule() from public, anon, authenticated;
revoke all on function public.invoices_ticket_pointer() from public, anon, authenticated;
revoke all on function public.service_jobs_invoice_pointer_rule() from public, anon, authenticated;
revoke all on function public.service_jobs_type_rule() from public, anon, authenticated;
