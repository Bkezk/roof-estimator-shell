# Roof Care: one inspection's price off a renewal, the fuller refund, closing out

The owner asked for the numbers on every case ("let me know if we are losing money in certain
situations"). They are in the private notes. His answers, Nov 19, night:

> so we need some rules sot the worst case on roof guard 15k sq foot doesnt happen … go for 1 … 2. go for this. Just ensure it makes it into the service agreement. 3. yes (do we ever have
> the ability to dismiss that? say its owed and been 6 months and they just dont seem interested
> in wanting it, how do we get it off the reminders list?)

No amount of the office's is in this file.

## What changed

| Before                                                                | Now                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| An inspection we missed took half of the plan's price off the renewal | It takes the price of one inspection off: half of Roof Watch for that roof |
| Two missed made any plan's renewal free                               | Only Roof Watch's. The larger plans still pay for what else they include   |
| A refund took off the minor repairs covered                           | Also the leak call travel that was not charged                             |
| A storm inspection done counted for nothing in a refund               | It counts as an inspection done                                            |
| The agreement had ten terms and said nothing of renewal               | Eleven. Term 9 is fuller and term 10 is new. Version 2026-11-19.2          |
| An expired plan could only wait out its 60 days on Needs attention    | A manager closes it out with a reason                                      |

## Why the price of one inspection

Roof Watch is two inspections with their reports and nothing else, so half of it is what one
inspection sells for at that roof and that drive. Most of what a larger plan costs pays for
its minor repairs, its leak calls and its storm inspection, and the customer had those. Taking
half of the larger plan off gave back several times what the missed inspection was worth.

The answer is still called "we did not get there" on the screen. The words now say the amount
is "the price of one inspection", or "of two".

## Closing out

On an expired plan a manager has "Close it out". It asks why. Then:

- Every inspection of the plan that is not done and that nobody has started is dropped.
- Its ticket comes off the board, with a note saying why.
- The plan leaves the Needs attention list.
- The property says "Closed out Nov 19, 2026: …. What was still owed was dropped."
- The Renew button stays: the customer may come back.

It is refused for a plan in force, for one already closed out, and while a renewal of it waits
to be paid.

## How it was proven

**The live database, in a transaction that was rolled back**, after the change was applied. All
18 checks came out as written:

| Check                                                       | Result                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| Roof Guard, both inspections owed                           | The whole Roof Watch price comes off, less than the plan        |
| Roof Guard, one owed                                        | Half of Roof Watch, not half of Roof Guard                      |
| An office user renews with that                             | Made; the amount saved on the renewal                           |
| Roof Watch, both owed                                       | Its whole price: free, and refused to an office user            |
| A refund with one inspection done and nothing used          | Half of what was paid                                           |
| With minor repairs covered and leak call travel not charged | Half, less both                                                 |
| That repair invoice voided                                  | Back to half                                                    |
| A storm inspection asked for and not done                   | Still half                                                      |
| The storm inspection done                                   | It counts as the second: nothing to refund                      |
| Closing out while a renewal waits                           | Refused: cancel the renewal first                               |
| An office user closes out                                   | Refused: a manager's                                            |
| No reason                                                   | Refused                                                         |
| A manager closes out                                        | The owed inspection dropped, its ticket gone, the done one kept |
| Closing out twice, or a plan in force                       | Refused, both                                                   |
| The Renew box afterwards                                    | Answers, with nothing owed                                      |

**A browser on the current code**, as an admin, on a temporary Roof Guard plan at the test
customer's own property, both inspections late:

1. The Renew box: "We did not get there. Take … off the renewal, the price of two inspections:
   the customer pays …. The inspections are dropped." What comes off and what is paid add up to
   the price. The old rule would have made this renewal free.
2. After the plan expired: the card, the two inspections still owed, and "Close it out". The
   button in its box is off until a reason is typed.
3. Closed out: "2 inspections that were still owed were dropped." The card says closed out, with
   the reason. No owed rows, no Close it out button, the Renew button still there. Needs
   attention has no row for it.
4. The sign-up shows eleven terms, with terms 9 and 10 as written.

No page error. The count of notices was the same before and after. Every temporary row was
removed and the ticket and plan numbers put back.

**Not shown in the browser:** the two new lines of the End plan box, for the leak call travel
and the storm inspection. They are proven by the database trial and by tests.

**Tests.** `src/lib/roof-care-credit-nov19.test.ts` (13). Five older tests pinned the words
that changed and were updated with a dated note.

## The database change

`supabase/migrations/20261119950000_roof_care_inspection_credit.sql`, applied to the live
database on Nov 19 and checked there.

- `roof_care_renew`, `roof_care_renewal_offer`: what comes off. Changed where they stand; the
  change stops with an error if a function is not as the file expects.
- `roof_care_refund_worked`: the leak call travel and the storm inspection.
- `roof_care_plans`: `closed_out_on`, `closed_out_reason`, `closed_out_by_name`.
- `roof_care_close_out`: new, a manager's.
