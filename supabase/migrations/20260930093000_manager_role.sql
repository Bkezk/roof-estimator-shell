-- Manager role (owner, Sep 30: "users should only see their own stuff except for managers who
-- see everything"; "Go ahead and make manager role"). A manager reaches every page except
-- Estimate Pricing and the Admin pages, and sees everyone's tickets, tasks and follow-ups even
-- when ticked Technician (and may dispatch). Technicians still see only their own tickets.
-- Also: My Work (/my-work) lets every user read the tasks assigned to them, and gives admins and
-- managers the people picker (work_people). Idempotent.

-- 1. The role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','manager','user'));

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'manager'
  );
$$;
revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to authenticated;

-- 2. Pages: an admin every page; a manager every page but 'pricing' (Estimate Pricing); a user
-- the pages granted. The Admin pages (users, reminders, service rates) check is_admin().
create or replace function public.has_access(page text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin'
           or (p.role = 'manager' and page <> 'pricing')
           or page = any(p.access))
  );
$$;

-- 3. Service tickets: wherever an admin was exempt from the technician rule, a manager is too.
-- A technician who is neither still sees and edits only the tickets assigned to them.
drop policy if exists service_jobs_read on public.service_jobs;
create policy service_jobs_read on public.service_jobs for select to authenticated
  using (
    public.has_access('customers')
    or (public.has_access('service')
        and (not public.is_technician() or public.is_admin() or public.is_manager()
             or technician_id = auth.uid()))
  );
drop policy if exists service_jobs_insert on public.service_jobs;
create policy service_jobs_insert on public.service_jobs for insert to authenticated
  with check (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or public.is_manager()
         or (technician_id = auth.uid() and stage in ('open','scheduled','done')))
  );
drop policy if exists service_jobs_update on public.service_jobs;
create policy service_jobs_update on public.service_jobs for update to authenticated
  using (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or public.is_manager()
         or technician_id = auth.uid())
  )
  with check (
    public.has_access('service')
    and (not public.is_technician() or public.is_admin() or public.is_manager()
         or (technician_id = auth.uid() and stage in ('open','scheduled','done')))
  );

-- 4. Rosters that list "who has page X" count managers like admins.
create or replace function public.estimator_names()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct coalesce(nullif(trim(p.full_name), ''), p.email) as name
  from public.profiles p
  where p.role in ('admin','manager') or 'estimate' = any(p.access)
  order by 1;
$$;
revoke all on function public.estimator_names() from public;
grant execute on function public.estimator_names() to authenticated;

create or replace function public.technician_options()
returns table (id uuid, full_name text, email text, technician boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.technician
    from public.profiles p
   where public.has_access('service')
     and (p.technician or p.role in ('admin','manager') or 'service' = any(p.access))
   order by p.technician desc, coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.technician_options() from public;
grant execute on function public.technician_options() to authenticated;

create or replace function public.prospect_user_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where (p.role in ('admin','manager') or 'prospect' = any(p.access))
     and (auth.role() = 'service_role' or public.has_access('prospect'));
$$;
revoke all on function public.prospect_user_ids() from public;
grant execute on function public.prospect_user_ids() to authenticated, service_role;

-- 5. My Work: a user reads the tasks assigned to them even without Prospecting / Estimate
-- (writes are unchanged: Prospecting only).
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate') or assignee = auth.uid());

-- 6. My Work's "Show" picker: every profile's id and display name, for admins and managers only
-- (profiles RLS hides other users' rows from a manager). Nobody else gets any row.
create or replace function public.work_people()
returns table (id uuid, full_name text, email text, technician boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.technician
    from public.profiles p
   where public.is_admin() or public.is_manager()
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.work_people() from public;
grant execute on function public.work_people() to authenticated;
