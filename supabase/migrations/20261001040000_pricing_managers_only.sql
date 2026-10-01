-- Estimate Pricing is for managers and admins only (owner, Oct 1: "managers and admins can edit
-- pricing; reps cannot, nor do they need to see the pricing"). Idempotent.
--
-- has_access('pricing') is true for admins and managers and never for a plain user, whatever
-- their access list says; the stale 'pricing' grants on plain users are removed so the lists in
-- Admin › Users match. Every pricing table's RLS already goes through has_access('pricing')
-- (labor, Duro-Last, Non-DL, service_rates, county_codes, lead_sources …), so this one function
-- carries the rule.

create or replace function public.has_access(page text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role in ('admin', 'manager')
           or (page <> 'pricing' and page = any(p.access)))
  );
$$;

update public.profiles
   set access = array_remove(access, 'pricing')
 where role = 'user' and 'pricing' = any(access);
