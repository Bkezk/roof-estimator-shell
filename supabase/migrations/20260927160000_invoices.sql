-- Service phase C (docs/service-module-design.md §4, §5.4, §5.5): invoices generated from a
-- ticket's time entries and materials, the rate table and settings behind them, payments, and
-- the Sage export stamp. Idempotent.

-- Rates per labor rate kind (the ticket's Emergency / Urgent / Standard), role and time kind,
-- with the cost side for margin. Defaults are what the CenterPoint invoices showed (report
-- §5); the office confirms them on Admin › Settings › Service rates.
create table if not exists public.service_rates (
  id serial primary key,
  rate_kind text not null check (rate_kind in ('standard','urgent','emergency')),
  role text not null check (role in ('tech','helper')),
  time_kind text not null check (time_kind in ('travel','labor')),
  bill_rate numeric not null default 0,
  cost_rate numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (rate_kind, role, time_kind)
);
insert into public.service_rates (rate_kind, role, time_kind, bill_rate, cost_rate) values
  ('standard','tech','labor',85,85), ('standard','tech','travel',55,85),
  ('standard','helper','labor',55,55), ('standard','helper','travel',45,55),
  ('urgent','tech','labor',95,85), ('urgent','tech','travel',55,85),
  ('urgent','helper','labor',55,55), ('urgent','helper','travel',40,55),
  ('emergency','tech','labor',135,85), ('emergency','tech','travel',55,85),
  ('emergency','helper','labor',55,55), ('emergency','helper','travel',45,55)
on conflict (rate_kind, role, time_kind) do nothing;
alter table public.service_rates enable row level security;
drop policy if exists service_rates_read on public.service_rates;
create policy service_rates_read on public.service_rates for select to authenticated using (true);
drop policy if exists service_rates_write on public.service_rates;
create policy service_rates_write on public.service_rates for all to authenticated
  using (public.is_admin() or public.has_access('pricing'))
  with check (public.is_admin() or public.has_access('pricing'));

-- One-row invoice settings.
create table if not exists public.service_settings (
  id integer primary key default 1 check (id = 1),
  material_markup numeric not null default 0.75 check (material_markup >= 0),
  tax_rate numeric not null default 0 check (tax_rate >= 0 and tax_rate <= 1),
  payment_terms text not null default 'Payment is due upon receipt of invoice.',
  invoice_contact text,
  email_subject text not null default 'Invoice #{number}',
  email_message text not null default 'Your invoice is ready. Thank you for your business.',
  updated_at timestamptz not null default now()
);
insert into public.service_settings (id) values (1) on conflict (id) do nothing;
alter table public.service_settings enable row level security;
drop policy if exists service_settings_read on public.service_settings;
create policy service_settings_read on public.service_settings for select to authenticated using (true);
drop policy if exists service_settings_write on public.service_settings;
create policy service_settings_write on public.service_settings for update to authenticated
  using (public.is_admin() or public.has_access('pricing'))
  with check (public.is_admin() or public.has_access('pricing'));

-- The ticket's labor rate kind and its invoice; a customer's tax status.
alter table public.service_jobs
  add column if not exists labor_rate_kind text not null default 'standard'
    check (labor_rate_kind in ('standard','urgent','emergency')),
  add column if not exists invoice_id uuid;
alter table public.crm_accounts add column if not exists tax_exempt boolean not null default false;

-- Invoices: one per ticket, numbered like the ticket. Lines are rebuilt from the ticket until
-- the invoice is final; after that they are the record.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null unique references public.service_jobs(id) on delete cascade,
  number integer not null unique,
  invoice_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check (status in ('draft','final','sent','paid','void')),
  bill_to jsonb not null default '{}'::jsonb,
  property jsonb not null default '{}'::jsonb,
  po_number text,
  job_code text,
  description text,
  payment_terms text,
  subtotal numeric not null default 0,
  tax_rate numeric not null default 0,
  tax_amount numeric not null default 0,
  total numeric not null default 0,
  cost_total numeric not null default 0,
  finalized_at timestamptz,
  sent_at timestamptz,
  sent_to jsonb,
  paid_amount numeric not null default 0,
  paid_on date,
  paid_method text,
  paid_ref text,
  sage_exported_at timestamptz,
  pdf_path text,
  created_by uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_status_idx on public.invoices (status, invoice_date desc);
drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.update_updated_at_column();
alter table public.invoices enable row level security;
-- Office users (Service without the technician tick) and admins; technicians never see money.
drop policy if exists invoices_office on public.invoices;
create policy invoices_office on public.invoices for all to authenticated
  using ((public.has_access('service') or public.has_access('customers')) and (not public.is_technician() or public.is_admin()))
  with check (public.has_access('service') and (not public.is_technician() or public.is_admin()));

create table if not exists public.invoice_lines (
  id bigserial primary key,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sort integer not null default 0,
  kind text not null check (kind in ('travel','labor','material','other')),
  description text not null,
  qty numeric not null default 1,
  unit text not null default 'ea',
  rate numeric not null default 0,
  total numeric not null default 0,
  cost_rate numeric not null default 0,
  cost_total numeric not null default 0,
  on_date date,
  source text,
  taxable boolean not null default true
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort);
alter table public.invoice_lines enable row level security;
drop policy if exists invoice_lines_office on public.invoice_lines;
create policy invoice_lines_office on public.invoice_lines for all to authenticated
  using ((public.has_access('service') or public.has_access('customers')) and (not public.is_technician() or public.is_admin()))
  with check (public.has_access('service') and (not public.is_technician() or public.is_admin()));

-- Storage: the invoice PDFs live in the "service" bucket under invoices/<number>.pdf (the
-- bucket's policies already follow the Service page).
