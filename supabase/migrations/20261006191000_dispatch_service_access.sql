-- The dispatch picker lists only technicians who can see tickets (owner, Oct 6). Proven live:
-- technician_options() listed every profile with the Technician tick, but reading a ticket needs
-- Service access (service_jobs_read: has_access('service')), so John — Technician, access
-- Estimate + Inventory — was assigned 2 tickets and saw 0 of them.
--
-- technician_options() (last 20261002090000_service_role_helpers.sql) keeps its caller rule (the
-- system, or a signed-in user with Service access) and its order (technicians first, then by
-- name); the rows change: a person is listed only when they can read tickets — an admin, a
-- manager, or a user with Service access. The old row filter (ticked Technician, or admin /
-- manager, or Service access) is inside the new one, since a technician without Service is
-- exactly who is left out. Admin › Users shows the amber warning "Technician without Service
-- access — cannot see tickets" on each such person, with "Give Service access" (the app's
-- technicianNeedsService, src/lib/dispatch-access.ts). Idempotent.
create or replace function public.technician_options()
returns table (id uuid, full_name text, email text, technician boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.technician
    from public.profiles p
   where (coalesce(auth.role(), '') = 'service_role'
          or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))
          or public.has_access('service'))
     -- Only people who can read tickets (the twin of service_jobs_read's has_access('service')).
     and (p.role in ('admin','manager') or 'service' = any(p.access))
   order by p.technician desc, coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.technician_options() from public;
revoke all on function public.technician_options() from anon;
grant execute on function public.technician_options() to authenticated, service_role;
