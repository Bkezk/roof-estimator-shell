-- @mentions for technicians too (owner, Oct 13: "tagging someone by clicking the @ symbol
-- doesn't seem to work for all users"). mention_options() (20261006193000) returned nothing to
-- a caller without Service or Customers page access — and a technician-only login (the
-- technician tick, no pages; is_technician(), 20261008190000) is exactly that, yet technicians
-- write ticket notes on the field view every day. For them the "@" list was empty. The caller
-- rule now admits technicians; who can be MENTIONED is unchanged (admins, managers, Service or
-- Customers users). Idempotent; grants as before (never anon).
create or replace function public.mention_options()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where (public.has_access('service') or public.has_access('customers') or public.is_technician())
     and (p.role in ('admin', 'manager') or 'service' = any(p.access) or 'customers' = any(p.access))
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.mention_options() from public;
revoke all on function public.mention_options() from anon;
grant execute on function public.mention_options() to authenticated;
