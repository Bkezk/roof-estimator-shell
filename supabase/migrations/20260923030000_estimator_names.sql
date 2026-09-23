-- The Setup step's "Estimator's Name" roster without the service-role key: display names of
-- every account with Estimate access (admins included). SECURITY DEFINER so it reads profiles
-- past RLS; only names leave (no ids / emails / roles). Any signed-in user may call it.
create or replace function public.estimator_names()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct coalesce(nullif(trim(p.full_name), ''), p.email) as name
  from public.profiles p
  where p.role = 'admin' or 'estimate' = any(p.access)
  order by 1;
$$;
revoke all on function public.estimator_names() from public;
grant execute on function public.estimator_names() to authenticated;
