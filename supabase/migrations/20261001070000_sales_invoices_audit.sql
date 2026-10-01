-- Sales / project managers see and edit invoices, and every change is logged (owner, Oct 1):
-- "Sales and PMs should be able to see customers and invoices. However whatever is changed
-- needs to be logged somewhere showing what they did, when, and who."
--
-- A sales / project manager is a plain user (role 'user'), not ticked Technician, with Estimate
-- access. The app twins are `isSalesPm` / `seesInvoices` (src/lib/access.ts). Customers they
-- already see with the Customers tick (unchanged here). Ticket creation, dispatch, crew rates,
-- repair prices and the Service Rates page stay admin / manager (20261001050000). Idempotent.

-- 1. Who is a sales / project manager.
create or replace function public.is_sales_pm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'user'
      and not coalesce(p.technician, false)
      and 'estimate' = any(p.access)
  );
$$;
revoke all on function public.is_sales_pm() from public;
grant execute on function public.is_sales_pm() to authenticated;

-- 2. Invoices and their lines: admins, managers and sales / project managers.
drop policy if exists invoices_office on public.invoices;
create policy invoices_office on public.invoices for all to authenticated
  using (public.is_admin() or public.is_manager() or public.is_sales_pm())
  with check (public.is_admin() or public.is_manager() or public.is_sales_pm());
drop policy if exists invoice_lines_office on public.invoice_lines;
create policy invoice_lines_office on public.invoice_lines for all to authenticated
  using (public.is_admin() or public.is_manager() or public.is_sales_pm())
  with check (public.is_admin() or public.is_manager() or public.is_sales_pm());

-- Invoice PDFs (service bucket, invoices/): the same three; the rest of the bucket unchanged.
drop policy if exists service_objects_read on storage.objects;
create policy service_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'service'
    and (public.has_access('service') or public.has_access('customers'))
    and (name not like 'invoices/%' or public.is_admin() or public.is_manager()
         or public.is_sales_pm())
  );

-- Building an invoice's lines (invoices.server.ts buildLinesFromJob) reads the service rates and
-- the technicians' default bill rates as the signed-in user. A sales / project manager who makes
-- or rebuilds an invoice needs to READ them; writing them (the Service Rates page, the crew
-- $/hour, Admin › Users) stays admin / manager.
drop policy if exists service_rates_read on public.service_rates;
create policy service_rates_read on public.service_rates for select to authenticated
  using (public.is_admin() or public.is_manager() or public.is_sales_pm()
         or auth.role() = 'service_role');
create or replace function public.technician_bill_rates()
returns table (id uuid, default_bill_rate numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.default_bill_rate
    from public.profiles p
   where (public.is_admin() or public.is_manager() or public.is_sales_pm())
     and p.default_bill_rate is not null;
$$;
revoke all on function public.technician_bill_rates() from public;
grant execute on function public.technician_bill_rates() to authenticated;

-- 3. The audit log: every write to invoices, invoice lines, customers, sites and contacts, by
-- everyone, written by the server functions (src/lib/audit.server.ts logAudit). Append-only:
-- no update or delete policy. Read by admins and managers only (the History folds, the Owner
-- view). An invoice line's entity_id is its invoice's id (invoice_lines.id is an integer).
-- changes: {"<field>": {"from": <old>, "to": <new>}, ...}.
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  by_name text,
  by_role text,
  entity text not null,
  entity_id uuid,
  action text not null,
  summary text,
  changes jsonb
);
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log add constraint audit_log_entity_check
  check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact'));
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('create', 'update', 'delete', 'finalize', 'send', 'paid', 'void'));
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index if not exists audit_log_by_user_idx on public.audit_log (by_user, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (by_user = auth.uid());
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (public.is_admin() or public.is_manager());
