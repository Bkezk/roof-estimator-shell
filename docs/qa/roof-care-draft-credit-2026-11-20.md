# Roof Care break test, numbers 2, 3, 5 and 6: what a plan gives on an invoice (Nov 20, 2026)

Owner, Nov 20: "go with 2", then "go with 3, 5, 6". Number 2 is first; 3, 5 and 6 follow it
below.

# Number 2: a draft's plan lines are worked out again

Owner, Nov 20, of the break test's number 2: "go with 2".

All dollar figures here are made up. They match no plan price, allowance or rate of the office.

## What was wrong

A draft invoice kept the Roof Care lines it was given when it was made or last saved.

Example. A plan includes 740 of minor repairs. One draft of the plan takes 430. A repair's
draft, 760 of work, takes the 310 that is left and bills 450. The first draft is then deleted,
so its 430 is free again. The repair's draft still took 310 and billed 450, and Finalise
accepted it: the customer was billed 430 the plan would have covered.

The leak call's "no travel charge" line went the same way: a call freed by a voided invoice
was not given to a draft that had been charging its travel.

## The rule now

The plan's lines on a draft are worked out again from what is true at that moment:

- when the draft is opened on the invoice page, and
- at Finalise, on the server, whatever the page did. Send on a draft comes the same way.

It is the same step a save has always taken (`syncPlanLines`): the leak call's travel first,
then the minor repairs credit over what the invoice still charges. That covers the credit on a
repair's invoice, the credit toward a charged return trip or a billed storm inspection, and the
leak call line.

When an amount moves:

- the draft is saved with the new lines and totals,
- the office is told what changed and why, in a notice that stays until it is closed, and
- a Finalise stops. Nothing is final, no PDF is stored and the ticket does not move. The
  invoice is shown as it now stands and Finalise is pressed again.

What a person chose by hand is kept, as before. The invoice remembers which it was
(`care_allowance_choice`: by itself, typed, or declined; `care_travel_choice`):

| The office's choice                  | When more credit comes free                   |
| ------------------------------------ | --------------------------------------------- |
| Nothing chosen (ticked by itself)    | The credit follows: it takes all it can cover |
| An amount typed by hand              | Held. Never raised. Still cut if less is left |
| "Does not use the plan"              | Stays off                                     |
| "Charge the travel: not a leak call" | Stays charged                                 |

Final, paid and void invoices are never worked out again. An invoice with no ticket (a trade
bid's, a plan year's own) is left alone.

The database's own rule is unchanged: the lines of a plan never add up past its allowance or
past what the invoice bills (migration `20261120610000`).

## What the office reads

For the example above, on opening the draft:

> The Roof Care plan now takes $740.00 off this invoice for minor repairs. It took $310.00
> before. More of the plan's minor repairs amount is free: another invoice that used it was
> deleted, voided or changed. The invoice total is now $20.00. It was $450.00.

At Finalise the same words, followed by: "The invoice is not final yet. Look it over, then press
Finalise again."

Other cases say their own reason: "Another invoice of this plan used part of the minor repairs
amount first.", "This invoice bills less than the plan was covering.", "The travel on this
invoice, $60.00, is no longer charged: the plan has a leak call free again."

## Where it is

| What                                                         | Where                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| The words, and whether an amount moved                       | `planLinesChangeWords`, `planLinesMoved` in `src/lib/roof-care-allowance.ts`                   |
| The step itself, and the page's call                         | `reworkDraftPlanLines`, `reworkInvoicePlanLines` in `src/lib/roof-care-allowance.functions.ts` |
| Finalise: worked out again ahead of the PDF, stops if moved  | `finalizeDraft` in `src/lib/invoices.functions.ts`                                             |
| The invoice page: once when a draft opens, again at Finalise | `DraftInvoice` in `src/components/service/invoice-editor.tsx`                                  |

No database change was needed.

## Proof

Tests: `src/lib/roof-care-draft-credit-nov20.test.ts`, 28 tests. With the four files above put
back to the commit before, 27 of them fail (the one that passes says a draft that already
stands right is final at the first press, which was always so). The test of a stale draft at
Finalise fails on the old code because the old Finalise goes through at the stale amount.

An older check in `src/lib/invoice-workflow-oct14.test.ts` was updated with a dated note: the
page now works the plan's lines out between its save and its Finalise.

On the live database, with the real invoice page, on a temporary property, plan and two
temporary tickets of the test customer (all removed after):

| Step                                                           | Before the fix                                 | Now                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The repair's draft opened while the other draft holds 430      | Credit 310, total 450                          | The same. Nothing is said, nothing is written                                                 |
| The other draft deleted                                        | The draft stays at 310 and 450 in the database | The same until it is opened or finalised                                                      |
| Finalise pressed on the page that was open all along           | Final at 450                                   | Stops. Credit 740, total 20, the notice above. Still a draft, no PDF, ticket still Authorized |
| The draft opened again                                         |                                                | Stands at 740 and 20. Nothing is said twice                                                   |
| The draft put back to 310 by hand in the database, then opened | Shown at 310 and 450                           | Put right on opening: credit 740, total 20, the notice                                        |

The database's rule, tried in a rolled-back trial on the same rows:

| Tried                                                        | Result                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| The draft's credit raised to 800, over the plan and the bill | Refused: "Only $740.00 of this plan's minor repairs allowance is left." |
| Another invoice takes 10 when nothing is left                | Refused: "Only $0.00 of this plan's minor repairs allowance is left."   |
| The step's own write, 310 and then 740 of 740                | Accepted                                                                |

Finalise was pressed once on the page, in the state where it has to stop. A Finalise that goes
through was not pressed on the page, because it moves a ticket to Invoiced and tells the
office; that path is covered by the tests, which run the real server function.

## Clean-up

The temporary property, plan, two tickets (999101, 999102), two invoices, their lines and their
History entries are removed. Plans 0, the test customer's ZZ properties 0, notices unchanged,
both counters set by the computed form, the test login as it was.

# Number 3: work dated inside the plan's year gets what the plan gave

## What was wrong

The credit and the leak call's "no travel charge" both asked one thing: is a plan in force on
the day the invoice is opened? So for work done while a plan ran, invoiced after it ended:

- a new invoice got nothing of the plan,
- a draft made earlier kept its credit, the plan box was gone and "Does not use the plan" was
  refused,
- on Rebuild the leak call's line was lost while the credit stayed: two rules.

## The one rule

Work dated inside the plan's year gets what the plan gave, the minor repairs credit and Roof
Guard's leak call alike, whenever the invoice is made, also after the plan has ended. Work
dated after the plan's last day gets nothing of it. The office can untick the credit either
way. Rebuild keeps both lines or drops both by this same rule.

The work's date is read off the ticket: the day it was completed; with none, the day the
technician was on site; with none, the day it was scheduled; with none, today. Days are the
office's (Eastern).

| The plan                | Covers work dated                                                       |
| ----------------------- | ----------------------------------------------------------------------- |
| In force                | Up to its last day                                                      |
| Ended                   | From its first day to its last day, the day it ended if that came first |
| Waiting for its payment | Nothing                                                                 |

After a renewal, last year's work belongs to last year's plan and comes off last year's
amount.

The owner's example: a plan from Jan 1 to Dec 31, a repair done Dec 10, the invoice made
Jan 5. The credit and the leak call both apply, and the office may untick the credit. The same
repair done Jan 4 gets neither.

A line already on an invoice whose work is outside its plan's year comes off when the draft is
opened, saved, rebuilt or finalised. A plan the person cannot read takes nothing away on a
guess, and "Does not use the plan" still works on it.

## A refund is never handed back twice

A plan ended early with a refund: the refund was worked from what the plan had given by then.

- While the refund is not sent, a credit or leak call given afterwards lowers the refund owed
  by the same amount, never under nothing. Taken off the invoice again, or the invoice voided,
  the refund goes back. An amount a manager changed in between is lowered from there.
- Once the refund is sent, the plan gives no more than the refund counted. The invoice that
  held a counted credit keeps it, also through a Rebuild.

# Number 5: the return trip's line stays the office's; the credit pays the worked-out charge

The office can still type the trip line's price. The plan's minor repairs pay toward a trip no
more than the trip was worked out at (the visit's own amount). What is typed above that is
billed to the customer and not taken from their credit. Typed lower, the credit pays the lower
amount, as before. When the typed price differs, the line says what was worked out, for
example "Worked out: $140.00. The plan's minor repairs pay toward the trip up to that; the rest
is the customer's."

Example: a trip worked out at 140, typed to 600, with 300 of minor repairs left. The credit is
140 and the customer is billed 460. Before, the credit paid 300.

It is held in three places: the site's own sum (`invoiceAllowance`, `tripCaps`), the database
when the credit line is written, and the database again at Finalise
(`roof_care_credit_cover`). On a plan inspection's own invoice the credit covers the return
trips, each held so, and a billed storm inspection, and nothing else.

# Number 6: every invoice of a plan inspection's ticket leaves the covered visit at no charge

"Another invoice" on a plan inspection's ticket was built as any ticket's is, so the visit the
plan covers was priced at the standard rates on it. Now a further invoice lists the ticket's
time, materials and purchase orders at no charge with their cost kept, exactly as the first
invoice does, without the plan's own line and the return trips (both are billed once, on the
first). Rebuild goes the same way. The office types a price on a line that is beyond what the
plan includes, and a typed price is kept when the invoice is built again.

A purchase order line is covered at no charge too, on the first invoice and on a later one:
that is the rule the first invoice already had, and it is not changed here.

# Where 3, 5 and 6 are

| What                                                             | Where                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The work's date, the plan's year, which plan the work belongs to | `workDay`, `planCoversDay`, `planForWork` in `src/lib/roof-care-allowance.ts`                                                               |
| The credit and the leak call both ask it                         | `planOfWork`, `planLineOutside` in `src/lib/roof-care-allowance.functions.ts`; `invoiceTravelOf` in `src/lib/roof-care-travel.functions.ts` |
| Rebuild carries the credit by the rule                           | `rebuildInvoiceLines` in `src/lib/invoices.functions.ts`                                                                                    |
| The trip's worked-out charge, and the words under the line       | `tripCaps`, `tripWorkedOutWords`; `getInvoiceTripCharges`; `DraftInvoice` in the invoice page                                               |
| A further invoice's covered lines                                | `carePlanFurtherLines` in `src/lib/roof-care-invoice.ts`; `buildLinesFromJob` in `src/lib/invoices.server.ts`                               |
| The database's side                                              | `supabase/migrations/20261120800000_roof_care_plan_year_and_trip_cover.sql`                                                                 |

# Proof of 3, 5 and 6

Tests: `src/lib/roof-care-plan-year-nov20.test.ts`, 28 tests. With the source files put back to
the commit before, the file does not load. Three older checks in
`src/lib/roof-care-followups-nov19.test.ts` were updated with dated notes; each shows the old
result beside the new one (a further invoice's material at 100, now at 0; an ended plan with
no say, now covering work dated inside its year).

Database: the nine functions of migration `20261120800000` have the same fingerprint on the
live database as in the file.

Rolled-back trials on the live database, on temporary properties, plans and tickets of the
test customer. Nothing of them was kept.

Number 3, a plan that ran Jan 1 to Dec 31, 2026 and has ended:

| Tried                                       | Before                      | Now                                                                          |
| ------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Work of Dec 10: the leak call line          | Refused, the plan has ended | Accepted                                                                     |
| Work of Dec 10: a credit of 700             | Refused, the plan has ended | Accepted                                                                     |
| Work of Jan 4: a credit, a leak call        | Refused                     | Refused: dated Jan 4, 2027, outside the plan's year (it ran to Dec 31, 2026) |
| A ticket at another property                | Refused                     | Refused                                                                      |
| A plan waiting for its payment              | Refused                     | Refused                                                                      |
| The credit raised past the plan, 760 of 740 | Refused                     | Refused: only $740.00 is left                                                |

The refund, a plan ended early with 200 owed that counted 150 of repairs:

| Step                                                         | Refund owed                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| A credit of 120 given after the end                          | 80                                                               |
| Raised to 300                                                | 0                                                                |
| Lowered to 50                                                | 150                                                              |
| A manager sets the refund to 100, then the credit goes to 80 | 70                                                               |
| That invoice voided                                          | 150, the manager's amount with nothing given after               |
| The counted 150 taken off its invoice and put back           | Unchanged                                                        |
| Refund sent, a further credit of 50                          | Refused: the refund was sent on Jul 10, 2026 and counted $150.00 |
| Refund sent, a leak call                                     | Refused                                                          |
| Refund sent, the counted 150 rebuilt on its own invoice      | Accepted, refund unchanged                                       |

Number 5, a plan inspection's invoice with a return trip worked out at 140 and typed to 600:

| Tried                                                     | Before   | Now                                                       |
| --------------------------------------------------------- | -------- | --------------------------------------------------------- |
| What the plan can cover                                   | 600      | 140                                                       |
| A credit of 300                                           | Accepted | Refused: the plan covers $140.00 here                     |
| A credit of 140                                           | Accepted | Accepted. The customer is billed 460                      |
| Trip typed down to 90, then made final with 140 of credit | Accepted | Refused: the plan can cover $90.00. Saving works it again |

Not pressed in the browser: Another invoice on a plan inspection's ticket, the "Worked out"
words under a trip line, and an invoice of an ended plan. The tests run the real builder and
the real server functions for each.
