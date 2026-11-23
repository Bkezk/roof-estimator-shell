# Roof Care: the go-aheads on the workflow audit (Nov 23, 2026, night)

The owner, on the numbered list of `docs/qa/roof-care-workflow-audit-2026-11-23.md`: "on issues 1
go with A, 2 start the new year the day after, 3 go, 4 go, ... 6 go, 7 no change needed here they
need an address", and one thing more: "when signing up and selecting a set number of days after
our payment it needs to say we will accommodate the best we can but we cannot guarantee that
date". Invoicing a plan with no ticket stays as it is ("that is fine").

Issues 5 and 8 were questions. They were answered and nothing was built for them.

## 1. A plan inspection's ticket with no day is on the Needs attention list

The database makes an inspection's ticket two weeks before its window opens, and gives it no day
when the window is a range of days. Nothing told anybody to set one.

- A new row, under **Waiting on the office**, tagged Roof Care: "Inspection 1 is due between
  Mon, Nov 30 and Sat, Jan 2. Ticket #7031 has no day and nobody on it. Open the ticket and set
  its day." It opens the ticket.
- Amber until the window opens, red once it has.
- It is listed from the day the ticket is made, and leaves when the ticket has a day.
- The same ticket is not also listed as "Nobody is on it and it has no date".
- An inspection already past its last day is left to the row that says it is late.
- Every kind of plan inspection is covered: the two of the year, a storm inspection, and one
  carried from last plan year.

Code: `src/lib/owner-attention.ts` (`AttCareNoDay`, the `care_plan_no_day` row) and
`src/lib/owner-attention.functions.ts`.

## 2. A renewal's plan year starts the day after the old year's last day

The old year covers its last day. A renewal paid ahead used to start on that same day, so both
years covered it.

- Paid on or before the old year's last day: the new year starts the day after it, and ends on
  the same date one year on from the old year's last day. So the renewal date stays the same
  date every year, and does not creep a day later with each renewal.
- Paid late: the new year starts on the payment and runs twelve months from it, as before.
- An inspection carried into the new year is owed for 60 days from that first day.
- The renewal's invoice and the receipt say the day after.

Database: `supabase/migrations/20261124200000_roof_care_renewal_starts_the_day_after.sql`
(`roof_care_start`, `roof_care_renewal_offer`), applied by hand on Nov 23 and checked by
fingerprint against the file. Who may call the two functions did not change.

## 3 and 4. A plan's invoice speaks of the plan, not of a ticket

- **Mark paid** on a plan's invoice said "The ticket's stage does not change". It now says "A
  payment that covers the total starts the plan year."
- A **final** plan invoice said to use "Another invoice above", a button a plan's invoice does
  not have. It now says "To change it, Void it below. To bill the plan again, open the plan on
  its property and choose Make the invoice." A **void** one says the same.

Code: `src/components/service/invoice-editor.tsx`; the words are in `src/lib/roof-care-plan.ts`.

## 6. The Invoices list marks a plan's invoice and can show them alone

- A plan's invoice carries a **Roof Care** badge beside its number.
- A **Roof Care** chip, beside the status chips, shows the plans' invoices alone. It works with
  the status chips, the dates and the search, and it is kept in the address, so Back from an
  invoice returns to it.
- With the chip on, the groups that hold those invoices are open, not folded.
- Tickets waiting for an invoice are left out while the chip is on: they are not plan invoices.

Code: `src/lib/invoice-search.ts`, `src/components/service/invoices-page.tsx`.

## The new one: a set number of days is not a promise

Under the choice "A set number of days after your payment" the sign-up says: "We will do our best
to come on that day, but we cannot guarantee the date." The same sentence follows that line in
their copy of the agreement, and on the plan for the office, when that choice was the one picked.

Changed later the same night. The sentence first showed only once that choice was picked, and the
owner, looking at the pop-up with nothing picked: "i dont see the note here". It is now always
there, under the choice, in grey, and turns bold when the choice is picked. Seen on the test
server at a computer's width and a phone's, before a choice, with another choice picked, and
with this one picked. The test that pins it fails on the code before the change.

The terms were not changed. If the owner wants this in the terms too, that is a new terms
version.

## Proof

Database, on the live database inside a trial that was rolled back, with the new functions in
place:

- Paid 30 days ahead: the new year started the day after the old year's last day and ended one
  year on from that last day. The old plan covered its last day and the new one did not. The day
  after, the new one covered and the old one did not.
- Paid on the last day itself: the same.
- Paid 5 days late: the new year started on the payment day and ran twelve months from it.
- "Carried until" in the renewal offer was the new first day plus 60 in all three.
- After applying for real, both functions match the migration file by fingerprint.

Screen, on the local test server signed in as the test admin, on a temporary plan at the test
customer's property:

- The sign-up showed the sentence only with "A set number of days" picked. The waiting plan
  showed it after its first inspection line.
- The Invoices list had the Roof Care chip. Pressing it put `?kind=care` in the address, left
  one row, with the badge, in an open group. The invoice opened from there, and its way back
  kept the chip.
- The final plan invoice showed the new sentence and no Another invoice button.
- Mark paid showed the new sentence. The payment started the plan.
- With the plan's first inspection given a window a week away, the database made its ticket with
  no day. The owner's Needs attention list showed the new row once, and it opened the ticket.
  The ticket was not listed a second time.

Tests: `src/lib/roof-care-go-aheads-nov23-night.test.ts`, 18 tests. On the code before this
change 17 of them fail; the one that passes checks that no row is made for a late inspection.
Five older tests pinned the old words and dates and were updated with dated notes.

Clean-up, checked on the live database: plans 0, plan inspections 0, invoices 1 (the one that was
there before), temporary tickets 0, notices 314 (unchanged), documents 45, the stored PDF gone,
no history rows left, the Roof Care settings unchanged, both counters back at their next free
number, the test login an admin again. The temporary ticket was marked as already announced the
moment it was made, so nobody was told of it.

Not tried: a real renewal over a real year end, and the emails, which wait on Email being set up.
