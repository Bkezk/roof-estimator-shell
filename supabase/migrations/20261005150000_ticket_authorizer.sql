-- Who authorizes Done tickets (service study M9, owner Oct 5: "Brandon is the owner so he will
-- be the go to person to authorize"). Idempotent.
--
-- 1. service_settings.authorizer_id: the person set on Setup › Service rates. Null = every admin.
-- 2. ticket_authorizers(): who that is right now — the set person while they are an admin or a
--    manager (only they may set Authorized: 20261005140000_authorized_stage.sql), else every
--    admin. SECURITY DEFINER: a ticket reaches Done under a technician's session, which may not
--    read service_settings or other people's profiles; it returns ids only.
-- 3. manager_options(): admins and managers (id, name), for that picker.

alter table public.service_settings
  add column if not exists authorizer_id uuid references public.profiles(id) on delete set null;
comment on column public.service_settings.authorizer_id is
  'Who reviews Done tickets and marks them Authorized (gets the notice and the Needs authorization tab); null = every admin.';

create or replace function public.ticket_authorizers()
returns setof uuid language sql stable security definer set search_path = public as $$
  with chosen as (
    select p.id
      from public.service_settings s
      join public.profiles p on p.id = s.authorizer_id
     where s.id = 1 and p.role in ('admin', 'manager')
  )
  select id from chosen
  union all
  select p.id from public.profiles p
   where p.role = 'admin' and not exists (select 1 from chosen);
$$;
revoke all on function public.ticket_authorizers() from public, anon;
grant execute on function public.ticket_authorizers() to authenticated, service_role;

create or replace function public.manager_options()
returns table (id uuid, full_name text, email text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role
    from public.profiles p
   where p.role in ('admin', 'manager')
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.manager_options() from public, anon;
grant execute on function public.manager_options() to authenticated;
