-- "Sign out all devices" for one person (security audit, Nov 14; owner: "go with the sign out
-- all devices button per person").
--
-- Found: a device that signs in stays signed in until someone signs out on it. 27 devices were
-- signed in, the oldest for 47 days. For a lost phone the only tool was removing the person.
--
-- This function ends every sign-in of one person: it deletes their sessions, and their renewal
-- tokens go with them (refresh_tokens_session_id_fkey, on delete cascade). A device that is open
-- at that moment holds a pass good for up to an hour; it cannot renew it, so it stops within the
-- hour. Returns how many sign-ins were ended.
--
-- Only the server's own key may run it. The server function that calls it
-- (signOutUserEverywhere, src/lib/auth.functions.ts) checks that the caller is an admin first.
--
-- Idempotent. Touches no table of the app.
create or replace function public.sign_out_everywhere(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the server may sign a person out everywhere' using errcode = '42501';
  end if;
  if p_user is null then
    return 0;
  end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.sign_out_everywhere(uuid) from public, anon, authenticated;
grant execute on function public.sign_out_everywhere(uuid) to service_role;
