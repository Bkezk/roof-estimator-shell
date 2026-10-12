-- Managers authorize Done tickets too (owner, Oct 12: "make managers able to authorize,
-- apparently they do that sometimes"). A manager could already press "Mark authorized" (the
-- Invoice block gates on admins and managers; stageProblem lets a manager set any stage), but
-- ticket_authorizers() named only the chosen person, else Brandon, else every admin — so a
-- manager who was not the named authorizer was never told a ticket was Done (ticket_done goes to
-- the ids this function returns; ticket-events.server.ts) and never saw the "Needs authorization"
-- queue on Work Overview. Idempotent.
--
-- ticket_authorizers(), in order:
--   1. the named authorizer — service_settings.authorizer_id while an admin or a manager, else
--      Brandon (brandon@flatroofonline.com) while an admin or a manager — one row at most, first:
--      the first row owns the "Authorize ticket #…" follow-up and its reminders (afterTicketStage
--      takes authorizers[0]), so who holds the timer is unchanged;
--   2. then every other admin and manager (role in ('admin', 'manager')), ordered by created_at,
--      id, without repeating the first row.
-- Same signature, SECURITY DEFINER (a technician's session reaches Done and may not read
-- service_settings or other profiles), ids only, same grants as 20261006210000_default_authorizer.
-- default_authorizer_on_profile() and its trigger are untouched.

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
  named as (
    select id, created_at from chosen
    union all
    select id, created_at from fallback
  ),
  others as (
    select p.id, p.created_at
      from public.profiles p
     where p.role in ('admin', 'manager')
       and not exists (select 1 from named n where n.id = p.id)
  )
  select id
    from (
      select id, created_at, 0 as rank from named
      union all
      select id, created_at, 1 as rank from others
    ) a
   order by rank, created_at, id;
$$;
revoke all on function public.ticket_authorizers() from public, anon;
grant execute on function public.ticket_authorizers() to authenticated, service_role;

comment on column public.service_settings.authorizer_id is
  'Who owns the "Authorize ticket" reminder when a ticket is Done (first in ticket_authorizers()); null = Brandon, else the admins and managers in order. Every admin and manager is told, sees the Needs authorization queue and may mark it Authorized.';
