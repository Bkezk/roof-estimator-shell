-- Lead notices are opt-in (owner, Oct 12): a per-person "Lead notices" switch on the Account
-- page, off for everyone until they turn it on.
--
-- Today the bid-board pass (leads.server.ts saveLeadRows) sends its "Bid Board: N new roof
-- jobs" notice (kind 'lead') to prospect_user_ids(): every admin, manager and Prospecting
-- login. Most of them do not work the bid boards, so the inbox row, email and push are noise.
--
-- 1. profiles.notify_leads, boolean not null default false.
-- 2. set_my_notify_prefs(p_email, p_push, p_leads): the Account page's save, extended with the
--    new column (SECURITY DEFINER, the caller's own row, a null keeps a column, returns the row
--    after the write — exactly as 20261002180000_notify_prefs.sql). The two-argument form stays
--    callable (an app still running the old code during the deploy) as a thin wrapper over the
--    new one, so there is one body.
-- 3. lead_notice_user_ids(): prospect_user_ids() narrowed to the people who opted in. The leads
--    pass asks this instead of prospect_user_ids() so nobody with the switch off gets an inbox
--    row, email or push. It is a SECURITY DEFINER function, not a profiles read in the app:
--    the in-app refresh runs as a Prospecting user (the preview has no service-role key), and
--    profiles RLS (profiles_select_self_or_admin) shows that user only their own row. Storm
--    notices keep prospect_user_ids() as they are.
--    notify_recipients() is untouched.
--
-- Idempotent: add column if not exists, create or replace, grants re-stated. Additive only.

alter table public.profiles add column if not exists notify_leads boolean not null default false;

comment on column public.profiles.notify_leads is
  'Owner, Oct 12: lead notices (the bid-board stream) are opt-in; off by default because most people do not use them';

create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean, p_leads boolean)
returns table (notify_email boolean, notify_push boolean, notify_leads boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_email boolean;
  v_push boolean;
  v_leads boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  update public.profiles as p
     set notify_email = coalesce(p_email, p.notify_email),
         notify_push = coalesce(p_push, p.notify_push),
         notify_leads = coalesce(p_leads, p.notify_leads)
   where p.id = auth.uid()
  returning p.notify_email, p.notify_push, p.notify_leads into v_email, v_push, v_leads;
  if not found then
    raise exception 'Your profile was not found' using errcode = 'P0002';
  end if;
  notify_email := v_email;
  notify_push := v_push;
  notify_leads := v_leads;
  return next;
end;
$$;

revoke all on function public.set_my_notify_prefs(boolean, boolean, boolean) from public;
revoke all on function public.set_my_notify_prefs(boolean, boolean, boolean) from anon;
grant execute on function public.set_my_notify_prefs(boolean, boolean, boolean) to authenticated;

-- The two-argument form (20261002180000_notify_prefs.sql) keeps working: same return type, the
-- lead switch untouched (null keeps the column).
create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean)
returns table (notify_email boolean, notify_push boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select r.notify_email, r.notify_push
      from public.set_my_notify_prefs(p_email, p_push, null::boolean) as r;
end;
$$;

revoke all on function public.set_my_notify_prefs(boolean, boolean) from public;
revoke all on function public.set_my_notify_prefs(boolean, boolean) from anon;
grant execute on function public.set_my_notify_prefs(boolean, boolean) to authenticated;

-- Who gets a lead notice: the Prospecting people (prospect_user_ids: admins, managers, anyone
-- with the Prospecting page; the service role or a Prospecting caller) who turned the switch on.
create or replace function public.lead_notice_user_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where p.notify_leads
     and p.id in (select public.prospect_user_ids());
$$;
revoke all on function public.lead_notice_user_ids() from public;
grant execute on function public.lead_notice_user_ids() to authenticated, service_role;
