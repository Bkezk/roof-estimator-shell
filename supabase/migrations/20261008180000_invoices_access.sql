-- Owner, Oct 8 ("is this the most efficient role setup? we dont really have PM or sales roles"):
-- the "sales / PM" of Oct 1 (20261001070000_sales_invoices_audit.sql) was a hidden rule — a plain
-- user, not ticked Technician, with Estimate access got invoices without anyone ticking anything.
-- It becomes a page tick, "Invoices", on Admin › Users:
--   * profiles.access may hold 'invoices';
--   * everyone the hidden rule covered today gets the tick, so nothing they have changes (Brian);
--   * is_sales_pm() — kept under its name for the policies that call it (invoices, invoice_lines,
--     storage 'invoices/%', repair_templates_read, service_job_techs_read, audit_log who, the
--     ticket stage rule) — now means "a plain user with the Invoices tick"; a technician with the
--     tick counts, since the tick is explicit.
-- Applied live the same day through the Lovable database tool.
alter table public.profiles drop constraint if exists profiles_access_check;
alter table public.profiles add constraint profiles_access_check check (
  access <@ array['estimate', 'pricing', 'inventory', 'prospect', 'takeoff', 'service', 'customers', 'invoices']::text[]
);

update public.profiles
   set access = array_append(access, 'invoices')
 where role = 'user'
   and not coalesce(technician, false)
   and 'estimate' = any(access)
   and not ('invoices' = any(access));

create or replace function public.is_sales_pm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'user'
      and 'invoices' = any(p.access)
  );
$$;
grant execute on function public.is_sales_pm() to authenticated;
comment on function public.is_sales_pm() is
  'A plain user with the Invoices tick (profiles.access ''invoices''); admins and managers see invoices by role. Named for the Oct 1 rule it replaced.';
