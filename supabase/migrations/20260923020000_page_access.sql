-- Per-page access (owner, 2026-09-23). Roles collapse to admin | user; a user is granted any
-- combination of pages: estimate (bids + estimator, listed as an estimator on Setup), pricing
-- (the Estimate Pricing admin pages), inventory. Admins reach everything and manage users.
-- Existing rows: estimator → user with estimate + inventory (what an estimator could open);
-- field → user with inventory only. Idempotent.

alter table public.profiles add column if not exists access text[] not null default '{}';

-- The old role check must go BEFORE the rows move to 'user'.
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set access = array['estimate','inventory'] where role = 'estimator' and access = '{}';
update public.profiles set access = array['inventory'] where role = 'field' and access = '{}';
update public.profiles set role = 'user' where role in ('estimator','field');
alter table public.profiles add constraint profiles_role_check check (role in ('admin','user'));
alter table public.profiles drop constraint if exists profiles_access_check;
alter table public.profiles add constraint profiles_access_check
  check (access <@ array['estimate','pricing','inventory']::text[]);
alter table public.profiles alter column role set default 'user';

-- Page check for RLS. SECURITY DEFINER so it reads profiles without tripping RLS.
create or replace function public.has_access(page text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'admin' or page = any(p.access))
  );
$$;

-- Bids: Estimate access.
drop policy if exists "bids_authenticated_all" on public.bids;
create policy "bids_authenticated_all" on public.bids
  for all to authenticated
  using (public.has_access('estimate'))
  with check (public.has_access('estimate'));

-- Inventory: Inventory access records leftovers; Estimate access (or admin) records anything.
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.has_access('estimate')
    or (public.has_access('inventory') and reason = 'leftover')
  );

-- Every pricing / labor / catalog write policy that was admin-only now follows the Estimate
-- Pricing grant. Profiles, inventory settings and ledger deletes stay admin-only.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%is_admin()%' or coalesce(with_check, '') like '%is_admin()%')
      and tablename not in ('profiles', 'inventory_settings', 'inventory_movements', 'bid_locks')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    if r.cmd = 'ALL' then
      execute format('create policy %I on public.%I for all to authenticated using (public.has_access(''pricing'')) with check (public.has_access(''pricing''))', r.policyname, r.tablename);
    elsif r.cmd = 'SELECT' then
      execute format('create policy %I on public.%I for select to authenticated using (public.has_access(''pricing''))', r.policyname, r.tablename);
    elsif r.cmd = 'INSERT' then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.has_access(''pricing''))', r.policyname, r.tablename);
    elsif r.cmd = 'UPDATE' then
      execute format('create policy %I on public.%I for update to authenticated using (public.has_access(''pricing'')) with check (public.has_access(''pricing''))', r.policyname, r.tablename);
    elsif r.cmd = 'DELETE' then
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_access(''pricing''))', r.policyname, r.tablename);
    end if;
  end loop;
end $$;
