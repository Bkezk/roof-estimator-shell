/* The limits of the public pages, and the day's email count (owner, Nov 24, 2026: "Go on 4s
   suggestions").

   1. The public pages' limits. For everyone together, a day: 2,000 price questions and 300
      requests (they were 400 and 60). For one connection: 20 price questions and 5 requests an
      hour as before, and now 60 and 10 a day. The count is taken in one step, so two calls in
      the same instant cannot both slip under a limit. A day is the office's day (Eastern).
      The answer says which limit was met, so the page can say "call us" in the right words,
      and it says once when the day's count for everyone passes four fifths and once when it
      is reached, so the office can be told.
   2. What the office sees: public_form_usage() gives today's counts beside their limits, the
      forms dropped as a robot's, the last thirty days, and the email count.
   3. Email. The site keeps its own count of what it sends, over the last 24 hours, as the
      email service counts. From four fifths of the day's limit, emails to staff about notices
      wait (the notice is still in the bell and on the phone) so the rest is kept for customers:
      agreements, receipts, invoices, payment links. The office is told once at four fifths and
      once when the email service refuses for the day. The limit is a setting (100 a day on the
      free plan; 0 means the plan has no daily limit).

   Applied by hand through the Lovable database tool (AGENTS.md). */

-- ── 1. The public pages' limits ─────────────────────────────────────────────────────────────

create or replace function public.public_form_take2(p_kind text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hour timestamptz := date_trunc('hour', now());
  -- The office's day: midnight to midnight, Eastern.
  v_day timestamptz :=
    date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
  v_hour_cap integer;
  v_one_cap integer;
  v_all_cap integer;
  v_day_key text;
  v_all integer;
  v_one integer;
  v_one_day integer;
  v_alert text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts requests' using errcode = '42501';
  end if;
  if p_kind = 'quote' then
    v_hour_cap := 20; v_one_cap := 60; v_all_cap := 2000;
  elsif p_kind = 'request' then
    v_hour_cap := 5; v_one_cap := 10; v_all_cap := 300;
  elsif p_kind = 'pay' then
    -- The card payment link in a customer's email. Opening it and pressing Pay each count. A
    -- link is a long random address nobody can guess; this only stops hammering.
    v_hour_cap := 30; v_one_cap := 200; v_all_cap := 2000;
  else
    return jsonb_build_object('ok', false, 'why', 'one');
  end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 80 or p_key = '*' then
    return jsonb_build_object('ok', false, 'why', 'one');
  end if;
  v_day_key := left(p_key, 78) || ':d';
  -- One connection's counts go after three days. The day's totals for everyone together (the
  -- '*' rows, which belong to no connection) are kept sixty days.
  delete from public.public_form_hits where bucket < now() - interval '3 days' and key <> '*';
  delete from public.public_form_hits where bucket < now() - interval '60 days';

  -- A call that is already over a limit is refused before anything is counted.
  select n into v_all from public.public_form_hits
   where kind = p_kind and key = '*' and bucket = v_day;
  if coalesce(v_all, 0) >= v_all_cap then
    return jsonb_build_object('ok', false, 'why', 'all', 'used', v_all, 'cap', v_all_cap);
  end if;
  select n into v_one_day from public.public_form_hits
   where kind = p_kind and key = v_day_key and bucket = v_day;
  if coalesce(v_one_day, 0) >= v_one_cap then
    return jsonb_build_object('ok', false, 'why', 'one_day');
  end if;
  select n into v_one from public.public_form_hits
   where kind = p_kind and key = p_key and bucket = v_hour;
  if coalesce(v_one, 0) >= v_hour_cap then
    return jsonb_build_object('ok', false, 'why', 'one');
  end if;

  -- Counted in one step each: the number that comes back is this call's own place in line,
  -- so two calls in the same instant cannot both be the last one allowed.
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, '*', v_day, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1
    returning n into v_all;
  if v_all > v_all_cap then
    return jsonb_build_object('ok', false, 'why', 'all', 'used', v_all_cap, 'cap', v_all_cap);
  end if;
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, v_day_key, v_day, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1
    returning n into v_one_day;
  if v_one_day > v_one_cap then
    return jsonb_build_object('ok', false, 'why', 'one_day');
  end if;
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, p_key, v_hour, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1
    returning n into v_one;
  if v_one > v_hour_cap then
    return jsonb_build_object('ok', false, 'why', 'one');
  end if;

  -- Said once each, by the call that makes it so: four fifths of the day's count for everyone,
  -- and the last one of the day.
  if p_kind in ('quote', 'request') then
    if v_all = v_all_cap then
      v_alert := 'reached';
    elsif v_all = ceil(v_all_cap * 0.8)::integer then
      v_alert := 'near';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'alert', v_alert, 'used', v_all, 'cap', v_all_cap);
end;
$function$;

revoke all on function public.public_form_take2(text, text) from public, anon, authenticated;
grant execute on function public.public_form_take2(text, text) to service_role;

-- The older door, for the site's code that still asks yes or no: the same count, the same limits.
create or replace function public.public_form_take(p_kind text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts requests' using errcode = '42501';
  end if;
  return coalesce((public.public_form_take2(p_kind, p_key)->>'ok')::boolean, false);
end;
$function$;

-- ── 3. The email count ──────────────────────────────────────────────────────────────────────

alter table public.public_form_settings
  add column if not exists email_daily_cap integer not null default 100;
alter table public.public_form_settings
  drop constraint if exists public_form_settings_email_daily_cap_check;
alter table public.public_form_settings
  add constraint public_form_settings_email_daily_cap_check
  check (email_daily_cap between 0 and 1000000);

create table if not exists public.email_sends (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('staff', 'customer')),
  held boolean not null default false
);
create index if not exists email_sends_at_idx on public.email_sends (at);
alter table public.email_sends enable row level security;
revoke all on table public.email_sends from public, anon, authenticated;

create table if not exists public.email_state (
  id integer primary key check (id = 1),
  resend_used integer,
  resend_at timestamptz,
  near_told_at timestamptz,
  full_told_at timestamptz
);
insert into public.email_state (id) values (1) on conflict (id) do nothing;
alter table public.email_state enable row level security;
revoke all on table public.email_state from public, anon, authenticated;

/* Before an email goes out. `staff` is an email to one of us about a notice; `customer` is
   anything sent to a customer. Answers whether to send it, and `alert` = 'near' the one time
   the count passes four fifths of the day's limit. */
create or replace function public.email_take(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cap integer;
  v_hold integer;
  v_used integer;
  s public.email_state;
  v_alert text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts emails' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('staff', 'customer') then
    raise exception 'An email is to staff or to a customer' using errcode = '22023';
  end if;
  select email_daily_cap into v_cap from public.public_form_settings where id = 1;
  v_cap := coalesce(v_cap, 100);
  delete from public.email_sends where at < now() - interval '60 days';
  -- One at a time: the next email waits for this one's count.
  select * into s from public.email_state where id = 1 for update;
  select count(*) into v_used from public.email_sends
   where at > now() - interval '24 hours' and not held;
  if v_cap <= 0 then
    -- A plan with no daily limit: counted, never held.
    insert into public.email_sends (kind) values (p_kind);
    return jsonb_build_object('send', true, 'used', v_used + 1, 'cap', 0);
  end if;
  -- The email service's own count, when it told us lately and it is the higher of the two.
  if s.resend_at is not null and s.resend_at > now() - interval '1 hour'
     and coalesce(s.resend_used, 0) > v_used
  then
    v_used := s.resend_used;
  end if;
  v_hold := floor(v_cap * 0.8)::integer;
  if p_kind = 'staff' and v_used >= v_hold then
    insert into public.email_sends (kind, held) values ('staff', true);
    return jsonb_build_object('send', false, 'why', 'held', 'used', v_used, 'cap', v_cap);
  end if;
  insert into public.email_sends (kind) values (p_kind);
  v_used := v_used + 1;
  if v_used >= v_hold
     and (s.near_told_at is null or s.near_told_at < now() - interval '24 hours')
  then
    update public.email_state set near_told_at = now() where id = 1;
    v_alert := 'near';
  end if;
  return jsonb_build_object('send', true, 'alert', v_alert, 'used', v_used, 'cap', v_cap);
end;
$function$;

/* After the email service answered: its own count for the day when it gave one, and whether
   it refused the email because the day's limit is reached. `alert` = 'full' the one time. */
create or replace function public.email_seen(p_used integer, p_refused boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cap integer;
  s public.email_state;
  v_alert text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts emails' using errcode = '42501';
  end if;
  select email_daily_cap into v_cap from public.public_form_settings where id = 1;
  v_cap := coalesce(v_cap, 100);
  select * into s from public.email_state where id = 1 for update;
  if p_used is not null and p_used >= 0 and p_used <= 10000000 then
    update public.email_state set resend_used = p_used, resend_at = now() where id = 1;
  end if;
  if coalesce(p_refused, false)
     and (s.full_told_at is null or s.full_told_at < now() - interval '24 hours')
  then
    update public.email_state set full_told_at = now() where id = 1;
    v_alert := 'full';
  end if;
  return jsonb_build_object('alert', v_alert, 'used', p_used, 'cap', v_cap);
end;
$function$;

revoke all on function public.email_take(text) from public, anon, authenticated;
revoke all on function public.email_seen(integer, boolean) from public, anon, authenticated;
grant execute on function public.email_take(text) to service_role;
grant execute on function public.email_seen(integer, boolean) to service_role;

-- The day's email limit, set by an admin or a manager (Setup, QR pages).
create or replace function public.email_daily_cap_set(p_cap integer)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not (public.is_admin() or public.is_manager()) then
    raise exception 'Only an admin or a manager changes the email limit' using errcode = '42501';
  end if;
  if p_cap is null or p_cap < 0 or p_cap > 1000000 then
    raise exception 'Type a whole number from 0 to 1,000,000' using errcode = '22023';
  end if;
  update public.public_form_settings set email_daily_cap = p_cap where id = 1;
  return p_cap;
end;
$function$;

revoke all on function public.email_daily_cap_set(integer) from public, anon;
grant execute on function public.email_daily_cap_set(integer) to authenticated, service_role;

-- ── 2. What the office sees ─────────────────────────────────────────────────────────────────

create or replace function public.public_form_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_day timestamptz :=
    date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
  v_cap integer;
  v_days jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_access('customers') then
    raise exception 'Only the office reads the public pages'' counts' using errcode = '42501';
  end if;
  select email_daily_cap into v_cap from public.public_form_settings where id = 1;
  v_cap := coalesce(v_cap, 100);
  -- A day's total is filed under the day it was counted in: noon of it, read in Eastern time,
  -- gives the right date for a total kept at midnight Eastern and for the older ones kept at
  -- midnight UTC.
  select coalesce(jsonb_agg(d order by d->>'day' desc), '[]'::jsonb) into v_days
    from (
      select jsonb_build_object(
        'day', x.day,
        'quote', coalesce(sum(x.n) filter (where x.kind = 'quote'), 0),
        'request', coalesce(sum(x.n) filter (where x.kind = 'request'), 0),
        'dropped', coalesce(sum(x.n) filter (where x.kind = 'trap'), 0)) as d
      from (
        select ((h.bucket + interval '12 hours') at time zone 'America/New_York')::date as day,
               h.kind, h.n
          from public.public_form_hits h
         where h.key = '*' and h.kind in ('quote', 'request', 'trap')
           and h.bucket > now() - interval '31 days'
      ) x
      group by x.day
    ) y;
  return jsonb_build_object(
    'quote', jsonb_build_object(
      'used', coalesce((select n from public.public_form_hits
                         where kind = 'quote' and key = '*' and bucket = v_day), 0),
      'cap', 2000),
    'request', jsonb_build_object(
      'used', coalesce((select n from public.public_form_hits
                         where kind = 'request' and key = '*' and bucket = v_day), 0),
      'cap', 300),
    'days', v_days,
    'email', jsonb_build_object(
      'used', (select count(*) from public.email_sends
                where at > now() - interval '24 hours' and not held),
      'held', (select count(*) from public.email_sends
                where at > now() - interval '24 hours' and held),
      'cap', v_cap,
      'hold', floor(v_cap * 0.8)::integer));
end;
$function$;

revoke all on function public.public_form_usage() from public, anon;
grant execute on function public.public_form_usage() to authenticated, service_role;
