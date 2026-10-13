-- Notice categories (owner, Oct 13): "on notifications on the account, be able to toggle if they
-- see lead notices, opportunity notices, service notices, and bid notices on their notifications
-- bell on the top right, so that people who don't deal with those things don't see them." And,
-- later the same day: "storms should also be a toggle as well and defaulted to off."
--
-- Five per-person switches on the Account page. Lead notices keep the Oct 12 opt-in column
-- (profiles.notify_leads, default false); storm alerts get their own opt-in column, off by
-- default like leads; opportunities, service and bids are new and default on, so nobody loses
-- one of those until they turn it off.
--
-- 1. profiles.notify_opportunities, notify_service, notify_bids: boolean not null default true;
--    profiles.notify_storms: boolean not null default false.
-- 2. set_my_notify_prefs(p_email, p_push, p_leads, p_opportunities, p_service, p_bids,
--    p_storms): the Account page's save, extended with the four columns (SECURITY DEFINER, the
--    caller's own row, a null keeps a column, returns the row after the write — exactly as
--    20261002180000 and 20261012160000). The three-argument form stays callable (an app still
--    running the old code during the deploy) as a thin wrapper over the new one, as the
--    two-argument one already is, so there is one body. A six-argument form (this file's first
--    cut, applied live for a few minutes before the storms ask) is dropped first, so PostgREST
--    never sees two long overloads.
-- 3. notify_recipients(ids) hands the sender the five flags next to the channels, so notify()
--    (notify.server.ts) skips a recipient whose switch for the notice's category is off: no inbox
--    row, no email, no push. Its return type grows, so it is dropped and created again with the
--    same body rule (the service role, or any signed-in user) and the same grants.
--    Lead notices stay gated at the source as well (lead_notice_user_ids, untouched here).
--
-- Idempotent: add column if not exists, create or replace / drop if exists, grants re-stated.
-- Additive to the data (four columns with defaults; no row changes).

alter table public.profiles add column if not exists notify_opportunities boolean not null default true;
alter table public.profiles add column if not exists notify_service boolean not null default true;
alter table public.profiles add column if not exists notify_bids boolean not null default true;
alter table public.profiles add column if not exists notify_storms boolean not null default false;

comment on column public.profiles.notify_opportunities is
  'Owner, Oct 13: opportunity notices (follow-ups, untouched and assignment notices linking to /opportunities); on by default';
comment on column public.profiles.notify_service is
  'Owner, Oct 13: service notices (ticket assignments, date moves, done and ready-to-invoice); on by default';
comment on column public.profiles.notify_bids is
  'Owner, Oct 13: bid notices (bid due, past due, the estimator''s own reminders, follow-ups linking to /estimate); on by default';
comment on column public.profiles.notify_storms is
  'Owner, Oct 13: storm alerts (the storm pass, kind storm) are opt-in like lead notices; off by default';

-- The six-argument form of this file's first cut: gone before the seven-argument one exists.
drop function if exists public.set_my_notify_prefs(boolean, boolean, boolean, boolean, boolean, boolean);

create or replace function public.set_my_notify_prefs(
  p_email boolean, p_push boolean, p_leads boolean,
  p_opportunities boolean, p_service boolean, p_bids boolean, p_storms boolean)
returns table (
  notify_email boolean, notify_push boolean, notify_leads boolean,
  notify_opportunities boolean, notify_service boolean, notify_bids boolean, notify_storms boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_email boolean;
  v_push boolean;
  v_leads boolean;
  v_opportunities boolean;
  v_service boolean;
  v_bids boolean;
  v_storms boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles as p
     set notify_email = coalesce(p_email, p.notify_email),
         notify_push = coalesce(p_push, p.notify_push),
         notify_leads = coalesce(p_leads, p.notify_leads),
         notify_opportunities = coalesce(p_opportunities, p.notify_opportunities),
         notify_service = coalesce(p_service, p.notify_service),
         notify_bids = coalesce(p_bids, p.notify_bids),
         notify_storms = coalesce(p_storms, p.notify_storms)
   where p.id = auth.uid()
  returning p.notify_email, p.notify_push, p.notify_leads,
            p.notify_opportunities, p.notify_service, p.notify_bids, p.notify_storms
       into v_email, v_push, v_leads, v_opportunities, v_service, v_bids, v_storms;
  if not found then
    raise exception 'Your profile was not found' using errcode = 'P0002';
  end if;
  notify_email := v_email;
  notify_push := v_push;
  notify_leads := v_leads;
  notify_opportunities := v_opportunities;
  notify_service := v_service;
  notify_bids := v_bids;
  notify_storms := v_storms;
  return next;
end;
$$;

revoke all on function public.set_my_notify_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public;
revoke all on function public.set_my_notify_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from anon;
grant execute on function public.set_my_notify_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

-- The three-argument form (20261012160000_notify_leads.sql) keeps working: same return type,
-- the four new switches untouched (null keeps the column). The two-argument form of
-- 20261002180000_notify_prefs.sql already wraps this one, so it keeps working too.
create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean, p_leads boolean)
returns table (notify_email boolean, notify_push boolean, notify_leads boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select r.notify_email, r.notify_push, r.notify_leads
      from public.set_my_notify_prefs(p_email, p_push, p_leads, null::boolean, null::boolean, null::boolean, null::boolean) as r;
end;
$$;

revoke all on function public.set_my_notify_prefs(boolean, boolean, boolean) from public;
revoke all on function public.set_my_notify_prefs(boolean, boolean, boolean) from anon;
grant execute on function public.set_my_notify_prefs(boolean, boolean, boolean) to authenticated;

-- The recipients read for notify(): the channels and now the five category switches. The body
-- rule is 20260930094000_tasks_calendar.sql's (the service role, or any signed-in user; profiles
-- RLS would otherwise hide other users' rows from the sender). A changed return type cannot be
-- replaced in place, hence the drop; the grants are the same as before, with anon's default
-- EXECUTE (Supabase grants it on every new function) revoked as 20261002090000 does.
drop function if exists public.notify_recipients(uuid[]);
create function public.notify_recipients(ids uuid[])
returns table (
  id uuid, email text, full_name text, notify_email boolean, notify_push boolean,
  notify_leads boolean, notify_opportunities boolean, notify_service boolean, notify_bids boolean,
  notify_storms boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, p.notify_email, p.notify_push,
         p.notify_leads, p.notify_opportunities, p.notify_service, p.notify_bids, p.notify_storms
    from public.profiles p
   where p.id = any(ids)
     and (auth.role() = 'service_role' or auth.uid() is not null);
$$;
revoke all on function public.notify_recipients(uuid[]) from public;
revoke all on function public.notify_recipients(uuid[]) from anon;
grant execute on function public.notify_recipients(uuid[]) to authenticated, service_role;
