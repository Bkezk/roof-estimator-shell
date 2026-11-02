# Work Overview audit — Nov 2, 2026

Read-only audit of the Work Overview page (`/my-work`) at main `debd8ca`, the commit the
published app runs (Lovable `latest_commit_sha` checked the same morning). Nothing on the page was
changed. Every finding below carries its proof; the fixes are proposals, not applied — the owner
decides which to take.

## What was audited

| Part                                                                                                                                                                                                                                                                          | Files                                                                                                                                                                                                                                                                                                                                              | How                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| The route and its URL rules (`?view`, `?who`, `?bucket`, `?month`, the old `?view=owner` link)                                                                                                                                                                                | `src/routes/my-work.tsx`, `src/lib/my-work.ts`                                                                                                                                                                                                                                                                                                     | read end to end                                               |
| The page: List (columns, drag to reorder, X / Hidden chips, Empty chips, phone tabs, ⓘ help), Calendar (month grid, day list, Unassigned pane, drops), toolbar (New task / ticket / opportunity, List ↔ Calendar, Show kinds, Show person), the 5-minute refresh, error lines | `src/components/my-work-page.tsx` (1,647 lines)                                                                                                                                                                                                                                                                                                    | read end to end                                               |
| The server function: every query, every scope, the RLS it runs under, the roster, the queues                                                                                                                                                                                  | `src/lib/my-work.functions.ts`                                                                                                                                                                                                                                                                                                                     | read end to end, then run on the live rows (below)            |
| The pure rules: scoping, merge, buckets, calendar, layout, remembered view / person                                                                                                                                                                                           | `src/lib/my-work.ts`, `src/lib/work-layout.ts`, `src/lib/work-layout.functions.ts`                                                                                                                                                                                                                                                                 | read end to end, run on the live rows                         |
| Row actions: open task in place, Done tick, Claim, Assign to…, calendar drag (ticket / task), assign-for-a-day dialog, Snooze                                                                                                                                                 | `src/lib/my-work-actions.ts`, `src/components/my-work-actions.tsx`, `assignServiceJob` / `claimServiceJob`, `claimTask` / `moveTaskDate` / `assignTask` / `setTaskStatus` / `getTask`, `claimOpportunity` / `assignOpportunity`, `snoozeFollowup` / `hold_followup`                                                                                | read; guards compared with the database policies and triggers |
| The database side                                                                                                                                                                                                                                                             | `pg_policies` on service_jobs, tasks, crm_followups, crm_opportunities, bids, profiles, buildings, crm_accounts, crm_settings; the functions `work_people`, `technician_options`, `ticket_authorizers`, `unassigned_overdue_days`, `set_my_work_layout`, `hold_followup`, `can_claim`, `is_technician`, `has_access`; the triggers on those tables | read from the live database                                   |

## What passed

| Check                                                                                                                                                                                  | Result                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx tsc --noEmit -p .`                                                                                                                                                               | 0 errors                                                                                                                                                                     |
| `bunx eslint` on the eight Work Overview source files                                                                                                                                  | 0 errors, 0 warnings                                                                                                                                                         |
| `bunx vitest run` — the 49 Work Overview test files (`my-work*`, `work-*`, `owner-*`, `tasks*`, `followup*`, `claim-work`, `managers-authorize`, `bid-due-date`, `authorizer-once`, …) | 49 files, 775 tests, all pass                                                                                                                                                |
| Full suite at this commit (run earlier today, unchanged code)                                                                                                                          | 462 files, 5,966 tests, all pass                                                                                                                                             |
| Every column, function and trigger the page reads                                                                                                                                      | present in the live database (information_schema / pg_proc / pg_trigger)                                                                                                     |
| Row security, probed as each of the 8 users in a read-only transaction (`set local role authenticated` + the user's JWT claims)                                                        | matches the policies the code assumes — see the table below                                                                                                                  |
| The real `listMyWork` handler and the page's rules, run over a dump of the live rows for each of the 8 users and each scope the page offers (12 runs)                                  | no duplicate rows, no row left out of every column, every ticket / follow-up / bid / opportunity lands where its rule says; the per-user result is in the table further down |
| Everyone-scope roster (`work_people()`)                                                                                                                                                | 8 people for an admin and a manager; empty for a plain user (the page never asks for it then); `technician_options()` answers 8 for anyone with Service                      |
| `ticket_authorizers()`                                                                                                                                                                 | Brandon first (the named authorizer, `service_settings.authorizer_id`), then Braden, RoAnna, Garry                                                                           |
| `unassigned_overdue_days()`                                                                                                                                                            | 1 (Admin › Reminders)                                                                                                                                                        |
| The TooltipProvider the ⓘ buttons need                                                                                                                                                 | over every page in `src/routes/__root.tsx`                                                                                                                                   |

### Row security as each user actually reads it (live, read-only)

| User                                | Role                                                                                        | Live tickets readable           | Open follow-ups readable                        | Draft bids readable                             | Profiles readable                             | `can_claim()`            |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------ |
| Braden, Brandon                     | admin, ticked Technician                                                                    | all 12                          | all 7                                           | all 18                                          | 8                                             | true                     |
| Garry (ticked), RoAnna (not ticked) | manager                                                                                     | all 12                          | all 7                                           | all 18                                          | own only (names come through `work_people()`) | Garry true, RoAnna false |
| Brian, Mark, Test office            | user with Estimate / Customers / Service / Invoices / Prospect / Takeoff, ticked Technician | all 12                          | all 7 (the server then keeps only their own: 0) | all 18 (the server keeps the ones they started) | own only                                      | true                     |
| Test tech                           | user, Service only, ticked Technician (technician-only)                                     | own 2 (#6029, #6035, both Done) | 0                                               | 0                                               | own only                                      | false                    |

The server's own scoping sits on top of this (`visibleUserIds`): a plain user's `?who` is ignored,
so Brian asking for `?who=all` still gets his own rows only — confirmed in the runs below.

## What each person's Work Overview shows today (the live rows, Nov 2)

Live data on Nov 2: 1 Scheduled ticket (#6031, Brandon, Nov 15), 5 Done tickets waiting to be
authorized (#6029, #6035, #6036, #6039, #6040; #6039 has no technician), 3 Authorized tickets
waiting to be invoiced (#6024 since Oct 14, #6026 since Oct 14, #6038 since Oct 26), 0 Open
tickets, 0 unassigned Open / Scheduled tickets, 0 tasks at all, 1 open opportunity (Braden's,
expected close Oct 15, its follow-up overdue since then), 18 draft bids (4 with a due date — Oct
26, 27, 30, 30, all Brian's, all past — 14 undated), 7 open follow-ups (5 "Authorize ticket"
timers on Brandon, the named authorizer; 1 ticket timer on #6031; 1 opportunity timer).

| User                               | Show                  | Columns with items                                                                         | Empty chips                                    | Hidden (their own X)                |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------- |
| Braden (admin)                     | Everyone              | Overdue 5 (the opportunity + 4 bids) · Needs authorization 5 · Authorized — to invoice 3   | Unassigned, This week, Waiting                 | Later (15: #6031 + 14 undated bids) |
| Braden                             | Mine                  | Overdue 1 (the opportunity) · Needs authorization 5 · Authorized — to invoice 3            | Unassigned, This week, Waiting                 | Later (9: his 9 undated bids)       |
| Brandon (admin)                    | Everyone              | Overdue 5 · Later 15 · Needs authorization 5 · Authorized — to invoice 3                   | Unassigned, This week, Waiting                 | —                                   |
| Brandon                            | Mine                  | Later 1 (#6031) · Needs authorization 5 (his Authorize timers) · Authorized — to invoice 3 | Unassigned, Overdue, This week, Waiting        | —                                   |
| Garry (manager)                    | Everyone              | Overdue 5 · Later 15 · Needs authorization 5 · Authorized — to invoice 3                   | Unassigned, This week, Waiting                 | —                                   |
| Garry                              | Mine                  | Later 1 (his undated bid) · Needs authorization 5 · Authorized — to invoice 3              | Unassigned, Overdue, This week, Waiting        | —                                   |
| RoAnna (manager)                   | Everyone              | Overdue 5 · Needs authorization 5 · Authorized — to invoice 3                              | Unassigned, This week, Waiting                 | Later (15)                          |
| RoAnna                             | Mine                  | Needs authorization 5 · Authorized — to invoice 3                                          | Overdue, Unassigned, This week, Waiting        | Later (0)                           |
| Brian (user, invoices)             | Mine (the only scope) | Overdue 4 (his dated bids) · Later 4 (his undated bids) · Authorized — to invoice 3        | Unassigned, This week, Waiting                 | —                                   |
| Mark, Test office (user, invoices) | Mine                  | Authorized — to invoice 3                                                                  | Unassigned, Overdue, This week, Later, Waiting | —                                   |
| Test tech (technician-only)        | —                     | the route sends them to My tickets; the server would answer an empty list anyway           |                                                |                                     |

Toolbar and abilities, as the rules resolve them for each user: New task for everyone; New ticket
and New opportunity for everyone but Test tech; the Show-person picker for the four admins and
managers only; Claim and the Calendar's Unassigned pane for everyone ticked Technician who is
not technician-only (RoAnna, not ticked, gets Assign to… instead and the pane only when there is
something to assign); Snooze for admins and managers only; the Needs authorization column for
admins and managers; Authorized — to invoice for them and for the Invoices-ticked users.

The Calendar for an admin on Everyone: 14 dated items on 10 days, 14 undated ("14 items have no
date — see the List"), red days Oct 15, 26, 27, 30 (the overdue opportunity and bids; the Done
and Authorized tickets on past days are not red, as designed).

## Findings (ranked)

### 1. A Done ticket waiting to be authorized sits on a different calendar day, with a different name and status, depending on the Show picker

Everyone (and the named authorizer's own Mine) lists the Done ticket as its "Authorize ticket #…"
follow-up row: day = the timer's due day (close-out + 1 day), person = Brandon (the timer's
holder), status "Done — to authorize". Mine / one person for any other admin or manager lists the
same ticket as the ticket row: day = its scheduled date, person = its technician, status "Done".
Both rows sit under Needs authorization on the List, so the List is consistent; the Calendar is
not — the same ticket moves day when the picker changes.

Proof, from the live run (`mergeWork` → `itemsByDay`):

| Ticket | Everyone: Calendar day | Mine (Braden / Garry / RoAnna): Calendar day |
| ------ | ---------------------- | -------------------------------------------- |
| #6029  | Oct 16 (timer due)     | Oct 22 (scheduled)                           |
| #6036  | Oct 30                 | Oct 8                                        |
| #6040  | Oct 28                 | Oct 22                                       |
| #6035  | Oct 22                 | Oct 23                                       |
| #6039  | Oct 29                 | Oct 31                                       |

Code: `src/lib/my-work.ts` — `followupItem` (date from `due_at`, assignee from the follow-up) vs
`toAuthorizeItem` (the plain `ticketItem` with `needsAuth`); `mergeWork` picks one or the other by
whether the Authorize timer is among the viewer's follow-ups.

Proposed fix (not applied): one rule for a Needs authorization row whatever the scope — its day is
the day it was closed out (`waitingSince`), its status "Done — to authorize", and the row shows
both the technician and, when known, the authorizer. A test that pins the same ticket to the same
day under Everyone and Mine would fail on today's code and pass after.

### 2. A plain user who invoices sees the "Authorized — to invoice" rows with no technician name

The names map comes from `work_people()`, which answers only admins and managers; for a plain
user it holds their own name alone. #6026 (Braden's) therefore shows no name to Brian, Mark and
Test office, while it shows "Braden Keck" to the four admins and managers. The owner's Oct 9 rule
("why doesn't this show who it's assigned to on the card?") says the card always names the
person. `technician_options()` answers 8 rows to anyone with Service access (probed live), so the
server could name technicians for these viewers without a new grant.

Proof: the live run for Brian / Mark / Test office — `names` has 1 entry; the #6026 row's
`assigneeName` is null; `WorkRow` renders the name only when `showWho || item.assigneeName`.

Proposed fix (not applied): in `listMyWork`, when the caller cannot pick (`!canPick`) but has
Service access, read `technician_options()` for the names map. Low effort; a test with a plain
invoicer and another person's Authorized ticket would fail today and pass after.

### 3. "Assign to…" on the List fails for an unassigned ticket that has no date

`assignPlan` sends `date: item.date` (null for an undated ticket) and `assignServiceJob` requires a
date (`assignDateProblem`), so the pick fails with "Pick a date — every ticket needs a follow-up
date" and the ticket stays unassigned. The Calendar drop (the assign-for-a-day dialog) works, since
it supplies the day. No live ticket is undated today (the only undated one, #6001, is deleted), so
nobody can hit this now; tickets have required a date since Oct, so only a legacy row could.

Code: `src/lib/my-work-actions.ts` `assignPlan` (`date: onDay ?? item.date`),
`src/lib/service.functions.ts` `assignServiceJob`.

Proposed fix (not applied): when the ticket has no date, open the assign-for-a-day dialog from the
List too (it already exists for the Calendar), defaulting the day to today. Edge case; can wait.

### 4. Behaviour worth knowing (not bugs)

- Braden and RoAnna hid the Later column with its X. Today that column holds 15 items on Everyone
  (#6031 on Nov 15 and 14 undated draft bids), visible only as the "Hidden: Later (15)" chip. The
  page is doing what was asked; the owner may want to know how much sits there.
- Braden's saved layout still carries `view: "owner"` from before the Owner view became its own
  page (Oct 21). `normalizeWorkLayout` reads it as the List, so it is harmless, and the next layout
  change overwrites it.
- A Snooze on an "Authorize ticket #…" timer keeps the row under Needs authorization with an "On
  hold until …" line; it never moves to Waiting (`bucketOf` places `needsAuth` before the hold).
  The ticket still needs authorizing, so this reads as intended.
- The Needs authorization and Authorized — to invoice queues are the office's: they list every
  such ticket whatever the Show picker says (Mine included), by design (Oct 12).
- A crew member who is not the lead technician does not see the ticket on their Work Overview (the
  page lists by `technician_id`); the Service board does. As documented since Sep 30.
- `unassigned_overdue_days()`, `technician_options()` and `ticket_authorizers()` answer a
  technician-only user too (SECURITY DEFINER, no caller check). They expose a setting number, the
  Service roster and the authorizer order, nothing more; noted, not a finding.

## What the morning pass could not exercise on live data

- **Tasks.** The tasks table was empty, so task rows, open-in-place, the Done tick with Undo, task
  drags and Claim / Assign to… on a task were checked by code reading and the 775 unit tests only.
- **Unassigned work.** No live Open / Scheduled ticket, opportunity or task was unassigned, so the
  Unassigned column, Claim and the Calendar's Unassigned pane ran on an empty set.
- **Clicking through.** No login, so the page was not driven in a browser.
- **Writes.** No row was changed.

All four were covered in the afternoon (part 2, below), with a login the owner made for the test.

## Part 2 — the three fixes, and the page driven in a browser (Nov 2, afternoon)

The owner: "go ahead and fix all 3 … also please test the tasks, unassigned work, and clicking
through the browser. i made you a login." The fixes are in `src/lib/my-work.ts`,
`src/lib/my-work.functions.ts`, `src/lib/my-work-actions.ts`, `src/components/my-work-actions.tsx`
and `src/components/my-work-page.tsx`; the tests in `src/lib/work-overview-nov2-fixes.test.ts`
(10 tests: 7 fail on the morning's code, all 10 pass after; the three that pass either way pin
behaviour the fix must keep). Four older tests that pinned the old Needs authorization rule were
updated to the new one (`managers-authorize.test.ts`, `work-empty-fold.test.ts`,
`my-work-actions.test.ts`). Full suite after: 463 files, 5,976 tests, all pass; tsc, eslint and
prettier clean; `bun run build` clean.

| Fix                                | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. One Needs authorization row     | `mergeWork` now lists a Done ticket as its ticket row whatever the scope: the day it was closed out (`completed_at`, else the stage stamp, else the scheduled day), status "Done — to authorize", the technician as the row's person, and a new "Authorizer: <name>" line (the timer's holder when the viewer sees the timer, else the named authorizer the server now sends as `authorizerId`). When the viewer holds the "Authorize ticket #…" timer it rides on that row (Snooze, the reminder line) instead of being its own row. A timer whose ticket is not in the queue still lists as before. The Owner page's counts are untouched (it never sends the queue). |
| 2. Names for plain invoicers       | `listMyWork` reads `technician_options()` for a caller who cannot pick but has Service access, so their to-invoice rows name the technician.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3. Assign to… on an undated ticket | `assignPlan` returns no plan for a ticket without a day; the List's pick opens the assign-for-a-day dialog with a Day input set to today and the line "This ticket has no date yet — pick the day they get it."                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### The browser run

Local dev server on this commit against the live database, Chromium through Playwright, signed in
as the test login (`Claude`, an admin ticked Technician). Three temporary rows of mine were made
by SQL and deleted afterwards (ticket #6043 "Claude temp (delete me)", an opportunity and a task
by the same name, with their follow-ups, timeline lines and opportunity events); the test
profile's role was flipped by SQL for the plain-user and technician-only runs and set back to
admin. No existing ticket, bid, opportunity or task was touched, and no notification went to
anyone else (0 rows in `notifications` for other users over the run). Screenshots are in the
scratchpad (`…/wo/shot-01` to `shot-13`).

| #       | What was done                                                                                  | Result                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1      | Sign in, land on Work Overview, Everyone                                                       | List with Overdue 5 · Later 15 · Needs authorization 5 · Authorized — to invoice 3; the Needs authorization rows read "Done — to authorize", "Authorizer: Brandon Keck", "Waiting N days", with Snooze (fix 1 live)                                                                                  |
| A2      | Hover the ⓘ beside Overdue                                                                     | the plain-language tooltip                                                                                                                                                                                                                                                                           |
| A3–A5   | X on Overdue, reload, Hidden chip, Reset layout                                                | column gone, "Hidden: Overdue (5)", survives a reload (the profile's copy), chip brings it back, Reset layout shows only while customised                                                                                                                                                            |
| A6–A8   | Drag the Later heading onto Overdue, reload, Reset layout                                      | Later first, survives a reload, Reset restores the default order                                                                                                                                                                                                                                     |
| A9–A10  | Show menu: untick Bids, re-tick                                                                | no Bid badges and "Show: 5 of 6", then "Show: all"                                                                                                                                                                                                                                                   |
| A11–A13 | Show picker: Mine, Brian Folden, Everyone                                                      | `?who=mine` and "Your tickets…"; Brian's rows with "Brian Folden:" in the intro; Everyone back                                                                                                                                                                                                       |
| A14     | `?view=list&bucket=overdue`                                                                    | the Overdue column ringed                                                                                                                                                                                                                                                                            |
| A15     | `?view=owner` (an old link)                                                                    | sent to /owner                                                                                                                                                                                                                                                                                       |
| B1–B8   | Calendar: month, previous month, Oct 15, red days, undated note, back to List, Today, bare URL | October in the URL; Oct 15 red (the overdue opportunity), Oct 16 not red (to-invoice / to-authorize); "14 items have no date — see the List."; the List keeps `?month`; Today drops it; the bare URL reopens the remembered view                                                                     |
| C1–C2   | Phone width (390px)                                                                            | four tabs with counts; the Needs authorization tab shows its rows with the Authorizer line                                                                                                                                                                                                           |
| D1      | Temp ticket (no date) and temp opportunity, nobody's                                           | both under Unassigned with Assign to… and Claim; the ticket "No date · Open · Unassigned", not yet flagged (entered today, timer 1 day)                                                                                                                                                              |
| D2      | Assign to… → Claude on the undated ticket (fix 3)                                              | the dialog "Assign #6043 … for Mon, Nov 2" with the Day input on today and the no-date line; day set to Nov 3, Assign → "Assigned to Claude for Nov 3"; the ticket under This week, Scheduled, Claude; the database: technician Claude, Nov 3, Scheduled, timeline "Date set to Nov 3, 2026"         |
| D3      | Claim the opportunity                                                                          | "Yours — it is on your list now"; under Later (expected close Nov 9) with its 7-day timer; the database: assignee Claude, follow-up open due Nov 9                                                                                                                                                   |
| D4      | Snooze the ticket's follow-up until Nov 5 with a reason                                        | "On hold until Thu, Nov 5"; the row under Waiting with "On hold until … · Nov 2 audit test hold · held by Claude"; the database: snoozed_until set, hold_count 1, timeline "On hold until Nov 5, 2026 by Claude: …"                                                                                  |
| D5      | Calendar: drag the ticket from Nov 3 to Nov 7                                                  | "Moved to Nov 7 — its hold was ended"; the day's list shows it on Nov 7; the database: Nov 7, snoozed_until null, timeline "Date moved from Nov 3, 2026 to Nov 7, 2026"                                                                                                                              |
| D6      | Ticket made nobody's again (SQL); drag it from the Calendar's Unassigned pane onto Nov 5       | the pane with the claimer's hint; "Yours, on Thu, Nov 5"; the pane then "Nothing waiting."                                                                                                                                                                                                           |
| D7      | New task (dated today, assigned to me by default)                                              | the row under This week with the Done tick and no map link (no building); the row opens the task in place ("Edit task"); Done tick → "Task done" with Undo, row gone; Undo → "Task reopened", row back; Calendar drag to Nov 5 → "Moved to Nov 5"; the database: due Nov 5, all day, assignee Claude |
| D8      | Task made nobody's (SQL)                                                                       | under Unassigned with Claim and Assign to…; an admin opens it in place (assignee "Nobody"); Assign to… → Claude → "Assigned to Claude"; mine again                                                                                                                                                   |
| D9      | Task made nobody's again; Claim                                                                | "Yours — it is on your list now"; mine again                                                                                                                                                                                                                                                         |
| G1–G4   | Test profile as a plain user (Service + Invoices, not ticked)                                  | "Your tickets…", no Show picker, no Needs authorization column, no Snooze, "Follow-ups are managed by your manager."; New ticket present; only my own open work; the to-invoice rows read "#6026 … Braden Keck" (fix 2 live)                                                                         |
| H1–H2   | Test profile as technician-only (Service, ticked)                                              | /my-work sends them to My tickets; no Work Overview in the sidebar                                                                                                                                                                                                                                   |
| Z       | Every run                                                                                      | no page errors and no console errors                                                                                                                                                                                                                                                                 |

One probe of mine misfired (D7's "the New task dialog names me" read the select before the roster
had loaded); the saved task carried my name, as the row and the database show.

### Seen along the way, not changed

- A Done or Authorized ticket with no technician shows "(unknown)" as its person on Everyone
  (#6039, #6038, #6024 today). "(unknown)" reads as a lookup that failed; "No technician" would be
  truer. Small wording change, the owner's call.
- A ticket's hold record (`hold_reason`, `hold_count`) stays on the follow-up after a date move
  clears the hold; nothing shows it (no "Back from hold" badge, since `snoozed_until` is null). As
  designed for a logged contact; harmless.

## How this was proved, and how to repeat it

1. `TZ=America/New_York bunx vitest run` on a throwaway test that loads a JSON dump of the live
   rows (profiles, service_jobs, tasks, open crm_followups, crm_opportunities, bids, crm_accounts,
   crm_settings, service_settings), applies each user's row security as `pg_policies` states it,
   calls the real `listMyWork` handler through the test fake (`src/test/fake-supabase.ts`) with
   `who` = `all` and `mine`, then runs `mergeWork` → `flagUnassigned` → `applyKinds` →
   `listGroups` → `applyWorkLayout` → `splitEmptyGroups` and `itemsByDay` / `dayIsOverdue` exactly
   as the page does. The script and the dump live outside the repository (customer names) at
   `/tmp/claude-0/-home-user-roof-estimator-shell/b8bc0c3c-809e-5a8f-a98c-c2ae48079a6b/scratchpad/wo/live-audit.test.ts`
   and `…/wo/dump.json`; the output is `…/wo/report.json`. To repeat: dump the same tables, copy
   the script into `src/lib/`, run it, delete it.
2. Row security was probed live, read-only, with
   `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<user id>","role":"authenticated"}', true);`
   followed by counts over each table and the five functions, once per user.
3. Policies, triggers and function bodies were read with `pg_policies`, `pg_trigger` and
   `pg_get_functiondef`.

## Part 3 — two wording changes, the Price List Import and the Owner page in the browser (Nov 2, later)

The owner: "change (unknown) to No technician … one thing i noticed is if something is marked done
it can still show as overdue", and whether the other pages should be clicked through now that
there is a login.

**"Done but overdue" — what it was.** The only place a finished item read as overdue was the Needs
authorization row of a Done ticket: its "Authorize ticket #…" timer's state line said "Overdue 17
days" in red (the timer's due day is the close-out plus one). The ticket is finished; what is late
is the office's authorization. A Done task never shows anywhere (the list drops `status = done`),
a Done ticket is never in the Overdue column, never a red calendar day and never counted overdue
on the Owner page (`isOverdueTicket` and `bucketOf` both exclude it). The line now reads
"Authorization overdue 17 days" / "Authorization due today" / "Authorization due Fri, Oct 16" for
that kind of timer, so nothing marked Done reads as overdue work. The authorizer's reminder notice
("N days overdue") is unchanged; it goes to the person who must authorize.

**"(unknown)" → "No technician".** A ticket row with no technician that is not Unassigned (a Done
or Authorized ticket closed out by the office or whose technician was removed: #6039, #6038,
#6024) says "No technician". Any other kind whose person cannot be named still reads "(unknown)".

Tests: `src/lib/work-overview-nov2-wording.test.ts` (3 tests, all fail on the previous commit,
pass after); `work-card-assignee.test.ts` updated to the new line. tsc, eslint, prettier clean.

### The browser run (the same login)

| #     | What was done                                                                                                                                                           | Result                                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1–I2 | Price List Import: open, load a 5-line test .csv (three Duro-Caulk Plus numbers at today's price, White at 10.25, a renumbered Tan line "1137Z", a made-up line "ZZZ1") | the page reads the file in the browser and guesses Header row 1, Item Number / Description / Price                                                                                                                                                                 |
| I3    | "2. Matched by item number"                                                                                                                                             | "5 sheet rows · 3 products matched · 1 price would change"; the table shows 1136 White $10.20 → $10.25 (0.5%); "2 already at the sheet price" folded                                                                                                               |
| I4    | "3. Likely matches (1)"                                                                                                                                                 | 1137Z "Duro-Caulk Plus - Tan 10.3 oz" beside Sealants › Duro-Caulk Plus - Tan, "was item # 1137, not on this sheet", strong, Link / Not this                                                                                                                       |
| I5    | "4. No match found (1)"                                                                                                                                                 | ZZZ1 "Widget frobnicator" with the Screen / Product / Colour pickers, Link, Skip, "add as new product", and a search box                                                                                                                                           |
| I6    | "Update 1 price…"                                                                                                                                                       | the review dialog: "3 price cells will be written: 1 change (1 up, 0 down, 0 newly priced), 2 already at the sheet price. 2 sheet item(s) with no mapping are skipped." Cancel closed it; nothing written (Import history still "No imports applied yet")          |
| I7    | Not this on the likely row                                                                                                                                              | Likely matches (0), No match found (2)                                                                                                                                                                                                                             |
| I8    | Skip on ZZZ1                                                                                                                                                            | gone from the list, No match found (1)                                                                                                                                                                                                                             |
| I9    | Link on 1137Z with the default pickers (Duro-Last Membrane › 40mil Roll Goods · White)                                                                                  | toast "1137Z → Duro-Last - 40mil Roll Goods · White"; the line left No match and, having no size column, landed under "Membrane rolls not turned into $/sq ft (1)" in the matched card. The saved mapping (a temporary row of mine) was deleted by SQL afterwards. |
| O1–O2 | Owner page, People                                                                                                                                                      | the team table with Due today / Overdue                                                                                                                                                                                                                            |
| O3    | an Overdue number link                                                                                                                                                  | Work Overview on the List, that person, the Overdue column ringed                                                                                                                                                                                                  |
| O4    | Business tab                                                                                                                                                            | to invoice / unpaid / pipeline / bids                                                                                                                                                                                                                              |
| Z     | every run                                                                                                                                                               | no page errors and no console errors                                                                                                                                                                                                                               |

Not clicked: the Update prices confirmation (it writes to the live price list), "add as new
product" (it adds a live product), and the Revert of an import (none to revert).
