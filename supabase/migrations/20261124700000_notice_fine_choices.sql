-- Which notices, one by one (owner, Nov 24: "can you also add an ability to select which
-- notifications they want on more granularly like under ticket notifications you can choose to
-- be notified at open and closed but not scheduled?", then "Option A on notifications plz").
--
-- Under the Service, Opportunity and Bid switches on My account there is now a list of ticks,
-- one per notice type (src/lib/notice-types.ts). A tick turned off stops that one notice for
-- that person everywhere: the bell, the phone and email.
--
-- Only what is turned OFF is kept, so nobody's notices change when this is applied, and a
-- notice type added later is on for everyone.
--
-- 1. profiles.notify_off (text[], not null, default '{}'): the keys of the notice types this
--    person turned off. Empty for everyone until they untick something.
-- 2. notice_fine_keys(): the keys there are, the database's own copy of NOTICE_TYPE_KEYS in
--    src/lib/notice-types.ts (a test keeps the two the same). A notice type added later needs
--    this one small function replaced; until then its tick cannot be saved and says so.
-- 3. set_my_notify_off(p_off): the My account ticks' save. SECURITY DEFINER on the caller's own
--    row and that one column, like set_my_notify_own (only admins may update profiles
--    directly). The whole list goes in; every entry must be one of notice_fine_keys(), so
--    nothing else can be stored. It is kept each key once, in A to Z order, and handed back.
-- 4. notify_recipients(ids) hands the sender the off list next to the channels and the five
--    switches, so notify() (notify.server.ts) leaves out a person who turned that notice type
--    off: no inbox row, no email, no push. Its return type grows, so it is dropped and created
--    again. The definition is the one in 20261013170000_notice_categories.sql (the most recent
--    file that defines it) with one column added to the return table and to the select: the
--    same body rule (the service role, or any signed-in user) and the same grants. RUN THE DROP
--    AND THE CREATE TOGETHER, in one go, so the sender never finds the function missing.
--
-- The site works before and after this is applied, in either order: the code that reads the
-- new column treats "not there" as "nothing is off", and the old code ignores the extra column
-- notify_recipients hands back.
--
-- Idempotent: add column if not exists, create or replace / drop if exists, grants re-stated.
-- Additive to the data: one column with a default, no row changes. No policy is touched.

alter table public.profiles add column if not exists notify_off text[] not null default '{}';

comment on column public.profiles.notify_off is
  'Owner, Nov 24: the notice types this person turned off under their switches (keys of src/lib/notice-types.ts); empty = every type on';

-- The keys there are. The same list, in the same order, as NOTICE_TYPE_KEYS.
create or replace function public.notice_fine_keys()
returns text[] language sql stable set search_path = public as $$
  select array[
    'service_opened',
    'service_assigned_me',
    'service_reassigned',
    'service_scheduled',
    'service_date_moved',
    'service_reminders',
    'service_not_started',
    'service_nobody',
    'service_done',
    'service_authorized',
    'service_ready_to_invoice',
    'service_invoiced',
    'service_closed',
    'service_moved_back',
    'service_deleted',
    'opportunities_assigned_me',
    'opportunities_follow_up',
    'opportunities_not_started',
    'opportunities_nobody',
    'opportunities_steps',
    'bids_due_soon',
    'bids_past_due',
    'bids_my_reminders',
    'bids_steps'
  ]::text[];
$$;

revoke all on function public.notice_fine_keys() from public, anon, authenticated;

create or replace function public.set_my_notify_off(p_off text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_clean text[];
  v_saved text[];
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_off is null then
    raise exception 'the list is required' using errcode = '22004';
  end if;
  if exists (
    select 1 from unnest(p_off) as k
     where k is null or not (k = any (public.notice_fine_keys()))
  ) then
    raise exception 'not a notice type' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct k order by k), '{}'::text[])
    into v_clean
    from unnest(p_off) as k;
  update public.profiles as p
     set notify_off = v_clean
   where p.id = auth.uid()
  returning p.notify_off into v_saved;
  if not found then
    raise exception 'Your profile was not found' using errcode = 'P0002';
  end if;
  return v_saved;
end $$;

revoke all on function public.set_my_notify_off(text[]) from public, anon;
grant execute on function public.set_my_notify_off(text[]) to authenticated;

-- The recipients read for notify(): the channels, the five category switches and now the off
-- list. Taken whole from 20261013170000_notice_categories.sql; the only change is the last
-- column, `notify_off text[]` in the return table and `p.notify_off` in the select. A changed
-- return type cannot be replaced in place, hence the drop; the grants are the same as before,
-- with anon's default EXECUTE (Supabase grants it on every new function) revoked.
drop function if exists public.notify_recipients(uuid[]);
create function public.notify_recipients(ids uuid[])
returns table (
  id uuid, email text, full_name text, notify_email boolean, notify_push boolean,
  notify_leads boolean, notify_opportunities boolean, notify_service boolean, notify_bids boolean,
  notify_storms boolean, notify_off text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, p.notify_email, p.notify_push,
         p.notify_leads, p.notify_opportunities, p.notify_service, p.notify_bids, p.notify_storms,
         p.notify_off
    from public.profiles p
   where p.id = any(ids)
     and (auth.role() = 'service_role' or auth.uid() is not null);
$$;
revoke all on function public.notify_recipients(uuid[]) from public;
revoke all on function public.notify_recipients(uuid[]) from anon;
grant execute on function public.notify_recipients(uuid[]) to authenticated, service_role;
