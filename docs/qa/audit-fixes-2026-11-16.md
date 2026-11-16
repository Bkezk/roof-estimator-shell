# Audit fixes, Nov 16 2026

The owner asked for an audit of the nine changes since Nov 14 ("dont assume prove your
findings"), read the findings, and said "go for everything". This is what was changed and how
each part was proven. One finding waits on the owner: the Business tab (see the end).

## 1. Inspection billing

The rule of that morning was "only a manager starts an inspection's first invoice". The audit
got around it three ways. All three are closed, in the app and in the database.

| # | Found | Now |
|---|---|---|
| 1 | A sales login changed an authorized inspection's Type to Repair, made the invoice, changed it back | To or from Inspection is a manager's once the ticket is Authorized or later, or has an invoice. An inspection's Type box is greyed with a note; on other tickets only the Inspection choice is off |
| 2 | The rule lived in the app only: a direct insert of a final invoice worked | The database refuses an inspection's first live invoice unless a manager or admin makes it |
| 3 | A ticket's invoice pointer could be set to a made-up id | A person can point a ticket only at a live invoice of that ticket |
| 4 | "Billed" was read from the pointer | The server reads the invoices themselves |
| 5 | A person with no Service access deleted a draft and the ticket kept pointing at it, silently | The database moves the pointer itself; the app reads the ticket back and says so if it is still wrong |
| 6 | A finished, unbilled inspection counted as open work for good | It is left out of the open-tickets count, the Open work filter, the Customers list count, the Tech Board's "Finished, no technician" group and the rule that stops a customer being deleted |
| 7 | The Owner tile left out a ticket with a draft; the other three lists counted it | The tile uses the queue's own rule |
| 8 | Nobody was told when a billed inspection was authorized | The office is told, as for a repair |
| 9 | Work Overview and the Owner page filtered inspections after a 1,000-row read | The filter is in the query |
| 10 | The tests compared source text | `inspection-billing-rules-nov16b.test.ts` runs the server functions: 27 tests, 21 of them fail on the old code |

Also: a manager can no longer move an unbilled inspection to Invoiced or Closed by a direct
database call. The stage rule used to exempt managers from every check.

### Database

`supabase/migrations/20261116150000_inspection_billing_rules.sql`, applied by hand on the live
database on Nov 16 and checked: five triggers present, the link check present, none of the new
functions callable by a signed-in person. It changes no data.

Proof on the live database, in one transaction that was rolled back, as four logins:

| Login | Tried | Result |
|---|---|---|
| Sales | first invoice on an inspection | refused: Only a manager can bill an inspection |
| Sales | pointer to a made-up id, and to another ticket's invoice | both refused |
| Sales | authorized inspection to Repair, authorized repair to Inspection | both refused |
| Sales | open repair to Inspection, authorized repair to Warranty | allowed |
| Sales | draft on a repair | allowed, and the pointer was set |
| Customers and Invoices, no Service | delete one of two drafts, then the last | pointer moved to the other, then cleared |
| Manager | unbilled inspection to Invoiced | refused |
| Manager | first invoice on an inspection, finalise, void | allowed; ticket Invoiced; pointer cleared on void |
| Technician | follow-up with the link "x" | refused |
| Technician | follow-up with a real link | allowed |

### In the browser, on temporary tickets

- Sales: the inspection's Type box is disabled with the note "Only a manager changes the type
  of an authorized inspection." On an authorized repair the Inspection choice is off.
- Sales: making and deleting a draft on a repair still works.
- Admin: Invoice this inspection, then Delete draft, returns the ticket to four stages.
- The customer whose only live ticket is a finished inspection now shows "Tickets in progress 0".

## 2. Needs attention list

Twelve rule gaps, in `owner-attention.ts` and its server read. Tests:
`owner-attention-nov16.test.ts`, 29 tests, 21 of them fail on the old code.

| # | Now |
|---|---|
| 11 | An unpaid invoice with no due date is listed 30 days after its invoice date, the Invoices page's own rule |
| 12 | An inspection's wait runs from the day it was finished; a stage change no longer restarts it |
| 13 | An inspection comes back when its repair ticket or bid is deleted, and says so |
| 14 | A ticket its technician has not started is aged and colored in working days |
| 15 | A bid sent again is aged from the latest send |
| 16 | A follow-up date from before the bid was sent is ignored |
| 17 | A Done inspection gets one row (waiting to be authorized); age 0 reads "Today" |
| 18 | An inspection graded F is listed with nothing flagged |
| 19 | A bid with no maker reads "No estimator", not a red "Nobody" |
| 20 | A bid past its follow-up date is amber, then red at twice the limit |
| 21 | Every read pages to its end; inspection ids go 100 at a time |
| 22 | A Done ticket's wait runs from when it was completed |

How an inspection with problems leaves the list: a repair ticket or bid is made from it, or
"No action needed" is chosen on the ticket. After "No action needed" it stays for 30 days,
reading "Closed with no repair ticket or bid", then leaves.

In the browser on live data: 11 rows, every chip on one line, no console errors.

## 3. Menu and Setup

Tests: `menu-fixes-nov16b.test.ts`, 25 tests.

| # | Now |
|---|---|
| 23 | Eleven on-screen texts and four lines of the restore script name the places as they are |
| 24 | Estimate Pricing shuts when its pages are left. Measured: 11 rows shown on a pricing page, 0 after leaving |
| 25 | On the Setup strip the arrow keys move the highlight; Enter opens. Focus lands on the opened tab |
| 26 | `/setup?tab=documents` opens Documents. An office person who types `/setup` lands on Documents |
| 27 | The Estimate Pricing arrow does not move (0 px); General has its own icon; the Settings strip is links with the current one marked |

## 4. Links and the frame rule

| # | Now |
|---|---|
| 28 | A follow-up's link must be a page of this site (database check). The sender drops a bad link and still sends the notice. Work Overview uses the notifications' link rule. A preview name is believed only under Lovable's own domains |

## Checks

- prettier, eslint (0 errors, the same 16 warnings), tsc, build: clean.
- vitest: 567 files, 7,569 tests, all pass.
- The shared test client learned `neq` inside `or`, and `or` on a counted child list.
- After the browser runs every temporary row was removed. Counts match the start of the day,
  plus one real change made by staff. The test login is an admin again.

## Waiting on the owner

The Business tab shows three numbers the Needs attention list also shows: Done tickets awaiting
authorization, tickets untouched, opportunities untouched. The owner asked to see the tab
without them before anything is removed. A before and after picture was sent. Fix 29 (the
"opportunities untouched" count) is part of that decision and is not changed yet.
