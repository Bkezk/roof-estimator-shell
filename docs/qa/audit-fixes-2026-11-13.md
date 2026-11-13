# Fixes from the Nov 13 audit

Owner, on the ten findings of `audit-since-home-screen-icon-2026-11-13.md`: "3. how do we address
this? 4. fix this plz. 5. fix plz. 6. can we fix that plz. 7. thats fine as log as it reminds at
8 am. 8. fix please 9. fix plz." and, on the schedule, "should we do something about that?".

Database part: `supabase/migrations/20261113150000_audit_fixes.sql`, run on the live database on
Nov 13; the three functions match the file by hash.

## What changed

| #   | Finding                                                                                 | Fix                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | The scheduled job ran about twice a day                                                 | It now asks for minutes 7 and 37 of the hour, off GitHub's busiest moments (`.github/workflows/reminders.yml`). To be watched: see "Still open"                                                                                                                                                                                                                         |
| 3   | A second person could not turn notifications on at a device someone else had registered | `push_subscription_claim`: this browser's notifications are the signed-in person's, whoever held the row. Nothing else can move a device row to another person. Signing out already removed the device                                                                                                                                                                  |
| 4   | Undo left the opportunity Lost, Won or Quoted                                           | Undo sets the bid back to Draft and takes the opportunity back to where it stood (`undo_opportunity_from_bid`), only when that step was the same person's own, within 15 minutes, and nobody changed the opportunity since. The message says "Its opportunity is back to Open." A plain change to Draft on the Bids page still moves nothing back, as decided on Oct 12 |
| 5   | A ticket moved to today kept its old reminder day                                       | A ticket moved to today takes today's reminder even when one has gone out. A ticket moved to a past day keeps the reminder it had                                                                                                                                                                                                                                       |
| 6   | Android notification badge was a solid square                                           | A new badge picture: the logo's shape in white on a clear background (`public/jbk-badge-96.png`). The notification's own icon is unchanged                                                                                                                                                                                                                              |
| 7   | A task before 8 AM gets its notice at 8                                                 | Left as it is: the owner wants 8 AM                                                                                                                                                                                                                                                                                                                                     |
| 8   | "the next one is that morning" could be wrong                                           | The notice names the day the next reminder really comes when it is before the date                                                                                                                                                                                                                                                                                      |
| 9   | A refusal from the database was taken for "not installed"                               | Only PostgREST's own "function not found" counts now. The same loose test sat on the bid's move of its opportunity; fixed there too                                                                                                                                                                                                                                     |

## Proof

- **Tests:** `src/lib/audit-fixes-nov13h.test.ts` (23). On the old code 14 fail. Whole suite: 545
  files, 7,122 tests. Lint, types and the build are clean.
- **Local PostgreSQL 16:**
  - A ticket due in ten days with one reminder sent, then moved. Old rule: moved to today, the
    next reminder stayed four days out. New rule: due now. Moved to a past day or a later day:
    the same on both.
  - Undo in nine situations: taken back after Lost and after Submitted; a second press, another
    person, a step older than 15 minutes, an opportunity changed by hand since, a bid that is not
    Draft: nothing moves; no Estimate access or no login: refused.
  - Device: the second person's plain save is refused, the claim gives them the one row with
    their keys; they still cannot change the first person's other device; no login and blank
    details are refused.
- **Live database, inside changes that were rolled back:** the ticket moved to today came up due
  now; a technician claimed a device another person had registered (one row, now theirs); the
  Undo function refused a technician without Estimate access.
- **Browser, current code against the live database, temporary rows:** Lost then Undo: "Status:
  Draft / Its opportunity is back to Open.", the opportunity Open, its history naming the undo.
  Submitted then Undo: the same. A plain Draft on the Bids page: the opportunity stayed Quoted.
  The badge file is served and the service worker names it.

## Still open

- **The schedule.** Moving the minutes is the cheap step and is not proven yet: GitHub's runs
  over the next days will show whether it now runs twice an hour. If it does not, the database
  can do the timing itself (the `pg_cron` and `pg_net` extensions are available on this
  database), which does not depend on GitHub.
- **The badge** has not been seen on a real Android phone.
- **Publishing.** None of the code above is live until the site is published; the database part
  is live already and is safe with the older site.

## Cleanup

The temporary customer, opportunity, two bids, their timers and history lines are removed.
Nothing named "ZZ" is left. The ticket counter was not touched by these tests (6073, the last
real ticket).
