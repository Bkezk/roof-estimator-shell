-- The system (the published app's service-role server client, the reminders cron) runs the two
-- helpers below too, and there auth.uid() is null, so their page checks (has_access reads
-- auth.uid()) returned nothing: technician_options() came back empty under the service role,
-- so a ticket reaching Done told no one and opened no "Invoice ticket #" follow-up, and
-- stamp_dispatch() never stamped, so the ten-minute throttle on the app's reminder pass never
-- armed. Both now let the system through, the way notify_recipients() / escalation_recipients()
-- / crm_followups_manager_only() already do. A signed-in user's result is exactly as before
-- (the has_access checks are unchanged). The anon key (no user, role 'anon') is NOT the system:
-- it is refused in the body and its EXECUTE is revoked (Supabase's default privileges grant it
-- on every new public function; "revoke all ... from public" does not remove that grant).
-- Idempotent.

-- Who counts as the system, in both bodies: the service role, or SQL with no request at all
-- (the SQL editor, migrations: no JWT, so auth.role() is null). Never anon (no user, role
-- 'anon'), never a signed-in user (role 'authenticated'):
--   coalesce(auth.role(), '') = 'service_role'
--   or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))

-- 1. The Service roster (technicians, office, admins and managers): the system sees it all, a
-- signed-in user only with Service access (unchanged).
create or replace function public.technician_options()
returns table (id uuid, full_name text, email text, technician boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.technician
    from public.profiles p
   where (coalesce(auth.role(), '') = 'service_role'
          or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))
          or public.has_access('service'))
     and (p.technician or p.role in ('admin','manager') or 'service' = any(p.access))
   order by p.technician desc, coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.technician_options() from public;
revoke all on function public.technician_options() from anon;
grant execute on function public.technician_options() to authenticated, service_role;

-- 2. The reminder pass's "last ran" stamp: the system stamps; a signed-in user only with
-- Customers / Service / Estimate access (unchanged).
create or replace function public.stamp_dispatch()
returns void language sql security definer set search_path = public as $$
  update public.crm_settings set last_dispatch_at = now() where id = 1
    and (coalesce(auth.role(), '') = 'service_role'
         or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))
         or public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
$$;
revoke all on function public.stamp_dispatch() from public;
revoke all on function public.stamp_dispatch() from anon;
grant execute on function public.stamp_dispatch() to authenticated, service_role;

-- 3. A follow-up whose reminder failed to send (src/lib/notify.server.ts dispatchDueReminders):
-- the pass claims the reminder before sending (it is not retried, so no one gets it twice), and
-- records the failure here for the Reminders page and the logs.
alter table public.crm_followups add column if not exists dispatch_errors integer not null default 0;
alter table public.crm_followups add column if not exists last_dispatch_error text;
alter table public.crm_followups add column if not exists last_dispatch_error_at timestamptz;
