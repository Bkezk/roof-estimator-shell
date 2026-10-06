-- @mentions in a ticket note reach anyone with Service or Customers access (owner, Oct 6). The
-- note box's people list and the server's name resolver (addJobNote) read technician_options(),
-- the dispatch roster — who can be assigned a ticket — so an office or customers person without
-- the technician tick could not be reached, and since 20261006191000 that roster is narrower
-- still. crm_user_options() lists every profile (account managers), which is too wide: an
-- estimator or an inventory-only login has no ticket to be told about.
--
-- mention_options(): id, name and email of every admin and manager and every user with Service
-- or Customers access, for a caller who has Service or Customers access themselves (the people
-- who read a ticket's timeline). SECURITY DEFINER because the profiles policy hides other users'
-- rows from non-admins (as technician_options / crm_user_options). Never anon: Supabase grants
-- EXECUTE on every new public function to anon by default and "revoke ... from public" does not
-- take it back. Idempotent.
create or replace function public.mention_options()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where (public.has_access('service') or public.has_access('customers'))
     and (p.role in ('admin', 'manager') or 'service' = any(p.access) or 'customers' = any(p.access))
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.mention_options() from public;
revoke all on function public.mention_options() from anon;
grant execute on function public.mention_options() to authenticated;
