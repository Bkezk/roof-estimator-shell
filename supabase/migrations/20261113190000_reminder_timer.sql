-- The reminder timer moves into the database (owner, Nov 13: "if moving the timers to the
-- database itself helps and doesn't negatively effect things then yes go for it").
--
-- Why: GitHub was asked to call /api/cron/reminders twice an hour and did so about twice a day,
-- hours late, even after the schedule was moved off its busiest minutes (checked Nov 13: no run
-- in the 80 minutes after the move, the last one 18 hours old). The database has its own clock
-- (pg_cron) and can make the call itself (pg_net). GitHub's schedule stays as a backup: the
-- reminder pass claims each reminder before it sends, so two callers never send one twice.
--
-- The secret. The endpoint only answers a caller that proves who it is. GitHub does that with
-- CRON_SECRET, which the database must never hold in the open and which no session may read. So
-- the timer has a token of its own:
--   * made here, inside the database, from 32 random bytes; nobody is shown it;
--   * kept in the vault (encrypted at rest), under the name reminder_timer_token;
--   * sent only by maint.reminder_timer(), only to the one address written in that function;
--   * checked by the app through public.cron_timer_ok(), which answers yes or no to the server
--     (service role) and to nobody else. The app accepts it on the reminders endpoint alone
--     (src/lib/cron-auth.ts, src/lib/cron-timer.ts).
-- Until the app carrying that check is published, the timer's calls are answered 401 and nothing
-- else happens: reminders keep going out the old ways (GitHub, and an office user opening the
-- site).
--
-- The hours are the GitHub job's own (12:00 to 23:59 UTC: the working day in Eastern time, summer
-- and winter), so nothing goes out at an hour it did not before. Minutes 2 and 32, five minutes
-- ahead of GitHub's 7 and 37: reminders set for 8:00 AM Eastern go out at 8:02.
--
-- To stop it:   select cron.unschedule('reminder-timer');
-- To see it:    select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 10;
--               select id, status_code, created from net._http_response order by created desc limit 10;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. The timer's own token: made once, never replaced by a re-run, never shown.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reminder_timer_token') then
    perform vault.create_secret(
      'dbt_' || encode(extensions.gen_random_bytes(32), 'hex'),
      'reminder_timer_token',
      'The database reminder timer signs its calls to /api/cron/reminders with this. Made in the database; never shown.'
    );
  end if;
end $$;

-- 2. The app's question: "is this the timer's token?" Yes or no, to the server only.
create or replace function public.cron_timer_ok(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.role(), '') = 'service_role'
     and p_token is not null
     and exists (
       select 1 from vault.decrypted_secrets s
        where s.name = 'reminder_timer_token'
          and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_token, 'sha256')
     );
$$;
revoke all on function public.cron_timer_ok(text) from public, anon, authenticated;
grant execute on function public.cron_timer_ok(text) to service_role;

-- 3. The call. The address is written here and nowhere else, so the token can go to no other
--    place. A different published address means changing this one line.
create or replace function maint.reminder_timer()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_request bigint;
begin
  select s.decrypted_secret into v_token
    from vault.decrypted_secrets s where s.name = 'reminder_timer_token';
  if v_token is null then
    raise exception 'reminder timer: no token in the vault (reminder_timer_token)';
  end if;
  select net.http_post(
    url := 'https://jbkbid.lovable.app/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request;
  return v_request;
end $$;
revoke all on function maint.reminder_timer() from public, anon, authenticated, service_role;

-- 4. The schedule (UTC), and a weekly tidy of the timer's own run log.
select cron.schedule('reminder-timer', '2,32 12-23 * * *', $$select maint.reminder_timer()$$);
select cron.schedule(
  'reminder-timer-tidy',
  '15 6 * * 0',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$
);
