-- Strangers get nothing (owner, Nov 14: "Yes go ahead with those suggestions").
--
-- Found while building Forgot password: the sign-in service has public sign-ups switched on. The
-- site has no sign-up page, but the service would take one from someone who knows how to ask,
-- and such an account has no profile. Measured on the live database before this file:
--
--   A signed-in account with NO profile could read
--     * nine tables whose read rule was just "signed in": bid_locks, county_codes,
--       data_refreshes, inventory_locations, inventory_movements, inventory_settings,
--       lead_sources, storm_settings, vehicle_drivers;
--     * assignable_users() (every person's name and email), estimator_names(),
--       inventory_bid_options() (bid names) and inventory_job_options() (bid and ticket names,
--       which carry customer names);
--     and could write a "task" notice to anyone (notifications_insert_tasks).
--   A caller with NO account at all (only the site's public key) could
--     * read estimator_names() (seven staff names);
--     * call 97 functions. All but that one answered nothing or refused, but none of them is
--       meant for a caller without an account.
--
-- This file:
--   1. has_profile(): is the caller a person on the Users & access list?
--   2. The nine read rules, and the task-notice insert, require it.
--   3. The four functions, and three read-only views (the item-number map, the company's public
--      details, the pricing units), require it (the server's own key still passes).
--   4. No function in public may be run without an account: EXECUTE is taken from anon and from
--      PUBLIC. Every function a signed-in person could run before, they can still run (checked:
--      the same count before and after). New functions made from here on start the same way.
--
-- Switching public sign-ups off is a setting of the sign-in service, not of this database. It was
-- switched off the same day (docs/qa/stranger-access-2026-11-14.md), so an account with no
-- profile can no longer be made at all; this file is the second lock on the same door.
--
-- Idempotent. No data changes.

-- 1. A person with a profile.
create or replace function public.has_profile()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;
revoke all on function public.has_profile() from public, anon;
grant execute on function public.has_profile() to authenticated, service_role;

-- 2. The nine read rules: signed in AND on the list.
alter policy "bid_locks_read" on public.bid_locks using ((select public.has_profile()));
alter policy "county_codes_read" on public.county_codes using ((select public.has_profile()));
alter policy "data_refreshes read" on public.data_refreshes using ((select public.has_profile()));
alter policy "inventory_locations_read" on public.inventory_locations using ((select public.has_profile()));
alter policy "inventory_movements_read" on public.inventory_movements using ((select public.has_profile()));
alter policy "inventory_settings_read" on public.inventory_settings using ((select public.has_profile()));
alter policy "lead_sources_read" on public.lead_sources using ((select public.has_profile()));
alter policy "storm_settings_read" on public.storm_settings using ((select public.has_profile()));
alter policy "vehicle_drivers_read" on public.vehicle_drivers using ((select public.has_profile()));

--    A task notice may be written by a person on the list only (the kinds as before).
alter policy "notifications_insert_tasks" on public.notifications
  with check (
    (select public.has_profile())
    and kind = any (array['task'::text, 'task_today'::text, 'task_overdue'::text])
  );

-- 3. The four functions. Bodies as they were, with "signed in" made "on the list" (or the
--    server's own key, which the reminder and task passes use).
create or replace function public.assignable_users()
returns table(id uuid, full_name text, email text)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where (select public.has_profile()) or auth.role() = 'service_role'
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;

create or replace function public.estimator_names()
returns setof text
language sql stable security definer set search_path to 'public' as $$
  select distinct coalesce(nullif(trim(p.full_name), ''), p.email) as name
  from public.profiles p
  where (p.role in ('admin','manager') or 'estimate' = any(p.access))
    and ((select public.has_profile()) or auth.role() = 'service_role')
  order by 1;
$$;

create or replace function public.inventory_bid_options()
returns table(id uuid, name text, status text, updated_at timestamp with time zone)
language sql stable security definer set search_path to 'public' as $$
  select b.id, b.name, b.status, b.updated_at
    from public.bids b
   where b.deleted_at is null
     and ((select public.has_profile()) or auth.role() = 'service_role')
   order by b.updated_at desc
   limit 500;
$$;

create or replace function public.inventory_job_options()
returns table(kind text, id uuid, name text, status text, updated_at timestamp with time zone)
language sql stable security definer set search_path to 'public' as $$
  select 'bid'::text as kind, b.id, b.name, b.status, b.updated_at
    from public.bids b
   where b.deleted_at is null
     and ((select public.has_profile()) or auth.role() = 'service_role')
  union all
  select 'service'::text, s.id,
         '#' || s.number || ' ' || s.customer_name || case when s.description <> '' then ' — ' || s.description else '' end,
         s.stage, s.updated_at
    from public.service_jobs s
   where s.deleted_at is null
     and ((select public.has_profile()) or auth.role() = 'service_role')
   order by updated_at desc
   limit 800;
$$;

--    Three read-only views that hand every signed-in account a few columns of a guarded table
--    (the item-number map, the company's public details, the pricing units). They answered an
--    account with no profile too. Same columns, same options; the caller must be on the list.
create or replace view public.catalog_item_numbers_map with (security_invoker = false, security_barrier = true) as
  select item_no, screen_id, row_label, price_col, dl_description
    from public.catalog_item_numbers n
   where (select public.has_profile()) or auth.role() = 'service_role';
create or replace view public.company_settings_public with (security_invoker = false, security_barrier = true) as
  select id, company_name, address, city, state, zip, phone, shop_address, shop_city, shop_state, shop_zip
    from public.company_settings c
   where (select public.has_profile()) or auth.role() = 'service_role';
create or replace view public.pricing_catalog_units with (security_invoker = false, security_barrier = true) as
  select id, branch, category, sort, public.pricing_catalog_unit_data(data) as data
    from public.pricing_catalog pc
   where (select public.has_profile()) or auth.role() = 'service_role';

-- 4. Nothing in public runs without an account. A function a signed-in person could run only
--    through PUBLIC keeps running for them by a grant of its own.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_had,
           has_function_privilege('service_role', p.oid, 'execute') as svc_had
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    if r.auth_had then execute format('grant execute on function %s to authenticated', r.fn); end if;
    if r.svc_had then execute format('grant execute on function %s to service_role', r.fn); end if;
  end loop;
end $$;

--    And functions made from here on start without the anonymous grant.
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
