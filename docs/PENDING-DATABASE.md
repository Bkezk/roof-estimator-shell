# Database changes waiting to be run on the live database

Read this first in any new session. This project's migrations are **applied by hand**: writing a
file under `supabase/migrations/` does not change the live database. Each one is run through the
Lovable database tool (`query_database`, one statement per call) and then checked.

On Nov 13, 2026 the Lovable connection was down, so the two changes below are in the repo and
tested on a local PostgreSQL, but **not on the live database**. When both are applied and
checked, delete this file, the `docs/pending-database/` folder and the pointer in `AGENTS.md`.

## 1. Ticket reminders at 8 AM Eastern

- File: `supabase/migrations/20261113130000_reminder_morning_8am.sql`
- Steps with before and after checks and the expected function hashes:
  `docs/pending-database/apply-8am.sql`. Run each block as one statement, in order. Stop if a
  "before" hash does not match: something else changed the function.
- Until it is run, ticket reminders go out at 12:00 UTC (7 AM Eastern in winter).
- After it: tell the owner it is live, and whether the two reminders that were due at 12:00 UTC on
  Nov 13 went out (the after-check shows it).
- Record: `docs/qa/ticket-reminders-working-days-2026-11-13.md`

## 2. Service settings read rule and the push device stamp

- File: `supabase/migrations/20261113140000_service_settings_read_and_push_mark.sql`
- Before running it, list the live rules that let everyone through and compare with the record
  (eleven tables are expected):

  ```sql
  select tablename, policyname, cmd, qual, with_check
    from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
   order by 1, 2;
  ```

- Run the file's statements in order (two for the policy, then the function, its rights, its
  comment, then the last `drop policy`).
- Check afterward by impersonating a technician, an office user, an invoicer and a manager
  (`set local role authenticated` and `request.jwt.claims` inside a transaction that is rolled
  back): only an admin, a manager and an invoicer read `service_settings`; nobody updates
  another person's `push_subscriptions` row; `push_subscription_mark` changes only
  `last_used_at` and `failed_at`.
- After it: Lovable's security check should list nine tables, not eleven. Those nine are open on
  purpose.
- Record: `docs/qa/security-open-rules-2026-11-13.md`

## Rules that still apply

- Never delete or truncate a table. Never edit a real bid or ticket.
- Publishing is the owner's step in Lovable. Either order of publish and database change is safe
  for both items.
