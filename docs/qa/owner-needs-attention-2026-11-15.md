# Owner page: the Needs attention list, Nov 15 2026

Owner: "one issue we run into on the roofing business is things not getting started or followed
up on" and "i more so meant like keep the owner on top of things". A mock-up with the real rows
was shown first. The owner's answers: "Those are right" (the three groups and their rows), "Yes
noise" (tickets waiting on an invoice are left out), "No morning brief please" (nothing is sent).

## What was built

A list at the top of the Owner page's People tab. Admins only. It is found by rules: nobody adds
a row, and no button on it changes anything. A row is a link to its item and leaves when the work
is done. It sends no notice, email or phone alert.

| Group | A row appears when |
| --- | --- |
| Not started | A ticket is past its date with nobody on it. With no date: entered longer ago than Setup's "needs assignment" limit |
| Not started | A ticket is past its date and its technician has not started it (the existing "untouched" rule and limit) |
| Not started | An opportunity has no contact logged past the existing "untouched" limit, or nobody is on it past the "needs assignment" limit |
| Not started | A draft bid is past its due date |
| Not followed up | A submitted bid has no follow-up date 7 days after it was sent, or its "Remind me on" day has passed |
| Not followed up | An inspection found problems and has no repair ticket or bid after it: nobody has chosen what happens next, or "No action needed" was chosen in the last 30 days |
| Waiting on the office | A Done ticket has not been authorized after 3 days |
| Waiting on the office | An invoice is unpaid past its due date |

- A manager's hold takes a ticket or an opportunity off the list until the hold ends. The list
  says how many are held.
- Amber is past the limit. Red is twice the limit or more.
- A filter by person: each person, then Office, then Nobody. The count badge stays the total.
- The 7 and the 3 are new settings under Setup, Reminders, "Owner's Needs attention list"
  (`crm_settings.attention_bid_days`, `attention_authorize_days`). The other limits are the ones
  already there.
- Left out on the owner's word: Authorized tickets with no invoice.

One addition beyond the approved rows, reported to the owner: an open opportunity with nobody
assigned also shows under Not started. The untouched rule needs an assignee, so without this an
opportunity nobody owns would never appear.

## Also fixed: the Owner page scrolled sideways on a phone

Found while testing the list. The page grew to the people table's 760 px on a 390 px screen, so
the whole page scrolled sideways by 385 px. Removing the new list in the browser left the page
just as wide, so the fault was older than the list. The page now keeps to the screen and the
table scrolls inside its own box. Measured after: 0 px on a phone and on a desktop.

## Proof

Tests: `src/lib/owner-attention-nov15.test.ts`, 32 tests. Each row type is pinned on, off and at
its limit. With the wiring put back to the old code, 4 fail: the list on the page, the page
width, the two settings, and the database columns. Three older pins were updated on purpose: the
People tab's markup, the settings fixture, and the Reminders page's "says nothing about who
authorizes" check, which now allows the limit's own wording and still refuses any sentence about
who authorizes.

Browser, local code against the live database, signed in as the test admin, on a 1500 px desktop
and a 390 px phone:

- 11 rows on both: 3 not started, 7 not followed up, 1 waiting on the office. The summary line
  read "$811,716 in bids with no follow-up". Each row was checked against a direct read of the
  database made before the list was built: the same tickets, bids and opportunity, the same days
  and the same dollars. The mock-up had 13 rows; the 2 that are gone are the Authorized tickets
  the owner left out.
- The filter "Nobody" showed 1 row and the badge stayed 11.
- The first row opened its own bid in the estimator.
- Setup showed the two boxes holding 7 and 3.
- 0 console errors. Nothing was written: the function has no insert, update or delete.

Chain: lint 0 errors, types clean, 562 files and 7,449 tests pass, build ok.

## Later the same day: the group headers fold and stand out

Owner: "can you make the not started not followed up on and waiting on the office headers
collapsable like previously suggested and a bit more noticable".

- Each header is now a bar: a dark edge, bold words, a solid count and, on the right, the
  longest wait in the group and how many rows are red.
- A press on the bar folds its group shut or opens it. This browser remembers which are shut.
  A folded group still shows its count and its "longest … · N red" line.
- The total badge and the summary line count every row, folded or not.

Tests: 4 more, 36 in the file. With the old screen 1 fails. Browser, desktop and phone: all
three open at first; the middle group folded to 0 rows with the badge still 11; a reload kept
it folded; Enter on the header opened it again; a person filter worked with a group folded;
0 px sideways and 0 console errors. Chain: lint 0 errors, types clean, 7,453 tests, build ok.

## Database

`supabase/migrations/20261115120000_owner_attention_limits.sql` was applied on the live database
and read back: both columns exist with 7 and 3 and their 0 to 365 checks. The published site
keeps working with it: its settings save names only the older columns.

## Changed on Nov 16

Twelve rules on this list changed after the Nov 16 audit. The record is
`audit-fixes-2026-11-16.md`. Where the two differ, that one is current.

## Not built, by the owner's choice

- No morning brief.
- No new reminders to staff for tickets or opportunities.
- The automatic follow-up date when a bid is marked Submitted, and a "No due date" filter on the
  Bids page, were suggested and not asked for.
