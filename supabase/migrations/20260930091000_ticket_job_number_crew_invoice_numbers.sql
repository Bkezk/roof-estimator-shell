-- Owner, Sep 30: (A) a job number on the ticket, carried to its invoices as job_code; (B) the
-- ticket number is the invoice number — the ticket's first live invoice is "6012", further ones
-- "6012.2", "6012.3"; a deleted or voided invoice frees its slot for the next one (the slot
-- logic is src/lib/invoice-numbering.ts); (C) a named crew on the ticket with a bill rate each,
-- defaulting to the technician's profile rate, then the rate table; (D) the technician confirms
-- who is on the job (crew_confirmed_at). Existing invoices keep their integer numbers
-- (display_number stays NULL); existing tickets without crew rows bill as before. Idempotent.

-- (A) Job number, shown and edited next to PO #.
alter table public.service_jobs add column if not exists job_number text;

-- (D) When the technician answered "Who is on this job with you?".
alter table public.service_jobs add column if not exists crew_confirmed_at timestamptz;

-- (B) The invoice number as shown. New invoices leave the legacy integer empty.
alter table public.invoices add column if not exists display_number text;
alter table public.invoices alter column number drop not null;
-- A ticket may now carry more than one live invoice.
drop index if exists public.invoices_live_job_idx;
create index if not exists invoices_job_idx on public.invoices (service_job_id);
-- Unique among live invoices: a voided invoice keeps its number on record and frees the slot.
-- The server retries once on a conflict (two invoices made for one ticket at the same moment).
create unique index if not exists invoices_display_number_live_idx
  on public.invoices (display_number)
  where display_number is not null and status <> 'void';

-- (C) The admin's default bill rate per technician ($/hour of labor).
alter table public.profiles add column if not exists default_bill_rate numeric(10,2);
alter table public.profiles drop constraint if exists profiles_default_bill_rate_check;
alter table public.profiles add constraint profiles_default_bill_rate_check
  check (default_bill_rate is null or default_bill_rate >= 0);

-- (C) The crew: sort 0 is the lead and mirrors service_jobs.technician_id; bill_rate NULL means
-- the default (profile rate, else the rate table: tech for the lead, helper for the others).
create table if not exists public.service_job_techs (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid references public.service_jobs(id) on delete cascade,
  technician_id uuid references public.profiles(id) on delete cascade,
  sort integer not null default 0,
  bill_rate numeric(10,2) check (bill_rate is null or bill_rate >= 0),
  created_at timestamptz default now(),
  unique (service_job_id, technician_id)
);
create index if not exists service_job_techs_job_idx on public.service_job_techs (service_job_id, sort);
alter table public.service_job_techs enable row level security;
-- The same policies as service_time_entries (20260927130000_service_field.sql).
drop policy if exists service_job_techs_read on public.service_job_techs;
create policy service_job_techs_read on public.service_job_techs for select to authenticated
  using (public.has_access('service') or public.has_access('customers'));
drop policy if exists service_job_techs_write on public.service_job_techs;
create policy service_job_techs_write on public.service_job_techs for all to authenticated
  using (public.has_access('service')) with check (public.has_access('service'));

-- The technicians' default bill rates for the office (invoice lines, the ticket's $ boxes).
-- SECURITY DEFINER because profiles RLS hides other users' rows; technicians get nothing
-- (they never see money).
create or replace function public.technician_bill_rates()
returns table (id uuid, default_bill_rate numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.default_bill_rate
    from public.profiles p
   where (public.has_access('service') or public.has_access('customers'))
     and (not public.is_technician() or public.is_admin() or public.is_manager())
     and p.default_bill_rate is not null;
$$;
revoke all on function public.technician_bill_rates() from public;
grant execute on function public.technician_bill_rates() to authenticated;

-- A deleted user leaves every crew (the FK above may pre-date this rule on an existing table).
alter table public.service_job_techs drop constraint if exists service_job_techs_technician_id_fkey;
alter table public.service_job_techs add constraint service_job_techs_technician_id_fkey
  foreign key (technician_id) references public.profiles(id) on delete cascade;

-- (D) The other technicians named on a ticket can read it (their phone shows it); only the lead
-- works it (the field functions check the lead). SECURITY DEFINER so the policy below does not
-- recurse through service_job_techs' own RLS.
create or replace function public.is_on_crew(job uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.service_job_techs t
     where t.service_job_id = job and t.technician_id = auth.uid()
  );
$$;
revoke all on function public.is_on_crew(uuid) from public;
grant execute on function public.is_on_crew(uuid) to authenticated;

-- The read policy as 20260930093000_manager_role.sql left it, plus the crew clause.
drop policy if exists service_jobs_read on public.service_jobs;
create policy service_jobs_read on public.service_jobs for select to authenticated
  using (
    public.has_access('customers')
    or (public.has_access('service')
        and (not public.is_technician() or public.is_admin() or public.is_manager()
             or technician_id = auth.uid() or public.is_on_crew(id)))
  );
