-- Phase 1: authentication, roles, and RLS scoping.
-- Idempotent so it is safe whether applied by the Supabase migration runner or directly.

-- 1. Profiles: one row per auth user, carrying the role.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'estimator' check (role in ('admin','estimator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- keep updated_at fresh (reuse the existing helper if present)
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- 2. Role helper. SECURITY DEFINER so it reads profiles without tripping RLS
--    (prevents infinite recursion when used inside profiles' own policies).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- 3. RLS on profiles. No anon access at all.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- 4. Lock down bids: remove the wide-open anon policies, require a signed-in user.
alter table public.bids enable row level security;
drop policy if exists "Allow anon full access to bids" on public.bids;
drop policy if exists "Allow authenticated full access to bids" on public.bids;
revoke all on public.bids from anon;

drop policy if exists "bids_authenticated_all" on public.bids;
create policy "bids_authenticated_all" on public.bids
  for all to authenticated
  using (true) with check (true);

-- Defense in depth: profiles is authenticated-only; no anon table grants.
revoke all on public.profiles from anon;
