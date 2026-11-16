# Billing the rare paid inspection, Nov 16 2026

Owner: "can you make an invoice for an inspection? occasionally they do charge for those although
rarely". The answer was no: since Nov 3 an inspection ends at Authorized and nothing is
invoiced. A design was proposed and the owner said "yes build it that way".

## What changed

- An authorized inspection shows a small card on the ticket: "This inspection is complete and
  nothing is invoiced." A manager or an admin also gets one button, **Invoice this inspection**.
- The button makes a draft invoice from the ticket's time and materials and opens it. A line
  such as a flat inspection fee is added by hand with Add line.
- An inspection that has an invoice is billed like any ticket. It has every stage and goes on to
  Invoiced and Closed. Deleting the draft puts it back to ending at Authorized.
- An inspection nobody bills still ends at Authorized. The stage picker stops there and the
  server refuses a move past it, now with words that say how to bill it.
- Only a manager or an admin can start an inspection's first invoice. The server checks it too.

No database change was needed. The database's own stage rule never named inspections.

## Also fixed: authorized inspections sat in the waiting-to-invoice lists for good

Four lists counted every Authorized ticket, including inspections that could never be invoiced:

1. The Invoices page's Awaiting invoice group.
2. The count badge on the Invoices tab.
3. Work Overview's "Authorized, to invoice" group.
4. The Owner page's "Authorized, not invoiced" tile.

Measured before: 4 authorized tickets, of which 3 were repairs and 1 was an inspection. All four
lists now leave out an inspection until someone bills it. Measured after: 3.

## Proof

Tests: `src/lib/inspection-billing-nov16.test.ts`, 15 tests. With the old server and screens put
back, 8 fail. One new case was added to the awaiting-invoice count tests. Eight older pins were
updated on purpose, each with a note.

Browser, local code against the live database, as an admin, on one temporary inspection ticket
numbered 999931 that was removed afterward:

1. The Invoices badge read 3. The temporary inspection was not in the Awaiting list.
2. The ticket showed the card and the button.
3. The button made draft invoice #999931 and opened it.
4. Add line took "Inspection fee", quantity 1, rate 250. Finalise said "frozen at $250.00".
5. After Finalise the invoice read Final and the ticket read Invoiced. The ticket then showed
   its invoice card, and the stage picker offered all six stages.
6. Mark paid recorded $250 and the invoice read Paid.
7. Closed, picked from the stage picker, was accepted: "Stage: Closed".
8. The badge still read 3 at the end.

0 console errors on every page.

Not run live: the refusal of a non-manager who calls the server directly. It is pinned in the
tests against the code.

## Cleanup, read back from the database

The temporary ticket, its invoice, its line, its 3 timeline rows, its 9 history rows and its
stored PDF were removed. Counts before and after match: 55 tickets, 0 invoices, 358 timeline
rows, 3,508 history rows, no temporary file. The test login is admin, technician on, no page
list.

Chain: lint 0 errors, types clean, 564 files and 7,487 tests pass, build ok.
