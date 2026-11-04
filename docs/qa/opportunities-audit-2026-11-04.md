# Opportunities audit, Nov 4

Owner: "do an audit of the opportunities page and ensure the behaviors of the page are what
they are expected to be. dont assume anything test and prove your findings." Nothing was
changed; the findings below wait for a go-ahead.

Three layers, as the My tickets audit (Nov 2): the live database's own rules read from the
database (policies, triggers, functions), the page driven in the browser as the test login
(admin) on temporary rows — one customer, two opportunities A and B, one bid, all removed
afterwards with every child row — with the database read after each step, and read-only
impersonation of other users' tokens in SQL (a write attempt rolled back inside a `do` block).

## Expected behaviours, proven

The expectations are the owner's decisions recorded in the page and server comments and in
`docs/service-module-design.md` §11 and §15.

| #   | Expected                                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A new opportunity needs a customer (reachable) with a property; blank expected close = the office's day + 30                               | Popup with an address → property made and picked, Create enabled. Row: `expected_close` 2026-12-04 (Nov 4 Eastern + 30; `opportunity_close_days` 30).                                                                                                                                                                                                                                                                            |
| 2   | Unassigned: no follow-up, no reminders; the hint beside Create absent                                                                      | Page: "No follow-up: assign someone to start the reminders."; no hint; no `crm_followups` row.                                                                                                                                                                                                                                                                                                                                   |
| 3   | Assigning starts the assignee's timer: first reminder after 3 days, never after the due date; the actor is not told                        | A: follow-up created at the assign, `due_at` Dec 4 12:00 UTC, `next_remind_at` Nov 7 (now + 3 d). B (close tomorrow): `next_remind_at` = `due_at` = Nov 5 12:00 UTC. `notifications`: 0 rows in the window (the assignee was the actor). Event `assign` by Claude.                                                                                                                                                               |
| 4   | Untouched: assigned, no contact, Open → a quiet badge on the row; the Needs action strip only past the 3-day limit                         | Row: "No contact · assigned today"; no Needs action strip. `crm_untouched()` lists B for a Customers user (1) and nothing for a service-only user (their own only).                                                                                                                                                                                                                                                              |
| 5   | The first contact moves Open → Contacted (the database), stamps `contacted_at`, logs who                                                   | Called with a note → Status "Contacted"; `contacted_at` set; event `status contacted` by Claude; log row `called`.                                                                                                                                                                                                                                                                                                               |
| 6   | Snooze (a manager's): the reminder waits, the row says "On hold until", not Overdue; the hold is a note on the timeline                    | `snoozed_until` Nov 9; header and list row "On hold until Nov 9"; log row `note` "On hold until Nov 9, 2026 by Claude: Audit hold".                                                                                                                                                                                                                                                                                              |
| 7   | Moving the expected close (an admin may) clears a running snooze, moves the timer's due date, resets the first reminder, is logged         | Toast "Opportunity saved — snooze cleared: the reminders follow the new date"; `snoozed_until` null; `due_at` moved; `next_remind_at` reset to move time + 3 d; three log rows "Expected close moved from … to …".                                                                                                                                                                                                               |
| 8   | Overdue = open and past the expected close, by the viewer's day; `?overdue=1` lists only those                                             | Close set to yesterday → "Overdue 1d" on the header and the row; `?overdue=1` → 1 of 1.                                                                                                                                                                                                                                                                                                                                          |
| 9   | Start a bid prefills the estimator and the first save links both ways                                                                      | Estimator: name = the title, "Linked to <customer> · <property>"; after Save: `bids.opportunity_id` = A and `crm_opportunities.bid_id` = the bid.                                                                                                                                                                                                                                                                                |
| 10  | The bid drives the opportunity one way: Submitted → Quoted (from Open / Contacted), Won → Won (timer closed), Lost → Lost                  | Bid Submitted → event `quoted` (from contacted); bid Won → event `won`, follow-up closed "status won", `won_on` today; the bid card reads "Won $0 Submitted …"; the strip "No follow-up: Won stops the reminders."                                                                                                                                                                                                               |
| 11  | The opportunity's own status never moves the bid; reopening restarts the timer; a closing status stops it                                  | Opportunity → Open: a second follow-up started; the bid card still "Won". → Lost: closed "status lost"; toast "follow-up reminders stopped".                                                                                                                                                                                                                                                                                     |
| 12  | Start a ticket opens the new-ticket form filled from the opportunity                                                                       | `/service?new=1&opportunity=<A>`: "From opportunity: <title>: customer, property and description filled in." — customer, property, contact shown. (Not saved: no ticket was made.)                                                                                                                                                                                                                                               |
| 13  | Delete hides it from the list; an old link opens it read-only; an admin restores it without reopening the timer                            | Deleted: not listed; `?id=` → "Deleted on … It is read-only and sends no reminders."; fieldset disabled; Status select disabled; no Start a bid / Start a ticket / contact buttons / Delete. Restore → banner gone, status Lost, follow-up still closed.                                                                                                                                                                         |
| 14  | The list: groups by status, search over title / customer / site / assignee / source / description, Mine, the preset chips                  | Groups OPEN, LOST; search "Audit description" → 1 row; "zzzz" → "No opportunities match these filters."; Mine → 2; `?status=lost` → chip Lost, 1 row; `?status=allopen` → All open, 1 row; `?assignee=<me>` → "Assigned to Claude", 2 rows. Global search (Ctrl K) finds both.                                                                                                                                                   |
| 15  | Access: Customers / Estimate users read every opportunity; anyone else only their own assignments; writes are Customers' or the assignee's | Policies: `crm_opportunities_read` = customers ∨ estimate ∨ assignee; `crm_opportunities_write` (ALL) = customers ∨ assignee; events, log and follow-ups follow. As the one service-only technician: 0 opportunities, 0 events, 0 follow-ups, 0 log rows, 0 untouched; an UPDATE of A as them touched 0 rows (rolled back). As a Customers + Estimate user: every row (deleted ones too; the list filters them).                 |
| 16  | The database writes the status log and stamps assignments; the contact-log trigger moves the status; the bid sync is a database function   | Triggers on `crm_opportunities`: `crm_opportunities_log` (insert / status / assignee), `crm_opportunities_stamp_assigned`, `crm_opportunities_audit`; on `crm_contact_log`: `crm_contact_log_apply`; functions `sync_opportunity_from_bid`, `followup_sync_upsert`, `followup_sync_close`, `crm_untouched` present, SECURITY DEFINER. `opportunity_status_from_bid` as expected (submitted → quoted only from open / contacted). |

Every step above ran with no page errors except the one in finding 2.

## Findings (not fixed)

1. **The timeline does not refresh after a date move.** Save writes "Expected close moved from
   … to …" as a note on the contact log (proven in the database: three rows), but the page's
   refresh after Save covers the opportunity, its events and the follow-ups, not the contact
   log, so the Timeline showed the note only after a reload (captured both ways). A snooze's
   note did show at once (that path refreshes the log). One line: add `["contact-log"]` to the
   page's `invalidate`.
2. **A `<div>` inside a `<p>` on the header's tags line.** `OverdueBadge` / `HoldBadge` render
   the shadcn `Badge`, a `div`, inside `<p data-line="tags">`. Every open of an opportunity
   with a badge logs React's "In HTML, <div> cannot be a descendant of <p>. This will cause a
   hydration error." (three times in the run). Nothing visible to the user; React re-renders on
   the client. The ticket page has the same line (`service-page.tsx`, `data-line="tags"`). Fix:
   a `div` for the line, both pages.
3. **Global search shows the raw status key.** The result's subtitle reads "· lost" / "· open"
   (and the same for bids and tickets: `s(r["status"])` in `global-search.functions.ts`), not
   "Lost" / "Open". Cosmetic.
4. **"From opportunity: …" appears on the bid only after it is reopened.** The link is written
   after the first save answers, and the estimator's line reads the saved row's
   `opportunity_id`, so right after Save the line is absent; reopening the bid shows it. Minor.
5. **Estimate-only users and opportunities.** The sidebar and New opportunity are offered to
   Estimate access, but the write policy is Customers or the assignee, and `saveOpportunity`
   refuses a new one assigned to someone else with "Forbidden: Customers access required" — after
   the form is filled. The same users cannot read follow-ups (`crm_followups_read` = customers or
   assignee), so their list would say "Overdue" where the office sees "On hold until", with no
   next reminder. Nobody is affected today: every user with Estimate access also has Customers
   (profiles read). Worth a rule when such a user is made.
6. **A doc nit.** The page's header comment says a deleted opportunity's status select is gone;
   it is shown disabled. Behaviour fine.

## Not exercised

- The reminder dispatcher itself (time-based; it runs from the app at sign-in through
  `dispatchRemindersIfDue` — there is no database cron) and the escalation pass. The timers'
  rows are proven above; the sends are the reminders tests' (`reminders-*.test.ts`).
- Claim / Assign to… from Work Overview (the My tickets audit, Nov 2, and
  `claim-work.test.ts`, `tasks-unassigned.test.ts`).
- A non-manager moving a stored expected close (refused: `dateMoveProblem`, covered by
  `bid-drives-opportunity.test.ts` and `followup-rules` tests) — the test login is an admin.
- Mentions on a Comment (the `mention-*` tests) — not sent, to tell nobody.

## The fixes (owner: "fix all please")

One push, each finding with a test that fails on the code before it
(`src/lib/opportunities-audit-fixes-nov4.test.ts`, 11; 10 fail on the old code — the migration
pin is new either way).

1. Save refreshes the timeline: the page's `invalidate` covers `["contact-log", "opportunity",
id]`. Browser: right after a Save that moved the date, the Timeline read "Note · … Expected
   close moved from Dec 4, 2026 to Nov 16, 2026", no reload.
2. The header's tags line is a `div` on the opportunity page and the ticket page. Browser: the
   element is a DIV on both, and an opportunity reopened with an Overdue badge logged no error;
   a real ticket opened read-only logged none.
3. Global search says the status in words (`searchStatusLabel`: opportunities, bids, invoices;
   an unknown key as it is). Browser: "… Customer · Open".
4. The estimator keeps the opportunity id it linked on the first save (`linkedOppId`), so "From
   opportunity: <title>" shows at once. Browser: the line was there right after the first Save
   of a bid started from the opportunity.
5. The write rule on the page (`opportunity-form.ts assigneeChoices`, `mayWriteOpportunity`): a
   user without Customers access gets an Assignee box with only themselves and the line "Without
   Customers access you can only assign it to yourself."; an opportunity that is not theirs opens
   read-only (fieldset, status select and Save off) under "Only Customers access or the assignee
   can change this opportunity." The follow-up read policy admits Estimate access
   (`20261104200000_followups_read_estimate.sql`, applied live and read back from `pg_policies`:
   `customers or estimate or assignee`), so their list carries holds and next reminders like the
   office's. As the admin test login nothing changed: 9 assignee choices, no hint, no read-only
   line (there is no Estimate-only user to sign in as; the rule is unit-tested).
6. The page's header comment says the deleted view's status select is disabled, not gone.

Pins updated: `opened-and-stage-dates`, `opportunity-deleted`, `opportunities-nov4-review`,
`opportunity-customer-required`, `opportunity-form`, `bid-drives-opportunity`. Chain: lint clean,
types clean, 492 files / 6,306 tests, build OK. The temporary rows of this check were removed
afterwards.

## Standing (owner, Nov 4: "so now the opportunity page has been audited correct?")

Yes: the sixteen behaviours above are proven live, the six findings are fixed, tested and
pushed (285bd30). Taken on the strength of tests rather than a live run, as "Not exercised"
says: the reminder sends themselves, Claim / Assign to… from Work Overview, a non-manager's
date move and an Estimate-only user's view. The page changed a great deal on Nov 4 (the popup's
property, the leave dialog, the Assignee box saving at change, the contact line on the list,
these six); every change was checked on temporary rows the same day. The first real
opportunities the office enters are the test that matters — read this table once against what
they see, and anything that differs is a bug to report.
