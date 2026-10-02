-- Notification preferences save for everyone (owner, Oct 2): the Account page's email / push
-- switches did nothing for managers, sales / PMs and technicians.
--
-- Why: setNotifyPrefs updated profiles directly, through row security, and profiles has only
-- an admin UPDATE policy (profiles_admin_update). A non-admin's update matched 0 rows and
-- PostgREST reports that as success, so the switch flipped back with no error. A self-update
-- policy cannot be added safely: RLS is per row, not per column, so it would let any user
-- rewrite their own role and access.
--
-- Fix, the same way the theme is saved (20261002170000_theme.sql): set_my_notify_prefs(p_email,
-- p_push), SECURITY DEFINER, keyed strictly on auth.uid(), touching only notify_email and
-- notify_push. A null argument keeps that column as it is (the page saves one switch at a time).
-- It returns the row's values after the write, so the app can check the save really happened;
-- a missing profile row is an error, never a silent no-op.
--
-- Applying it: additive only (one function, its grants). Idempotent: create or replace, grants
-- re-stated. Until it is applied the app's save shows "could not save" instead of pretending.

create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean)
returns table (notify_email boolean, notify_push boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_email boolean;
  v_push boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles as p
     set notify_email = coalesce(p_email, p.notify_email),
         notify_push = coalesce(p_push, p.notify_push)
   where p.id = auth.uid()
  returning p.notify_email, p.notify_push into v_email, v_push;
  if not found then
    raise exception 'Your profile was not found' using errcode = 'P0002';
  end if;
  notify_email := v_email;
  notify_push := v_push;
  return next;
end;
$$;

revoke all on function public.set_my_notify_prefs(boolean, boolean) from public;
revoke all on function public.set_my_notify_prefs(boolean, boolean) from anon;
grant execute on function public.set_my_notify_prefs(boolean, boolean) to authenticated;
