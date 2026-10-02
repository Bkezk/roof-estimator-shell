-- Dark mode (owner, Oct 2): each user's light / dark choice follows them from device to device.
--
-- 1. profiles.theme: 'light', 'dark' or 'system' (follow the device's setting; the default
--    until the user first toggles). The browser also caches the choice (src/lib/theme.ts) so the
--    page paints in the right theme before anyone is signed in; after sign-in this value wins.
-- 2. set_my_theme(p_theme): the signed-in user writes their OWN theme and nothing else.
--    profiles has no self-update policy (profiles_admin_update is the only UPDATE policy, admins
--    only), and one cannot be added safely: RLS is per row, not per column, so a "self" policy
--    would let any user rewrite their own role and access. The function is SECURITY DEFINER,
--    keyed strictly on auth.uid(), and touches the one column.
-- Reading needs nothing new: profiles_select_self_or_admin already lets a user read their row.
--
-- Applying it: additive only. The app version that uses it works before it is applied (the
-- theme read answers "no saved choice" and the write is skipped, leaving the browser's copy).
-- Idempotent: add column if not exists, the check re-created by name, create or replace, grants
-- re-stated.

alter table public.profiles add column if not exists theme text default 'system';
update public.profiles set theme = 'system' where theme is null;
alter table public.profiles alter column theme set default 'system';
alter table public.profiles alter column theme set not null;
alter table public.profiles drop constraint if exists profiles_theme_check;
alter table public.profiles
  add constraint profiles_theme_check check (theme in ('light', 'dark', 'system'));

create or replace function public.set_my_theme(p_theme text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_theme is null or p_theme not in ('light', 'dark', 'system') then
    raise exception 'Unknown theme: %', coalesce(p_theme, 'null') using errcode = '22023';
  end if;
  update public.profiles set theme = p_theme where id = auth.uid();
end;
$$;

revoke all on function public.set_my_theme(text) from public;
revoke all on function public.set_my_theme(text) from anon;
grant execute on function public.set_my_theme(text) to authenticated;
