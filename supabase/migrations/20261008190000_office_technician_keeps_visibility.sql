-- Owner, Oct 8: "can office keep full visibility even when ticked technician. basically they
-- should be able to go in and claim it if need be". The Technician tick on an office person,
-- a manager or an owner puts them on the board and lets them be assigned; it no longer narrows
-- what they see or may read. "Technician" in every rule now means the technician KIND: a plain
-- user ticked Technician whose pages go no further than Service and Inventory (access.ts
-- isFieldOnly). An office person ticked Technician reads every ticket, every price and the
-- unassigned list as office, and claims unassigned work through the app (claimServiceJob /
-- claimOpportunity: the normal update under the office rules, no new grant). Every policy and
-- helper that calls is_technician() picks this up as is. Applied live the same day through the
-- Lovable database tool.
create or replace function public.is_technician()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.technician, false)
      and p.role = 'user'
      and not (p.access && array['estimate', 'pricing', 'customers', 'invoices', 'prospect', 'takeoff']::text[])
  );
$$;
comment on function public.is_technician() is
  'A technician-only user: ticked Technician, role user, no page beyond Service and Inventory. An office person, manager or owner ticked Technician is NOT this (owner, Oct 8).';
