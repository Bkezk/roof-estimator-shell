# Roof Care: how they pay, the refund, and Roof Guard's leak calls

The owner, Nov 19, after paying up front by check was built:

> so the payment needs to be by check or card either one during sign up. go with the agreement
> terms update. roof care shouldnt get it … go on the dollar amount savings that is better. go
> with the first 3 not built yet and ill work on stripe later

This is two of those three, and the payment choice. Renewal is the third and is not in this.

No amount of the office's is in this file.

## What changed

| Before                                                                    | Now                                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| The sign-up did not ask how they pay                                      | It asks Check or Card, with a box for a check's number. The plan cannot be signed without |
| Ending a paid plan gave nothing back and worked nothing out               | The End plan box shows the refund, and a manager confirms it                              |
| A refund was nowhere on the site                                          | It stays on the property and in Needs attention until it is marked sent                   |
| Roof Guard's travel on a leak call was charged, or came out of the credit | The travel of the plan's first two leak calls a year is not charged                       |
| The price setup counted one leak call, with its labor as our cost         | Two leak calls, labor billed (typed at the owner's word)                                  |

## The refund

The database works it, so every screen says the same:

1. What was paid for the plan year, on the plan's own invoice.
2. The share for the inspections not done: all of it with none done, half with one, nothing
   with both.
3. Less the minor repairs the plan already covered.
4. Never below nothing.

A manager ends the plan. The box shows each line of the sum. Left blank, that amount is the
refund; another amount can be typed, never more than was paid. The plan then says "Refund owed"
until someone in the office marks it sent, with a check number.

A plan signed the older way was never paid for ahead, so it refunds nothing.

**Not done:** the Owner page does not take a refund off Roof Care's income.

## Roof Guard's leak calls

The owner's rule: "two leak calls with the credit subtracting until it reaches 0 and on those two
leak calls travel is not charged? then after that it is", and "travel does come out of the later
ones if theyve had 2 calls but havent used all their repair allotment yet". Roof Guard only.

- A plan keeps how many calls a year have no travel charge, from the price setup at sign-up. A
  later change to the setup does not change a plan already sold. The other two plans keep none.
- A repair invoice at the property carries one line, "… plan: leak call, travel included in your
  plan", that takes its travel lines off. It is put there by itself while the plan has a call.
- The minor repairs credit then covers what the invoice still charges. On a third call that
  includes the travel.
- A ticket has no "leak call" mark, so any repair at the property counts. When the visit was not
  a leak call the office presses "Charge the travel: not a leak call", and the call is not used.
- The database lets no more invoices carry the line than the plan has calls, and refuses a line
  that adds money. A void invoice gives its call back.

## How it was proven

**The live database, in a transaction that was rolled back**, after the change was applied:

| Check                                                  | Result                                       |
| ------------------------------------------------------ | -------------------------------------------- |
| A sign-up paying by something other than check or card | Refused in plain words                       |
| A Roof Guard sign-up                                   | Keeps its pay method, its note and two calls |
| The refund before anything was paid                    | Nothing                                      |
| Paid, no inspection done                               | All of it                                    |
| One inspection done                                    | Half                                         |
| One inspection done and some repairs covered           | Half, less the repairs                       |
| A leak call line that adds money                       | Refused                                      |
| A leak call on a second invoice                        | Allowed                                      |
| On a third invoice                                     | Refused: "2 of 2"                            |
| The third again after the second was voided            | Allowed                                      |
| A technician asks for the refund, or ends the plan     | Refused, both                                |
| A refund over what was paid                            | Refused; the plan still in force             |
| A manager ends the plan                                | Ended, the refund kept on it                 |
| The refund marked sent on a day still to come          | Refused                                      |
| Marked sent, then marked sent again                    | Kept, then refused                           |

**A browser on the current code**, as an admin, on a temporary Roof Guard plan and a temporary
repair ticket with travel and labor on the test customer:

- The property: "Leak calls with no travel charge: 0 of 2 used this plan year."
- The repair's new draft: "Leak call 1 of 2: the travel on this invoice is not charged." The
  travel was off, the credit covered the labor, and the total was nothing.
- "Charge the travel: not a leak call": the leak call line gone, the credit now covering the
  travel too. "Use a leak call": back as it was.
- The customer's copy: the work, then the leak call's travel, then the minor repairs.
- The property again: "1 of 2 used", and what the credit covered, on which invoice.
- End plan: the refund line by line. An amount over what was paid: refused, the button off.
- **Left blank, the first try was refused**: the database said it could not find the function.
  The amount had no default, and the page leaves it out when the box is blank. Fixed, pinned by
  a test, and tried again: ended, "Refund owed", then marked sent with a check number.
- The sign-up: Check and Card. The plan cannot be signed until one is picked. Card says the
  office takes it for now. Check opens the box for its number.

No ticket moved a stage and no invoice was finalised, so nobody was sent a notice; the count was
the same before and after. Every temporary row was removed.

**Tests.** `src/lib/roof-care-leak-calls-nov19.test.ts` (34). Fourteen older tests pinned what
changed and were updated with a dated note.

## The database change

`supabase/migrations/20261119700000_roof_care_refund_and_leak_calls.sql`, applied to the live
database on Nov 19 and checked there: seven columns on `roof_care_plans`,
`invoices.care_travel_choice`, the sign-up with how they pay and the plan's calls,
`roof_care_refund`, `roof_care_end_refund`, `roof_care_refund_sent`, and the leak call rule in
`invoice_lines_care_rule`.
