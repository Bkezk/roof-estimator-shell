# Roof Care: the plan is paid for the year before it starts

The owner, Nov 19:

> i think we are going to do payment up front rather than at time of service via something like
> stripe so we dont have to fight apathy

and later the same day, "they can pay up front by check". This is step 1: paying by check, with
no card yet.

No amount of the office's is in this file. The trials used the live setup's own prices on the
test customer.

## What changed

| Before                                                          | Now                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A plan was in force the moment it was signed                    | A signed plan waits for its payment. Nothing is scheduled for it                             |
| Each inspection billed half the yearly price, after it was done | One invoice for the year belongs to the plan, numbered after it (plan 1001: invoice RC-1001) |
| The plan year ran from the day it was signed                    | It runs from the day the payment is received                                                 |
| The first inspection could be "today", before a dollar was paid | The first inspection is counted from the payment: at once, in so many days, or next window   |
| A plan that nobody billed looked the same as one that was paid  | Needs attention lists every plan signed and not paid, with what the office does next         |
| The sign-up showed two halves                                   | It shows the year's price, "Paid in full before the plan starts"                             |

What does not change: the price, the price floor, the drive, the two windows, push back, the
minor repairs a plan includes, storm inspections.

## How it works

1. **The sign-up** (anyone who could sign a customer up before) makes the plan "awaiting
   payment". It keeps the choice for the first inspection.
2. **The invoice.** When the person signing makes invoices, the plan's invoice is made at once
   as a draft. A technician cannot make invoices: the plan then says "No invoice has been made"
   to the office, with a button. The office finalises the draft and sends it, as any invoice.
3. **The payment.** The office marks the invoice paid when the check arrives. Paid in full, the
   database starts the plan in the same step, whoever marks it and from whichever screen. A part
   payment leaves the plan waiting.
4. **The inspections** are dated from the day the payment is recorded, so none starts out late.
   The plan year itself starts on the payment's own date. A ticket due within two weeks is made
   at once and announced like any new ticket.
5. **An inspection's own invoice** bills nothing and says "included in the plan". It is still
   made when the ticket is authorized, so the visit's cost is counted on the Owner page.
6. **A plan never paid** is ended by a manager. Its draft invoice is removed, or its final
   invoice with nothing paid on it is voided.

A plan signed by a page published before this change keeps the old way: in force at once, half
billed at each inspection. Both kinds live side by side.

## The terms

Three of the ten changed, so the set has a new date (2026-11-19). They wait for the owner's yes:

- 2: "The yearly price is paid in full before the plan starts. We send one invoice for the year."
- 3: "The plan runs for twelve months from the day we receive your payment."
- 9: "Either of us can end the plan in writing. We refund the share for inspections not yet
  done, less any minor repairs the plan has already covered."

Term 9 says what the owner decided. The site does not work a refund out yet.

## How it was proven

**The live database, in a transaction that was rolled back**, after the change was applied:

| Check                                                           | Result                                                |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| An office user signs a property up                              | Awaiting payment, numbered, no inspection, no ticket  |
| A second sign-up at the property, by the new way and by the old | Both refused in plain words                           |
| A technician with no ticket at the property                     | Refused, as before                                    |
| An invoice with no ticket, bid or plan                          | Refused                                               |
| A second live invoice for the same plan                         | Refused                                               |
| The plan's invoice finalised                                    | The plan still waits                                  |
| Part of it paid                                                 | The plan still waits                                  |
| Paid in full, dated three days back                             | In force; the year starts on the payment's date       |
| The first inspection, chosen as ten days after the payment      | Ten days from the day it was recorded, billing 0      |
| The second inspection                                           | In the spring window, at least 120 days on, billing 0 |
| The ticket for an inspection due within two weeks               | Made                                                  |
| The invoice marked paid a second time                           | Nothing added                                         |
| An office user who is not a manager ends an unpaid plan         | Refused                                               |
| A manager ends it                                               | Ended; its unpaid final invoice void                  |
| The property signed again after that                            | Allowed, with the next number                         |
| A signed-in person calling the plan's start directly            | No permission                                         |

**A browser on the current code**, as an admin, on the test customer:

- The sign-up: the year's price on each plan with "Paid in full before the plan starts", the
  three choices for the first inspection counted from the payment, the dates with the note that
  they move with the payment, the new terms, the button "Sign the plan".
- After signing: the property shows "awaiting payment", the plan's number, the price, the first
  inspection's choice, and "Invoice #… is a draft. Finalise it and send it to the customer." The
  Care Plan button reads "Awaiting payment" and opens the plan, not a second sign-up.
- The invoice: named after the plan and the property, with a link back to the property. One
  line. No "Another invoice" button. Finalised, its PDF stored. "Send it now?" was declined.
- The property again: "Invoice #… is waiting to be paid. Mark it paid when the payment arrives."
- Marked paid by check with a reference. The property then shows the plan in force: "Paid, and
  started", the renewal a year on, the minor repairs, and both inspections with their windows.

The first inspection was chosen as "next window", so no ticket was made and nobody was sent a
notice. The notice count was the same before and after. The plan, its inspections, its invoice,
the stored PDF and the history rows were removed, and the plan numbers start at 1001 again.

**Tests.** `src/lib/roof-care-pay-first-nov19.test.ts` (40). Eleven older tests pinned the old
flow and were changed with a dated note.

## The database change

`supabase/migrations/20261119600000_roof_care_pay_first.sql`, applied to the live database on
Nov 19 and checked there: the waiting status and five columns on `roof_care_plans`, the plan
number series, `invoices.roof_care_plan_id` with the one-parent and one-live-invoice rules,
`roof_care_sign_up_await_payment`, `roof_care_start`, the rule `invoices_plan_paid`, and
`roof_care_end` for a plan never paid.
