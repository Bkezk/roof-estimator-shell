# Roof Care: renewal

The owner, Nov 19: "go with the first 3 not built yet and ill work on stripe later". The refund
and Roof Guard's leak calls were the first two (`roof-care-refund-and-leak-calls-2026-11-19.md`).
This is the third.

His rules for a year that closes with an inspection still owed, agreed the same day:

1. Sixty days before the renewal, Needs attention lists the plan.
2. Still owed because we did not get there: the renewal is charged with half taken off.
3. The customer kept us off the roof: the renewal is charged in full, and the inspection stays
   owed for 60 days into the new year, then it is lost. The office makes the call at renewal with
   the push-back reasons shown. Half off is picked unless a reason says the customer asked.

No amount of the office's is in this file.

## What changed

| Before                                                  | Now                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Nothing started the next plan year                      | The office renews a plan in the last 60 days of its year                         |
| A plan's price was only worked out at the sign-up       | The renewal is priced again that day, from the same roof size and drive          |
| Push back kept a typed reason only                      | It has a tick, "The customer asked for this", kept on the inspection             |
| An inspection not done by the renewal had no rule       | The Renew box asks: half off, or charged in full with 60 days to do it           |
| Needs attention said nothing of a plan near its renewal | It lists the plan, the renewal not paid, and an inspection carried into the year |
| A property could have one plan, in force or waiting     | One in force, and beside it its renewal waiting to be paid                       |

## How it works

- **The button.** From 60 days before the renewal date the property says "Renews Dec 19, 2026,
  in 30 days" with "Renew for another year". Past the date it says "Was due to renew", in red.
- **The Renew box** says the price for the year and whether it moved since this year. It asks
  how they pay, check or card, starting on last year's way.
- **With an inspection still owed** the box lists it with its push-back reasons and asks which
  it is. It starts on half off, or on charged in full when a push-back was ticked "the customer
  asked". The words say what each does: what comes off and what is left to pay, or the last day
  the inspection stays owed.
- **The renewal** is next year's plan with its own number, waiting for its payment. Its invoice
  is made at once for someone who makes invoices. Half off is a second line on it: "One
  inspection of last plan year was not done: half off this renewal".
- **The payment.** The day the invoice is marked paid in full, the old year ends as "Renewed"
  and the new one starts on the old renewal date, or on the payment when that is later. The new
  year's two inspections are dated from there.
- **The owed inspection.** With half off it is dropped, and its ticket nobody had started is
  taken off the board. Charged in full, it moves into the new year as "Inspection owed from last
  plan year: do it by Feb 17, 2027, or it is lost". It cannot be pushed back. The morning run
  marks it lost the day after, and takes its ticket off the board. It is not one of the new
  year's two.
- **Cancelling.** A manager cancels an unpaid renewal. The plan can be renewed again. This
  year's plan cannot be ended while its renewal waits.
- **Neither inspection done, and ours:** both halves come off, so there is nothing to pay. Only
  a manager makes that renewal, and the new year starts at once with no invoice.

## How it was proven

**The live database, in a transaction that was rolled back**, after the change was applied. All
32 checks came out as written:

| Check                                                                  | Result                                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Renewing more than 60 days ahead                                       | Refused, with the first day it can be done                                  |
| The box's answer: one inspection owed, nothing says the customer asked | Half off picked, and half the price as the credit                           |
| A technician asks for the box, or renews                               | Refused, both                                                               |
| Renewing with an inspection owed and no answer                         | Refused: pick what happens                                                  |
| The price shown is no longer the price                                 | Refused: the price changed                                                  |
| Paying by something other than check or card                           | Refused                                                                     |
| Push back ticked "the customer asked"                                  | Kept on the inspection and in its reason                                    |
| The box's answer after that                                            | Charged in full picked                                                      |
| An office user who is not a manager renews with half off               | Made: waiting, half taken off, a new number                                 |
| A second renewal of the same plan                                      | Refused                                                                     |
| Ending this year's plan while its renewal waits                        | Refused: end the renewal first                                              |
| A new sign-up at the property                                          | Refused                                                                     |
| The renewal's invoice paid 30 days ahead                               | Old year ended "Renewed"; new year starts on the old renewal date, 365 days |
| The owed inspection, half off                                          | Stays with the old year; its ticket off the board                           |
| Ending the new year at once                                            | Refunds what was paid for it, which was half                                |
| Charged in full, paid ten days late                                    | New year starts on the payment                                              |
| The owed inspection, charged in full                                   | In the new year, due in 60 days, its ticket kept                            |
| Pushing that inspection back                                           | Refused, with its last day                                                  |
| The morning run before its last day                                    | Nothing                                                                     |
| The morning run after its last day                                     | Marked lost; ticket off the board with a note                               |
| The morning run again                                                  | No new ticket for it                                                        |
| Neither inspection done, half off, by an office user                   | Refused: a manager makes it                                                 |
| The same by a manager                                                  | New year started at once, no invoice                                        |

**A browser on the current code**, as an admin, on a temporary Roof Care plan at the test
customer: 30 days from its renewal, inspection 1 done, inspection 2 late with an undated ticket.

1. The property: "Renews Dec 19, 2026, in 30 days" and the button. Needs attention: "Renews Sat,
   Dec 19, in 30 days. 1 inspection is still owed. Get it done. No renewal has been made."
2. The Renew box: the price, the same as this year. "Inspection 2 … Never pushed back." Half off
   picked: "No push-back says the customer asked, so half off is picked." Check picked.
3. Inspection 2 pushed back three days with the tick. The row then read "pushed back: Nov 19:
   The customer asked".
4. The Renew box again: charged in full now picked, and why. Half off picked by hand, paying by
   card. The invoice opened as a draft with two lines, the second the half off.
5. The property: this year's plan, and under it "Renewal: awaiting payment", half the price,
   what was decided, the card note and the draft. No Renew button. Needs attention: "The renewal
   was made Thu, Nov 19 and is not paid, so the new plan year has not started."
6. End plan on this year's plan: refused, "This plan has a renewal waiting to be paid. End the
   renewal first." Cancel the renewal: done, the invoice gone, the Renew button back.
7. Renewed again, charged in full, by check with its number. One line. Finalised and marked
   paid.
8. The property after: "Renewed Nov 19, 2026 … Paid. The plan year starts Dec 19, 2026. Renews
   Dec 19, 2027." Three inspections: "Inspection owed from last plan year, do it by Feb 17,
   2027, or it is lost" with its ticket and no Push back, and the new year's two, not yet due.
   Needs attention: "An inspection owed from last plan year is not done. It is lost after Wed,
   Feb 17."

No page error. The count of notices was the same before and after: nobody was sent one. Every
temporary row, the invoice's PDF and the history rows the trial wrote were removed, and the
ticket and plan numbers put back.

**Two things the browser run changed.** The plan in force after a renewal now says "Renewed"
and "The plan year starts" for a year that has not begun; it had said "Signed" and "started".
The renewal row in Needs attention now shows what is left to pay, not the full price.

**Tests.** `src/lib/roof-care-renewal-nov19.test.ts` (43). The amounts in it, and in two older
Roof Care tests, are made up and match no plan price.

## The database change

`supabase/migrations/20261119800000_roof_care_renewal.sql`, applied to the live database on
Nov 19. Each function on the live database was compared with the file by fingerprint and
matched.

- `roof_care_plans`: `renewed_from`, `renewal_choice`, `renewal_credit`, `renewal_owed`. One
  plan in force and one waiting per property, in place of one of either. One renewal per plan.
- `roof_care_visits`: `customer_asked`, `carried_from`, `lost_on`, and the kind `carried`.
- `roof_care_renewal_offer`, `roof_care_renew`: new, for the office.
- `roof_care_push_back`: the "customer asked" tick. A page published before this still works.
- `roof_care_start`: for a renewal it closes the old year and carries or drops what is owed.
- `roof_care_end`: refuses a plan whose renewal waits.
- `roof_care_make_tickets`: the morning run first marks lost the carried inspections whose 60
  days are over (`roof_care_lapse_carried`).

## Left for the owner

1. The terms say nothing of renewal: the half off and the 60 days are not on the agreement.
2. A plan past its renewal date stays in force until it is renewed or a manager ends it.
3. Neither inspection done, and ours, makes the renewal free. That follows from his half off
   rule and he has not been asked about it in so many words.
4. Nothing sends the renewal to the customer by itself. The office sends the invoice.
