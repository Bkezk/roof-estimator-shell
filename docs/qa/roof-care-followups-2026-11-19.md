# Roof Care: the owner's answers of Nov 19

After the audit's fixes the owner answered the rest:

> Go with 1, 6, 7, 8, 9 (don't show plus x for drive) they shouldn't know they're paying more for
> distance neither the customer or tech. 10. We should probably have that under the plan status
> on the customer properties pages (think about how we can ensure this is followed) I like the
> tick idea

He also said no skips ("two are owed annually"), and that a button to correct the roof size is
not needed ("that's fine since it's invoiced at time of service").

No amount of the office's is in this file. The trials used the live setup's own numbers and the
browser run used a made-up repair.

## What changed

| No. | Before                                                                                | Now                                                                                                                 |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | "Another invoice" on a care plan ticket opened with the plan's half on it again       | The half goes on one live invoice. A further invoice is built from the ticket's work. The database refuses a second |
| 6   | A care plan inspection whose draft invoice was deleted read as done, and that was all | The plan shows "Not invoiced" beside it, and Needs attention lists it under Waiting on the office                   |
| 7   | The second inspection could be left one day (sign up Jan 15: May 15 only)             | Under two weeks of a window left: the next window. Never under two weeks                                            |
| 8   | The office could leave the second inspection sixty days late with no manager          | The 30 days count from each inspection's own first date                                                             |
| 8   | A later push with no reason wiped the earlier reason                                  | Each reason is added, with its day and who gave it. No reason leaves them as they are                               |
| 9   | The sign-up showed the drive and "X plus Y for the drive"                             | One price. The drive, the list price and what the distance adds are not sent to the browser at all                  |
| 10  | Nothing kept track of the minor repairs a plan includes each year                     | See below                                                                                                           |

## The minor repairs a plan includes

- **The plan keeps its yearly allowance** from the day it is signed (`roof_care_plans.repair_allowance`,
  taken from the price setup). A later change to the setup does not change a plan already sold.
- **The property page** shows it under the plan's status: what is used, what is left, and the
  invoices it went on. A technician is told minor repairs are included, with no amounts.
- **A repair is invoiced as any repair is.** On that invoice a Roof Care plan box asks one
  question: does this invoice use the plan? "Use the plan" puts one line on the invoice that takes
  the covered amount off. Blank takes all that can be taken; a smaller amount can be typed. "Does
  not use the plan" keeps that answer.
- **On the customer's copy** the line reads "… plan: minor repairs included in your plan", under
  the work, with its amount. It is not taxed.

How it is made sure of:

1. **Finalise waits for the answer.** While the plan has allowance left and the invoice bills
   something, the invoice is not finalised until someone has chosen. The server says so before
   the PDF is drawn, and the database refuses it too, so no other way of finalising gets round it.
2. **The database holds the amount.** The lines of a plan never add up to more than its
   allowance, whoever writes them. A line that would add money is refused. A void invoice gives
   its amount back.
3. **The line cannot be typed over.** In the editor it is read-only and is changed in the box.
   After the invoice's other lines change, the line is held to what the invoice still bills; with
   nothing left to cover it goes, and the question is open again.
4. **A choice not to use the plan has a name on it** in the invoice's history.

The plan has no say on its own inspection's invoice, an invoice billed to a vendor, a plan with
no allowance, or a plan that has ended.

## How it was proven

**The live database, in transactions that were rolled back** (the change was tried whole in one
first, then applied, then tried again as it stands):

| Check                                                          | Result                                            |
| -------------------------------------------------------------- | ------------------------------------------------- |
| The sign-up's dates against the screen's, 19 days by 4 choices | The same on all 76                                |
| The shortest second-inspection window among them               | 14 days                                           |
| The office pushes inspection 1 by 10, 5 and 15 days            | Allowed. Both reasons kept, the blank one skipped |
| Inspection 2, carried 30 days with it                          | 30 days past its own first date                   |
| The office pushes inspection 2 one more day                    | Refused: needs a manager                          |
| A manager pushes it with no reason, then with one              | Refused, then allowed                             |
| The plan's half on a second live invoice                       | Refused, naming the first invoice                 |
| The same after the first invoice is void                       | Allowed                                           |
| A care plan inspection's own invoice finalised                 | No question asked                                 |
| The allowance kept at sign-up                                  | Equal to the setup's                              |
| A repair invoice finalised with no answer                      | Refused, saying what is left                      |
| A line for more than the allowance                             | Refused                                           |
| A line that adds money                                         | Refused                                           |
| A second invoice taking more than is left                      | Refused, saying what is left                      |
| An answer that is neither of the two                           | Refused                                           |
| Marked as not using the plan, then finalised                   | Allowed                                           |
| The first invoice voided, its amount taken by a third          | Allowed                                           |
| A repair invoice after the plan is ended                       | No question asked                                 |
| A technician sets the answer, or raises a plan's allowance     | No row changed; refused                           |

**A browser on the current code**, against a temporary plan, inspection and repair on the test
customer. Saves were blocked everywhere except the temporary invoice's own buttons.

- The sign-up at a property far from the office: three prices, each with its two halves. No
  sentence about a drive, miles, hours or distance.
- The property page: the allowance under the plan's status, and "Not invoiced" beside the
  inspection whose invoice was missing.
- The invoice: the box asking the question. Finalise refused with the amount left. "Use the plan"
  with an amount: one line, the totals follow. Asked for far more than is left: held to what is
  left. "Does not use the plan": the line gone, the totals back.
- The customer's copy: the work, then the plan's line under it.
- The property page again: what was used, and on which invoice.
- The Owner page: the "on no invoice" row, with the ticket to open.

**Tests.** `src/lib/roof-care-followups-nov19.test.ts`.

Everything temporary was removed. No notice was sent.

## Later the same day: ticked by itself

The owner, after seeing it: "can we have the tick auto ticked if there is still any allowance
left?"

- A new repair invoice at a property whose plan has allowance left **takes all the plan can
  cover by itself**. The box says so, and how to undo it.
- While nobody has changed it, the amount **follows the invoice** as its lines change, up and
  down.
- An amount **typed by the office is held**: it never grows, and is only cut to what the invoice
  still bills.
- **"Does not use the plan" stays** whatever the invoice then bills.
- An invoice switched to a vendor takes nothing from the customer's plan.

The answer kept on the invoice has three values for this: `auto`, `applied` (a typed amount) and
`declined`. The rule that refuses Finalise is unchanged and now rarely fires: it still stops an
invoice on which nothing was ever chosen.

Proven in a browser on a temporary repair with eight hours of labor: the new draft opened with
the whole allowance taken off; labor cut to one hour, the line followed down to that hour;
back to eight, back up; an amount typed, then the labor changed, the amount held; "Does not use
the plan", the line gone and it stayed gone through another change; "Use the plan" with the box
blank, the whole allowance again. Database change:
`supabase/migrations/20261119300000_roof_care_allowance_auto.sql`, applied and checked live.

## The database change

`supabase/migrations/20261119200000_roof_care_followups.sql`, applied to the live database on
Nov 19 and checked there: `roof_care_plans.repair_allowance`, the two answer columns on
`invoices`, `roof_care_sign_up`, `roof_care_push_back`, and the two rules
`invoice_lines_care_rule` and `invoices_care_allowance_rule`.
