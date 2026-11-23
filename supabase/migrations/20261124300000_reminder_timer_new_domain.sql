-- The reminder timer calls the site at its own domain (Nov 23, 2026).
--
-- The owner connected jbkbid.com that evening. From then on the old address,
-- jbkbid.lovable.app, answers every request with a redirect to the new one. The timer's call
-- carries its token in a header, and a redirect to another host drops that header: the 18:32 UTC
-- run was refused (401 Unauthorized) where every run before it answered 200. So no reminder
-- pass ran.
--
-- The timer now posts straight to https://jbkbid.com/api/cron/reminders. Nothing else in the
-- function changes. Applied by hand at 19:00 UTC the same evening, before the 19:02 run.

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
    url := 'https://jbkbid.com/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request;
  return v_request;
end $$;
