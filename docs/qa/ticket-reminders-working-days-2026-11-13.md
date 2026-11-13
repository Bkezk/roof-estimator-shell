# Ticket reminders before the date, on working days (Nov 13, 2026)

Owner, Nov 13, in order:

- "add the day before notice for tickets, also i think they would want some cadence of reminders
  as well, if a ticket is set to do a month out and is assigned then it starts reminding that
  person every 3 days or so and that can also be edited in settings."
- "give it the new meaning for untouched tickets. also dont count weekend days, that should slow
  the cadence a bit. ensure the wording and editing is similar to our previous notifications
  editing and wordings"
- "yes skip weekends on the after date reminders too"

Before this a ticket's technician heard nothing between the assignment and the morning of the
ticket's date, the repeat after the date counted calendar days, and "untouched" could only ever
be an assigned ticket with no date (there are none). Tickets only: opportunity and bid reminders
are as they were.

Chain on the final tree: prettier clean, eslint 0 errors (the 16 baseline warnings), tsc clean,
539 test files / 7,030 tests, build exit 0.

## The rules, as built

| When                 | What goes to the technician                                                                                                                                                                                                                                           | Setting (Admin › Reminders › Tickets)                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Working days         | Saturdays and Sundays are not counted, and no ticket reminder goes out on one, except on the ticket's own date. A reminder that comes due on a weekend any other way (a hold that ended, a send that failed on Friday) waits for Monday. The day is the office's day. | none                                                 |
| Before the date      | A reminder every N working days, counted from the day the technician was assigned (then from each reminder).                                                                                                                                                          | `ticket_before_every_days`, 3; blank = none          |
| The notice           | One notice N working days before the date, so a Monday ticket's goes out on Friday and says Monday. A cadence step and the notice on the same day are one reminder: the notice. A ticket assigned (or moved) on or after its notice day gets none.                    | `ticket_due_notice_days`, 1; blank = none            |
| On the date          | The reminder that morning, also when the date is a Saturday or Sunday.                                                                                                                                                                                                | none (always)                                        |
| After the date       | Every N working days until the ticket is Done; never a Saturday or Sunday.                                                                                                                                                                                            | `ticket_every_days`, 3 (the number that was there)   |
| Untouched            | The ticket's date has passed, it is still assigned and nobody has started it, for N working days: the admins and the "also tell" people hear, minus the assignee; at once, then every `ticket_every_days` working days, never on a weekend.                           | `ticket_untouched_days`, 2 (the number, new meaning) |
| A date moved         | To a day still ahead: the next reminder is worked out again from the day it was moved. To today or a past day: as before.                                                                                                                                             | none                                                 |
| A new technician     | A new timer: counted from the day they got it.                                                                                                                                                                                                                        | none                                                 |
| A hold               | As before: nothing while it runs, "Back from hold" when it ends, then the rule from that day. An untouched ticket on hold is not escalated.                                                                                                                           | none                                                 |
| Both new boxes blank | As it was before today — on the date, then every N — except that the repeat counts working days.                                                                                                                                                                      | both blank                                           |

One function decides every next reminder day, the same in the app
(`src/lib/ticket-reminders.ts`, `ticketNextRemindDay`) and in the database
(`ticket_next_remind_day`): before the date, the earliest of the cadence step, the notice day and
the date; on or after the date, N working days on. Reminder instants are 12:00 UTC of the day
(the morning in the office), as a ticket's date always was.

## The owner's example, by date

"Assigned Thu Nov 13 for Sat Dec 13, every 3" was written on the 2025 calendar (Nov 13, 2026 is a
Friday and Dec 13, 2026 a Sunday). The code gives the owner's days exactly on that calendar, and
these on this year's:

| #   | 2025 (Thu Nov 13 → Sat Dec 13) | 2026 (Fri Nov 13 → Sun Dec 13)       |
| --- | ------------------------------ | ------------------------------------ |
| 1   | Tue Nov 18                     | Wed Nov 18                           |
| 2   | Fri Nov 21                     | Mon Nov 23                           |
| 3   | Wed Nov 26                     | Thu Nov 26                           |
| 4   | Mon Dec 1                      | Tue Dec 1                            |
| 5   | Thu Dec 4                      | Fri Dec 4                            |
| 6   | Tue Dec 9                      | Wed Dec 9                            |
| 7   | Fri Dec 12, the notice         | Fri Dec 11, the notice (says Sunday) |
| 8   | Sat Dec 13, the date           | Sun Dec 13, the date                 |
| 9   | Wed Dec 17, then Mon Dec 22, … | Wed Dec 16, then Mon Dec 21, …       |

The database walked the same days on a temporary ticket (below). Holidays are not known:
Thanksgiving (Thu Nov 26) counts as a working day.

## Every notice's exact words

The ticket's own title starts "Ticket #6090 Acme — leak at the dock"; `<title>` below is that.
Every one is kind `followup` (the bell's "Reminder") or `untouched` ("Untouched"), opens the
ticket (`/service?id=…`), and falls under the person's "Service notices" switch on My account.
No new kind, and no title carries the site's name.

| Which                                          | Title                                       | Body                                                                                                         |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Before the date                                | `Follow up: <title>`                        | `due Sunday 12/13/2026. Reminder 2; it repeats every 3 working days until the date.`                         |
| Before the date, the cadence box blank         | `Follow up: <title>`                        | `due Sunday 12/13/2026. Reminder 2.`                                                                         |
| The notice                                     | `Due Monday: <title>`                       | `due Monday 12/14/2026. Reminder 8; the next one is that morning.`                                           |
| On the date                                    | `Follow up: <title>`                        | `due today. Reminder 9; after today it repeats every 3 working days until the item is finished or closed.`   |
| After the date                                 | `Follow up: <title>`                        | `3 working days overdue. Reminder 10; it repeats every 3 working days until the item is finished or closed.` |
| Untouched (to the admins and the named people) | `Untouched: <title>` (see the last section) | `Assigned to Sam Tech; due Friday 11/6/2026 and not started, 3 working days later. Limit is 2 working days.` |
| Untouched, handed over after its date          | `Untouched: <title>` (see the last section) | `Assigned to Sam Tech 1 working day ago; due Friday 11/6/2026 and not started. Limit is 1 working day.`      |
| Assigned, a reminder before the date           | `Assigned to you: <title>`                  | `Roe assigned this to you. Due Sunday 12/13/2026; first reminder Wednesday 11/18/2026.`                      |
| Assigned, nothing before the date              | `Assigned to you: <title>`                  | `Roe assigned this to you. Due Sunday 12/13/2026; the reminder comes that morning.`                          |
| Assigned for today or a past day               | `Assigned to you: <title>`                  | `Roe assigned this to you. Due Friday 11/13/2026; reminders every 3 working days until it is closed.`        |

They are siblings of the ones already there (`Follow up: <title>` / `due 12/13/2026. Reminder 2;
it repeats every 3 days until the item is finished or closed.`, and `Untouched opportunity: <title>` /
`Assigned to <name> 3 days ago; no contact logged and not started. Limit is 2 days.`), which
opportunities keep word for word. "1 working day" has no "s". "Back from hold" is unchanged.

Other new sentences on screen:

- Needs action strip: "An opportunity: assigned longer than the limit with no contact logged. A
  ticket: its date has passed and nobody has started it. Open it and log the call, text, email or
  visit, start it, or move its date."
- The red tag on a ticket: `Untouched 3d`, and on hover "Due Tuesday 11/10/2026 and nobody has
  started it, 3 working days later (limit 2 working days)".
- My account, under Service notices: "Ticket assignments, reminders, date moves, done and
  ready-to-invoice notices." (it did not mention reminders).

## Admin › Reminders: the settings and their labels

Tickets, in this order (the two new boxes sit with the ticket numbers):

- Section help: "Done, Invoiced or Closed ends the timer; taking the technician off stops the
  reminders. Saturdays and Sundays are not counted, and no ticket reminder goes out on one,
  except on the ticket's own date."
- Who is reminded / Due date: unchanged.
- **Before the date**: "Every [3] working days from the day the technician is assigned. Leave the
  box blank to never remind before the date." Box name: "Before the date, every N working days
  (blank = never)", 1 to 365.
- **Notice**: "[1] working days before the date (1 = a Monday ticket's goes out on Friday). Leave
  the box blank for no notice." Box name: "Notice N working days before a ticket's date (blank =
  never)", 1 to 30.
- **On the date**: "That morning, also on a Saturday or Sunday." (was "First reminder: On the due
  date.")
- **After that**: "Every [3] working days until the ticket is Done." Box name: "After the date,
  every N working days".

Untouched work:

- Help: "An opportunity: assigned, with no contact logged. A ticket: its date has passed, it is
  still assigned and nobody has started it. Past the limit it turns red in the lists; the
  assignee is reminded as above, and the people below are told as well — right away, then again
  at the ticket's or opportunity's "After that" interval above — until it is started or a contact
  is logged."
- **Counts as untouched**: "A ticket [2] working days after its date, when it is still assigned
  and nobody has started it; an opportunity after [3] days with no contact logged." Box name:
  "Ticket counts as untouched N working days after its date, when nobody has started it".

The card's description gained "a ticket's "Before the date" and "Notice" numbers apply from its
next reminder" (they are read when each reminder goes, not copied onto the timer).

The two boxes are the same blank-or-number box as the bids' "Then every N days while a draft is
past due": blank shows nothing and saves "off", no 0 stands in. A bad number is refused the way
that box refuses it — by the box itself, in the browser's words ("Value must be greater than or
equal to 1.", "Value must be less than or equal to 365." / "… 30."), and nothing is saved; the
page's "Check the numbers: … must be a whole number from 1 to 365" and the server's own check
stand behind it. 2.5 is rounded to 3, as in the bids' box. The same Save, the same "Reminder
settings saved". This page writes no History line for any of its settings, so these write none.

## What "untouched" means now, for a ticket

A ticket is untouched when all of these hold: not deleted; still assigned; its date has passed
(the office's day); "nobody has started it" — it is still Open or Scheduled, has no field status
(nobody is headed there or checked in), and no time is clocked on it; no contact has been logged
on or after its date; and `ticket_untouched_days` working days have gone by since the date (or
since the day it was assigned, when that is later).

`crm_untouched()` returns a ticket only once it is past the limit, so every ticket row is a red
one. The opportunity half is unchanged, character for character. The whole diff of the function:

```diff
      and j.technician_id is not null
-     and j.stage = 'open' and j.scheduled_date is null and j.field_status is null
-     and j.contacted_at is null
+     and j.stage in ('open', 'scheduled') and j.field_status is null
+     and j.scheduled_date < public.office_day(now())
+     and not exists (select 1 from public.service_time_entries e where e.service_job_id = j.id)
+     and (j.contacted_at is null or public.office_day(j.contacted_at) < j.scheduled_date)
+     and public.working_days_between(
+           greatest(j.scheduled_date, public.office_day(j.assigned_at)),
+           public.office_day(now())) >= s.t
      and (who.svc or who.cust
```

Its execute right for signed-out visitors (anon) was revoked; it returned them nothing anyway.

Every reader of `crm_untouched()`:

| Reader                                      | What it does now                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reminder pass (`escalateUntouched`)     | A ticket row is past its limit already; repeat in working days, nothing on a weekend, the new words; the hold skip and the claim (two passes escalate once) as before. Opportunities as before. |
| Service: the Needs action strip and the tag | The strip says both meanings; a ticket's tag is red with the working days it is late (`listUntouched` adds the ticket's date and that count to each ticket row).                                |
| Opportunities: strip and tag                | Unchanged.                                                                                                                                                                                      |
| Owner view › Business                       | "N tickets untouched past Setup's limit" counts the rows, which for tickets are now exactly the ones past the limit. (The opportunity count still includes ones inside their limit, as before.) |
| Admin › Reminders                           | The label and the help say the new meaning (above).                                                                                                                                             |

## Decisions taken on judgment

1. **The notice is a "Reminder", not a new kind.** The per-person switches on My account are by
   category (Service notices, Bid notices…), not by kind — "Bid due" cannot be switched off by
   itself either — so a new kind would add nothing to switch. Its title is its own ("Due Monday:
   …"), not "Ticket due Monday: Ticket #…".
2. **A contact logged on or after the ticket's date takes it off the untouched list; one logged
   before the date does not.** "Nobody has started it" alone would have left the one-tap contact
   log, and the strip's "log the call…", with no effect on a ticket.
3. **Handed over after its date, the working days count from the hand-over**, so the new
   technician gets the whole limit before the admins hear.
4. **The untouched escalation is also held on weekends** (the first one and the repeats), as the
   reminders are. Opportunity escalations still go on any day.
5. **The assignment notice changed for tickets** ("first reminder Wednesday 11/18/2026" instead of
   "reminders every 3 days until it is closed"), because the old sentence was no longer true.
6. **The two new numbers are read when each reminder goes**, not stored on the timer: blanking a
   box stops that kind of reminder for running timers too, from each one's next reminder.
7. **A ticket's date moved to a day still ahead always restarts the rule** (before, a timer that
   had already reminded kept its old next reminder, so a ticket pushed a month out went on being
   reminded every 3 days as if overdue).
8. **A date that is today or past at assignment is reminded at once, as before**; on a weekend
   that one waits for Monday unless the day is the ticket's date.
9. **Existing timers** (below): a day already past becomes the next working morning — which was
   still this morning, Fri Nov 13, when the change landed at about 1 am in the office.
10. **Day names in the words.** "Sunday 12/13/2026": the weekday, then the date as the reminders
    already wrote it.

## What is live already, and what waits for a publish

The database change is applied (migration `20261113120000_ticket_reminders_working_days.sql`,
statement by statement; all nine functions on the live database match the file's text by
hash). The published site runs the code from before this commit until the owner publishes.
With the database change alone:

- **The days are already the new ones.** A new ticket's first reminder, and the next reminder
  after every one sent, are set by the database (the sync function, and a trigger that fires on
  every claim of a ticket's reminder, whoever makes it). Proven with the published site's own
  pass, below.
- **The words are still the old ones** until the publish: "due 12/14/2026. Reminder 1; it repeats
  every 3 days until the item is finished or closed.", "2 days overdue. …", the old assignment
  sentence, the old Reminders page (it does not show the two new boxes; its Save leaves them
  alone), and the old escalation sentence ("Assigned to … N days ago; no contact logged and not
  started").
- **Untouched tickets already follow the new meaning** (the function decides). Until the publish
  the old code repeats that escalation in calendar days and may send it on a weekend, and grades
  the tag by days since assignment.
- **No double send, no loop.** A claim is one conditional update; the trigger only replaces the
  next-reminder day it writes, always with a later day. One difference while the old code is
  live: if a ticket reminder's send fails, the old code cannot put it back for a retry (it looks
  for the day it wrote itself), so that one reminder is skipped and the next one goes on its
  rule day. The new code puts back exactly the row the database answered.
- **Not on weekends**: the days the database sets are never a weekend (except the ticket's date);
  the "wait for Monday" rule for a reminder that comes due on a weekend some other way is in the
  new code.

### The three open ticket timers

Three open timers had a date still ahead; each got its next reminder by the rule:

| Ticket's date | Next reminder before | Next reminder now                          |
| ------------- | -------------------- | ------------------------------------------ |
| Sun Nov 15    | Sun Nov 15           | Fri Nov 13 (the notice day for Sunday)     |
| Wed Nov 18    | Wed Nov 18           | Fri Nov 13 (3 working days after assigned) |
| Tue Nov 24    | Tue Nov 24           | Tue Nov 17 (3 working days after assigned) |

So two real technicians get a reminder this morning (Fri Nov 13, about 7 am), in the old words
until the publish; then Sunday's ticket on Sunday, Wednesday's on Tue Nov 17 (the notice) and
Wed Nov 18, and so on. No timer was past its date or on hold. Nothing was sent at the moment of
the change.

## Proof

### Tests (all named `*-nov13b.test.ts`)

- `src/lib/working-days-nov13b.test.ts` (65): the working-day maths, and one table
  (`src/test/working-day-cases.ts`) whose answers are what the database's functions returned,
  held against the TypeScript — across a weekend, a month and a year boundary, a leap day and
  both changes of clocks; the migration's zone is the office's (`TASK_TZ`).
- `src/lib/ticket-reminders-nov13b.test.ts` (66): the owner's example by date on both calendars;
  assigned the day before; on a Friday for Monday; a date on a Saturday and a Sunday; a date
  moved earlier and later; reassigned; snoozed; cadence off; notice off; both off; the 19 walked
  chains the database gave; every notice's words; the untouched rule; the migration's text,
  including the opportunity half of `crm_untouched()` compared character for character with the
  Sep 28 one.
- `src/lib/ticket-reminder-pass-nov13b.test.ts` (15): the real pass on a fixed clock, a ticket
  walked from Nov 13 to Dec 22 (which words, which next day), the weekend wait, a Saturday date,
  a failed send put back, the claim through the database function, two passes at once, an
  opportunity reminded word for word as before, and the escalation for both kinds.
- `src/components/reminders-settings-nov13b.test.ts` (18): the save's validation, the page's two
  boxes and lines, the tags, the bell's kind and switch.
- Older tests that pinned what changed on purpose were moved onto it:
  `untouched-escalation.test.ts` (the scenario on the new meaning), `reminder-pass.test.ts`,
  `reminder-retry.test.ts`, `followup-holds.test.ts` (a fixed working day; a ticket's date),
  `reminders-page-layout.test.ts` and `notice-categories.test.ts` (the words), and the in-memory
  claim in `src/test/claim-reminder.ts` (it applies the trigger's rule).
- Prove-fail: with the wiring files stashed and the new modules kept, 32 tests failed across six
  files; with it back, all pass.

The table's SQL side was one query of this shape, run on the live database on Nov 13:

```sql
select 'add', jsonb_agg(public.add_working_days(d::date, n)::text order by i) from (values …) t(i, d, n)
union all select 'before',  jsonb_agg(public.working_days_before(d::date, n)::text order by i) from …
union all select 'between', jsonb_agg(public.working_days_between(a::date, b::date) order by i) from …
union all select 'office',  jsonb_agg(public.office_day(a::timestamptz)::text order by i) from …
union all select 'rule', … -- a recursive walk: each ticket_next_remind_day answer is the next "from"
```

### Live, on temporary rows ("ZZ Rm …", assigned to the Claude profile only)

- **A month out, in the database, rolled back** (one block that ends by raising, so nothing
  stays): a ticket dated Sun Dec 13 assigned Fri Nov 13 got its first reminder Wed Nov 18; ten
  claims, each made the way the scheduled job makes one, set Nov 23, Nov 26, Dec 1, Dec 4, Dec 9,
  Dec 11 (Friday, the notice), Dec 13 (Sunday, the date), Dec 16, Dec 21, Dec 24. An unclaim was
  left alone. The date moved to Jan 20 after nine reminders: next Nov 18. Moved to Mon Nov 16 on
  a Friday: next Nov 16, no notice. An opportunity timer's claim: + 7 calendar days, untouched by
  the trigger.
- **Untouched, in the database, rolled back**: eleven tickets read as the scheduled job reads
  them. Returned: two working days past its date; a contact from before the date; a week past and
  still Open. Not returned: one working day past; headed there; time clocked; a contact after the
  date; assigned today; a date ahead; Done; nobody on it. The opportunity rows were identical to
  the old rule's (compared as data). Signed out: no rows. The recipients function named five
  people including Claude; nothing was sent to any of them.
- **The published site's own pass** (the code from before this commit, against the changed
  database): with a month-out ticket made due by hand and a past-date one, signing in to the
  published site ran its page-load pass. Each reminder went once, to Claude, in the old words
  ("Follow up: #990001 ZZ Rm month out — temp row, reminders test" with "due 12/14/2026.
  Reminder 1; it repeats every 3 days until the item is finished or closed.", and the other
  with "2 days overdue. Reminder 1; …"), and the database set both next reminders to Wed Nov 18
  — three working days on, where the old code alone would have written Mon Nov 16. No escalation went out: for those
  minutes "also tell" was set to Claude alone with the admins switch off, then put back.
- **The new words for those same rows**, printed by the real functions (no rows written): the
  table above, with reminders on Nov 18, 23, 26, Dec 1, 4, 9, the notice Fri Dec 11 ("Due
  Monday: …"), the date Mon Dec 14, then Dec 17.
- **Email**: not set up, here or on the published site (its pass recorded "Email is not set up
  yet: the RESEND_API_KEY secret is missing" on both notices), so no email left for anyone. The
  Claude profile has no phone registered for push.

### Browser, on the working tree (local server, the Claude login)

- Admin › Reminders at 1440 px and 390 px: the two boxes show 3 and 1; cleared and saved, they
  come back blank; 5 and 2 saved and reloaded; 0, 366, 31 refused with nothing saved; back to 3
  and 1. At 390 px the page is 390 wide (no sideways scroll) and both boxes are on screen.
- Service: the Needs action strip with the new sentence and the temporary ticket, `Untouched 3d`
  on its card and in the strip, with the hover text above. Owner view › Business: "1 tickets
  untouched past Setup's limit".
- The bell: both reminders listed; opening one landed on its ticket (`/service?id=…`).
- The local server's own page-load pass was kept from running (the ten-minute throttle stamp was
  refreshed before each run), so it claimed nothing.

## Not proven, and why

- **The new words written into the live notifications table by the new pass.** The database
  refuses a person claiming their own reminder (only the scheduled job, or another office user's
  pass, sends it), the temporary tickets had to be assigned to the Claude login, and the local
  server has no server key — so the new pass, run as Claude, cannot send Claude's reminders. The
  new words are proven by the real pass in the tests and by the real functions over the live
  rows; the live claim and next-day side is proven by the published pass and the rolled-back
  walk.
- **A real escalation notice.** Deliberately never sent: the rule and the recipients were read
  from the database, the words from the tests.
- **A phone's own validation bubble** (the refusal text is the browser's; Chromium's is quoted).

## Limits

- Holidays are working days.
- The reminder pass reads the two new numbers as the scheduled job (always) or an admin or
  manager can; an office user's pass on the preview, which cannot read the settings row, words
  the reminder with the defaults (3 and 1). The days are right either way: the database sets them.
- An overdue timer made before today whose next reminder was already set to a weekend day would
  still go that day under the old code; there was none.
- Rolled-back test rows used up a few sequence numbers (History ids); the time-entry sequence was
  put back. Ticket numbers were not touched (the next real ticket is still #6083).

## Rights checked

`has_function_privilege` after the change: the six helpers (`office_day`, `add_working_days`,
`working_days_before`, `working_days_between`, `ticket_next_remind_day`,
`ticket_next_remind_at`) and the trigger function — anon no, authenticated no (only the database's
own functions call them); `followup_sync_upsert` and `crm_untouched` — anon no, authenticated yes,
as the app needs. No new table or view. The two new columns are on `crm_settings`, under that
table's existing row rules (read: admin or manager; write: admin).

What was replaced is saved beside the session's working files (`before-crm_untouched.sql`,
`before-followup_sync_upsert.live.sql`, both matching the live text by hash before the change).

## Cleanup

Every temporary row is gone with its children: tickets, timers, notices, ticket events, History
rows. Counts as before: 51 tickets, 33 bids, 6 opportunities, 27 contact-log rows, 57 follow-ups,
638 customers, 197 notices, 3,474 History rows; the Claude login's unread count is 5 as it was.
`crm_settings` is the snapshot again (escalate to admins on, no named people, `updated_at`
2026-09-27 03:23:51.733077+00) plus the two new numbers at 3 and 1. The three real timers are as
the table above leaves them.

## Later the same day: the morning is 8 AM Eastern, all year

Owner, Nov 13: "lets do 8AM est instead of 7 am plz".

"The morning" was written as 12:00 UTC of the day, which is 8 AM Eastern in summer but 7 AM in
winter. It is now 8:00 on the office's clock (America/New_York) whatever the season: one helper
in the database, `reminder_morning(day)`, and its twin in the app, `reminderMorning`
(`src/lib/working-days.ts`).

| Day                                            | The morning, in UTC |
| ---------------------------------------------- | ------------------- |
| A winter day (Nov 13, 2026)                    | 13:00               |
| A summer day (Jul 15, 2026)                    | 12:00               |
| Sat Oct 31, 2026 (the day before clocks back)  | 12:00               |
| Sun Nov 1, 2026 (clocks go back)               | 13:00               |
| Sat Mar 13, 2027 (the day before clocks ahead) | 13:00               |
| Sun Mar 14, 2027 (clocks go forward)           | 12:00               |

Both sides give these (the test table in `reminder-morning-nov13c.test.ts` holds the app to the
database's answers).

What uses it:

- **A ticket's reminders** (the cadence, the notice, the date, after the date): every instant the
  rule sets (`ticket_next_remind_at`, `ticketNextRemindAt`).
- **A dated follow-up's due instant** (`followup_sync_upsert`, and the app's own direct write):
  the morning of its date.
- A hold already ended at 8:00 Eastern (`hold_followup`); nothing to change there.

**Opportunities** share the due instant, so an opportunity's follow-up is now due at 8:00 Eastern
on its expected close date instead of 12:00 UTC (an hour later in winter, the same in summer).
What that changes for them: when the first reminder is capped by the due date ("or on the due
date if that comes first") it goes at 8:00 instead of 7:00 in winter, and the pass's "N days
overdue" count turns over at 8:00. Their first reminder otherwise (N days after the assignment,
at the time of day it was assigned) and their repeat (every N days from the last one) are
untouched.

**The day never moves.** Every reader of the due instant takes its day in the office's zone
(`officeDay`), the viewer's zone (`toYmd`, `whenDay`) or prints the date; 8:00 Eastern is the
same calendar day in the office, in UTC, and in every US zone (a test walks two years of days).
The database's "date moved" check compares the stored instant with the new one, so the open
follow-ups are moved with the functions (below); otherwise the next save of any ticket would
have read as a moved date, cleared a hold and restarted its reminders.

**Wording.** Nothing prints a clock time; "that morning" stays. Admin › Reminders has one new
line at the end of Tickets: **Time of day** — "Ticket reminders go out at 8 AM Eastern."

**The schedule** (`.github/workflows/reminders.yml`) is unchanged: every 30 minutes from 12:00 to
23:30 UTC, which is 8:00 AM to 7:30 PM Eastern in summer and 7:00 AM to 6:30 PM in winter (its
comment said "8am–7pm Eastern" for both; it now says this). The first scheduled pass after 8 AM
Eastern is the 12:00 UTC one in summer (8:00 AM) and the 13:00 UTC one in winter (8:00 AM; the
12:00 and 12:30 UTC passes are 7:00 and 7:30 there and find the morning's reminders not yet due).
An office user opening the site also runs a pass, at most every ten minutes.

### The database: written, not applied

The database connection was down for this change, so **nothing has been applied**. The new
migration is `supabase/migrations/20261113130000_reminder_morning_8am.sql` (the applied one is
not edited): the helper; `ticket_next_remind_at` and `followup_sync_upsert` re-created with their
one "12:00 UTC" line calling it (a test shows nothing else in them differs); and the open
follow-ups moved — a `due_at` exactly at 12:00:00 UTC of its day becomes that day's morning, and
so does a `next_remind_at` exactly at 12:00:00 UTC that is still ahead. A reminder that is due
and not yet sent is left as it is, so it stays due. Closed follow-ups, holds, the review timers
and summer dates are untouched. Run twice, the second run changes nothing.

The statements to run, one per block and in order, with the checks after them, are in the
session's working files as `apply-8am.sql`. Until they are run the live database keeps writing
12:00 UTC (7 AM Eastern in winter), whichever code is published: the database sets the instants.

Checked without the live database: the migration file, and then the statements file, were run
on a throwaway PostgreSQL 16 loaded with the applied migration and eleven sample timers. The
helper gave the table above; a ticket a month out was due at 13:00 UTC with reminders at 13:00
UTC on Nov 18, 23, 26, Dec 1, 4, 9, 11, the date, Dec 17; saving the same ticket again was "not
moved" and a hold stayed; an opportunity's due instant was 13:00 UTC and its first reminder
still three days from now; the sample rows moved as described, and a second run moved none.

The three real open timers could not be read. As this morning's change left them, and what the
statements will make of them:

| Ticket's date | Due instant now → after | Next reminder → after                                               |
| ------------- | ----------------------- | ------------------------------------------------------------------- |
| Sun Nov 15    | 12:00 UTC → 13:00 UTC   | Was Fri Nov 13 12:00 UTC. If sent: now Sun Nov 15 12:00 → 13:00 UTC |
| Wed Nov 18    | 12:00 UTC → 13:00 UTC   | Was Fri Nov 13 12:00 UTC. If sent: now Tue Nov 17 12:00 → 13:00 UTC |
| Tue Nov 24    | 12:00 UTC → 13:00 UTC   | Tue Nov 17 12:00 → 13:00 UTC                                        |

This was written at 13:30 UTC, after the two Nov 13 reminders came due at 12:00 UTC (7:00 AM
Eastern, under the rule then live); what was sent is left alone, and one not yet sent stays due.

### Task notices and "Bid due" notices (read from the code, nothing changed)

- **Task notices** (`tasks-notify.server.ts`, the rule in `tasks.ts`): "due today" goes on the
  first pass at or after **7:00 AM Eastern** on the task's day (`MORNING_HOUR = 7`), and "overdue"
  on the first pass at or after 7:00 AM the next day. So yes, they can arrive before 8 AM: in
  winter the 12:00 UTC scheduled pass is exactly 7:00 AM Eastern; in summer the first scheduled
  pass is 8:00 AM, but an office user opening the site between 7 and 8 sends them then. "New
  task" goes on the first pass after the task is saved, at any hour.
- **"Bid due", "Bid past due" and "Bid reminder"** (`bids-notify.server.ts`): they have no hour
  at all. Each is due as soon as the office's calendar day reaches its day, so it goes on the
  first pass after midnight Eastern: the 7:00 AM scheduled pass in winter, the 8:00 AM one in
  summer, or earlier whenever an office user opens the site (a pass ran at 1 AM Eastern today
  that way).

Both would need their own change to wait for 8 AM.

### Proof for this change

- `src/lib/reminder-morning-nov13c.test.ts` (32, with the titles below): the table of mornings; 8:00 on the wall and the
  same day for every day of two years; ticket reminders at 13:00 UTC in winter and 12:00 UTC in
  summer and across the change of clocks; not due on the 7:00 and 7:30 winter passes; no clock
  time in any notice; the migration's text (the helper, the two one-line changes and nothing
  else, the move step, the applied migration untouched); the page's line; the schedule and its
  comment.
- The two `*-nov13b` test files that pinned 12:00 UTC now use the helper's answer. No older test
  pinned a winter 12:00 UTC morning (their dates are in October, where 12:00 UTC is 8 AM).
- Prove-fail: with the wiring stashed, 37 tests failed across six files (with the titles below).
- Not proven: anything on the live database (not reachable), and so the three real timers'
  instants after the change.

## Later the same day: a ticket notice says "Ticket" once

Owner, Nov 13: "yes please update the wording so it doesnt double say ticket. i almost want a bit
of nagging so thats fine on the reminder count".

A ticket's own title starts "Ticket #6090 Acme Supply — …", and two lead-ins said the word again.
The reminder count ("Reminder 7") stays in every reminder.

Changed (old → new):

| Notice                              | Old title                                | New title                          |
| ----------------------------------- | ---------------------------------------- | ---------------------------------- |
| A ticket assigned to a technician   | `Ticket assigned to you: Ticket #6090 …` | `Assigned to you: Ticket #6090 …`  |
| A ticket opened again (Done → open) | `Ticket reopened: Ticket #6090 …`        | `Reopened: Ticket #6090 …`         |
| An untouched ticket, to the admins  | `Untouched ticket: #6090 Acme — …`       | `Untouched: Ticket #6090 Acme — …` |

The third did not say the word twice (the untouched list titles a ticket from its number); it was
given the same shape as the others, as asked. Bodies are unchanged.

Checked and left, because each says "Ticket" once already:

- Reminders: `Follow up: Ticket #6090 …`, and the notice `Due Monday: Ticket #6090 …`.
- A hold ending: `Back from hold: Ticket #6090 …`.
- Done and authorized: `Ticket #6090 … is done — ready for your review`, `Ticket #6090 …
authorized — ready to invoice`, `Authorize Ticket #6090 … — ready for your review`.
- Reassigned: `Ticket #6090 was reassigned` / "… reassigned Ticket #6090 … to …. It is off your
  list." Date moved: `Ticket #6090 moved to <day>` / "… moved Ticket #6090 … to <day>."
- A mention: `<name> mentioned you on Ticket #6090 …`.
- The Needs action strip and the tags print the ticket's title as it is, with no lead-in.
- Opportunities (`Opportunity assigned to you: <title>`, `Opportunity reopened: <title>`,
  `Untouched opportunity: <title>`): an opportunity's title is its own words, so nothing is said
  twice. Bids, tasks and the review timer: the same; left as they were.

Tests: the new titles are pinned in `reminder-morning-nov13c.test.ts` (each title a ticket's
person can get says the word exactly once; the old strings fail), and in the older tests that
pinned the old ones (`authorized-wording.test.ts`, `work-overview-oct21-audit8-data.test.ts`,
`untouched-escalation.test.ts`, the two `*-nov13b` files). These are in the app's code, so they
show after the next publish.

Chain on the final tree for both changes: prettier clean, eslint 0 errors (the 16 baseline
warnings), tsc clean, 540 test files / 7,063 tests, build exit 0.

## Task and bid notices also wait for 8 AM Eastern (Nov 13, later)

Owner: "yes plz move those to 8 am".

Before:

- Task "due today" went on the first pass at or after 7:00 AM Eastern, and "overdue" at 7:00 AM
  the next day (`MORNING_HOUR = 7` in `src/lib/tasks.ts`).
- "Bid due", "Bid past due" and "Bid reminder" had no hour. Each was due from midnight Eastern
  of its day, so it went on the first pass after that: the 7:00 AM scheduled run in winter, the
  8:00 AM one in summer, or earlier when an office user opened the site.

Now:

- `MORNING_HOUR = 8`. Task "due today" and "overdue" go on the first pass at or after 8:00 AM
  Eastern. "New task" still goes at once, at any hour: it is the assignment itself.
- `dispatchBidDueNotices` does nothing before 8:00 on the office's clock
  (`working-days.ts morningReached`). It reads nothing and stamps nothing, so the 8:00 pass
  sends what is due.
- Admin › Reminders › Bids has a line: "Time of day: Bid reminders go out at 8 AM Eastern."

No database change is needed for this part: both rules live in the app's code.

Tests: `src/lib/task-and-bid-notices-8am-nov13d.test.ts` (9), and the three 7:00 tests in
`src/lib/tasks.test.ts` moved to 8:00. On the old code 8 of them fail.

## The 8 AM change on the live database (Nov 13, about 15:25 UTC)

The connection came back and `20261113130000_reminder_morning_8am.sql` was run, block by block.

- Before: `ticket_next_remind_at` and `followup_sync_upsert` matched the applied migration by
  hash.
- After: the three functions match the file by hash, with the rights the file states.
  `reminder_morning` gives 13:00 UTC for Nov 13, Nov 1 and Mar 13, and 12:00 UTC for Jul 15,
  Oct 31 and Mar 14.
- The three open ticket timers now read 8:00 AM Eastern: due Sun Nov 15, Wed Nov 18 and Tue
  Nov 24, with next reminders Sun Nov 15, Tue Nov 17 and Tue Nov 17. One open opportunity's due
  instant moved to 8:00 AM as well. Nothing open is left at 12:00 UTC.
- The two reminders that were due at 12:00 UTC on Nov 13 had gone out at 12:19 UTC, 7:19 AM
  Eastern, under the old timing.
