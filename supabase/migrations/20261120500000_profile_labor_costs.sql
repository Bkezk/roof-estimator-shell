-- What an hour of each person costs (owner, Nov 20: "go" on an hourly cost on each person; of
-- the labor cost on the Service rates page he said "it depends on the tech").
--
-- Until now the cost side of every labor and travel line on a service invoice came from the
-- Service rates page, one figure for a technician and one for a helper, whoever did the work.
--
--   1. profile_labor_costs: one row for a person whose hourly cost is typed. Pay is the admins'
--      alone: nobody else reads or writes the table, the person included (which is why it is
--      not a column of profiles, whose row its owner reads).
--   2. technician_cost_rates(): the same figures for whoever builds an invoice (an admin, a
--      manager, or a user with Invoices access), who already read the cost on every invoice
--      line. A person with none typed is not listed, and the Service rates page's cost is used.

create table if not exists public.profile_labor_costs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  hourly_cost numeric not null check (hourly_cost >= 0 and hourly_cost <= 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.profile_labor_costs is
  'What an hour of a person costs, for the cost side of service invoices. Admins only.';

alter table public.profile_labor_costs enable row level security;

drop policy if exists profile_labor_costs_admin on public.profile_labor_costs;
create policy profile_labor_costs_admin on public.profile_labor_costs
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.profile_labor_costs from anon, authenticated;
grant select, insert, update, delete on public.profile_labor_costs to authenticated;

create or replace function public.technician_cost_rates()
returns table (id uuid, hourly_cost numeric)
language sql
stable
security definer
set search_path = public
as $function$
  select c.profile_id, c.hourly_cost
    from public.profile_labor_costs c
   where (public.is_admin() or public.is_manager() or public.is_sales_pm());
$function$;

revoke all on function public.technician_cost_rates() from public, anon;
grant execute on function public.technician_cost_rates() to authenticated;

notify pgrst, 'reload schema';
