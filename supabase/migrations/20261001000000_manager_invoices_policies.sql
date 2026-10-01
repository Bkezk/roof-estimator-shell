-- Manager role, part two (owner, Sep 30): a manager who is also ticked Technician is office
-- staff for invoices too (20260930093000_manager_role.sql did the service_jobs policies).
drop policy if exists invoices_office on public.invoices;
create policy invoices_office on public.invoices for all to authenticated
  using ((public.has_access('service') or public.has_access('customers'))
         and (not public.is_technician() or public.is_admin() or public.is_manager()))
  with check (public.has_access('service')
              and (not public.is_technician() or public.is_admin() or public.is_manager()));
drop policy if exists invoice_lines_office on public.invoice_lines;
create policy invoice_lines_office on public.invoice_lines for all to authenticated
  using ((public.has_access('service') or public.has_access('customers'))
         and (not public.is_technician() or public.is_admin() or public.is_manager()))
  with check (public.has_access('service')
              and (not public.is_technician() or public.is_admin() or public.is_manager()));
