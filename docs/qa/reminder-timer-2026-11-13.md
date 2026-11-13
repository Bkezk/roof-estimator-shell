# The reminder timer moves into the database (Nov 13)

Owner: "if moving the timers to the database itself helps and doesn't negatively effect things
then yes go for it."

## Why

GitHub was asked to call `/api/cron/reminders` twice an hour and did so about twice a day, hours
late. Moving the schedule off the top of the hour (commit 4639a28) did not help: 80 minutes after
it, no run had arrived and the last one was 18 hours old. Reminders still went out, because the
site also runs the reminder pass when an office user opens it, but not on time.

## What was built

The database keeps the time itself (`pg_cron`) and makes the call (`pg_net`).

- **Schedule:** minutes 2 and 32 of every hour from 12:00 to 23:59 UTC. Those are the GitHub job's
  own hours, so nothing goes out at an hour it did not before. Reminders set for 8:00 AM Eastern
  go out at 8:02.
- **GitHub stays as a backup** at minutes 7 and 37. The reminder pass claims each reminder before
  it sends, so two callers never send one twice.
- **A weekly tidy** removes the timer's own run log older than 14 days.

## The secret

The endpoint only answers a caller it knows. The database must not hold `CRON_SECRET`, so the
timer has a token of its own.

- Made inside the database from 32 random bytes. Nobody was shown it. It is in no file, no
  setting and no chat.
- Kept in the database vault, encrypted, under the name `reminder_timer_token`.
- Sent only by `maint.reminder_timer()`, only to the one address written in that function.
- Checked by `public.cron_timer_ok()`, which answers yes or no to the server and nobody else.
- Accepted by the reminders endpoint alone. Leads and storms do not take it.
- The most it can do is start the reminder pass, which is safe to run at any time.

## Applied on the live database

`supabase/migrations/20261113190000_reminder_timer.sql`, run by hand and checked.

- `pg_cron` 1.6.4 and `pg_net` 0.20.4 installed.
- Both functions match the file (md5 of the body): `cron_timer_ok` 85b7307d…, `reminder_timer`
  ddfd6620….
- Jobs `reminder-timer` and `reminder-timer-tidy` are active.

## Proof

- **Who may ask.** With the real token, read inside the database and never shown: the server gets
  yes. A wrong token, no token, the database owner outside the API, a signed-in user and an
  anonymous caller all get no or are refused.
- **The public API cannot reach the parts.** `net`, `cron`, `vault` and `maint` answer "Invalid
  schema" to the public key. Only `public` and `graphql_public` are exposed.
- **The call leaves the database and reaches the site.** A hand-run call was answered 401 by the
  published site within a second, and the outgoing queue was empty after. 401 is right for now:
  the published site does not know the token until this code is published.
- **The endpoint.** Local run: no token, a wrong secret and an unknown timer-shaped token are all
  refused on reminders, a timer-shaped token is refused on leads, and the owner's secret still
  gets in.
- **Tests:** `src/lib/reminder-timer-nov13n.test.ts`, 16 tests, 4 fail on the old code. Full chain
  clean: 551 files, 7,213 tests, lint 0 errors, types, build.

## Still to see

The whole path with a yes at the end needs the site published. After that, Admin › Reminders
shows the last scheduled run moving every half hour, and `net._http_response` shows 200.

## To stop or look

```sql
select cron.unschedule('reminder-timer');                                   -- stop
select * from cron.job;                                                     -- the schedule
select * from cron.job_run_details order by start_time desc limit 10;       -- did it fire
select id, status_code, created from net._http_response order by created desc limit 10;
```

If the published address ever changes, it is one line in `maint.reminder_timer()`.
