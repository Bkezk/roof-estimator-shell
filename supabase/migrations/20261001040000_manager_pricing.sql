-- Managers reach Estimate Pricing too (owner, Oct 1: "managers and admins can edit pricing").
-- Estimate Pricing stays a grantable page for plain users ("can be seen by anyone who has the
-- check"). Idempotent.
create or replace function public.has_access(page text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role in ('admin', 'manager') or page = any(p.access))
  );
$$;
