-- Who authorizes Done tickets when Setup › Service rates names nobody (QA audit bug 6; owner,
-- Oct 6: "the authorizer defaults to Brandon, Brandon@flatroofonline.com — he is not added as a
-- user yet"). 20261005150000_ticket_authorizer.sql fell back to every admin in no order, and
-- afterTicketStage (ticket-events.server.ts) hands the "Authorize ticket #…" follow-up to the
-- first id it gets, so with two admins the item flipped between them on any save (the follow-up
-- sync closes it "reassigned" and opens it again). Idempotent.
--
-- 1. ticket_authorizers(): each step only when the one before names nobody —
--    (a) service_settings.authorizer_id while that person is an admin or a manager (as before);
--    (b) the profile whose lower(email) is Brandon's while they are an admin or a manager;
--    (c) every admin, ordered by created_at, id, so the first is always the same person.
--    Still SECURITY DEFINER (a technician's session reaches Done and may not read
--    service_settings or other profiles); ids only; same grants as before.
-- 2. default_authorizer_on_profile(): when Brandon's profile appears (createUser inserts the row,
--    auth.functions.ts) or is made admin / manager (updateUserAccess) and nothing is set, set him
--    as the authorizer so the picker shows him and (a) applies. The email is compared lower-cased.
-- 3. One backfill in case he is already there.

create or replace function public.ticket_authorizers()
returns setof uuid language sql stable security definer set search_path = public as $$
  with chosen as (
    select p.id, p.created_at
      from public.service_settings s
      join public.profiles p on p.id = s.authorizer_id
     where s.id = 1 and p.role in ('admin', 'manager')
  ),
  fallback as (
    select p.id, p.created_at
      from public.profiles p
     where lower(p.email) = 'brandon@flatroofonline.com'
       and p.role in ('admin', 'manager')
       and not exists (select 1 from chosen)
  ),
  admins as (
    select p.id, p.created_at
      from public.profiles p
     where p.role = 'admin'
       and not exists (select 1 from chosen)
       and not exists (select 1 from fallback)
  )
  select id
    from (
      select id, created_at from chosen
      union all
      select id, created_at from fallback
      union all
      select id, created_at from admins
    ) a
   order by created_at, id;
$$;
revoke all on function public.ticket_authorizers() from public, anon;
grant execute on function public.ticket_authorizers() to authenticated, service_role;

create or replace function public.default_authorizer_on_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'brandon@flatroofonline.com' and new.role in ('admin', 'manager') then
    update public.service_settings set authorizer_id = new.id where id = 1 and authorizer_id is null;
  end if;
  return new;
end;
$$;
revoke all on function public.default_authorizer_on_profile() from public, anon;

drop trigger if exists profiles_default_authorizer on public.profiles;
create trigger profiles_default_authorizer
  after insert or update of role, email on public.profiles
  for each row execute function public.default_authorizer_on_profile();

update public.service_settings s
   set authorizer_id = p.id
  from public.profiles p
 where s.id = 1 and s.authorizer_id is null
   and lower(p.email) = 'brandon@flatroofonline.com'
   and p.role in ('admin', 'manager');
