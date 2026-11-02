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

## What could not be exercised on live data

- **Tasks.** The tasks table is empty, so task rows, open-in-place, the Done tick with Undo, task
  drags, Claim / Assign to… on a task and the `content_updated_at` stale-drag guard were checked
  by code reading and the 775 unit tests only (`tasks*.test.ts`, `my-work-actions.test.ts`,
  `work-overview-oct21-audit8-*.test.ts` cover each path with the fake database).
- **Unassigned work.** No live Open / Scheduled ticket, opportunity or task is unassigned, so the
  Unassigned column, the red "needs assignment" flag, Claim and the Calendar's Unassigned pane ran
  on an empty set. The rules are unit-tested (`my-work-unassigned.test.ts`, `claim-work.test.ts`,
  `calendar-unassigned-pane.test.ts`).
- **Clicking through.** I hold no login and create none, so the page was not driven in a browser.
  The drag-and-drop, the popovers and the dialogs are covered by the component-level tests in
  `work-overview-oct20-*.test.ts` and `work-overview-oct21-audit8-client.test.ts`, which read the
  component source for the wiring.
- **Writes.** No row was changed. Earlier audits (Oct 6, Oct 21) probed the write guards live in
  rolled-back transactions; this one re-read the policies, triggers and functions instead.

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
