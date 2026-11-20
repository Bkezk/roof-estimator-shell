# Roof Care break test fixes: the plan screens and the inspections (Nov 20, 2026)

The break test of Nov 20 found 31 things. The owner chose which to fix. These eight were built
together: 4, 7, 8, 9, 20, 21, 27 and 29. The rules are in `docs/roof-care-plans.md` ("Break
test fixes of Nov 20"). This is what was run to prove them.

Database changes, applied by hand and checked function by function against their files:
`20261120650000` (a technician's reads, and the day's new columns), `20261120660000` (skip),
`20261120670000` (no access, storm), `20261120680000` (the size check), `20261120690000`
(renewal). Tests: `src/lib/roof-care-break-fixes-plan-nov20.test.ts`.

## How it was tried

Every trial ran on the live database inside one transaction that was rolled back at its end. Each
made its own temporary property under the test customer, signed a plan through the sign-up
function as a real kind of person (a technician, an office user, an admin), and started it. No
amount is written here: the prices are the live ones and stay out of the repository.

The browser run used the test login, switched in turn to a technician, an admin and an office
user and put back each time, on one temporary ticket and one temporary plan at the test
customer's property. Nothing was pressed that sends a notice: adding a storm inspection, renewing
and recording "no access" were opened and cancelled.

## 4. The typed roof size against the map

The break test's line: a technician signs a property the map measures at 60,000 sq ft as 1 sq ft,
and it is saved at the smallest price.

| Tried                                                    | Result                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Technician, 1 sq ft, map 60,000                          | Refused: "The map shows about 60,000 sq ft of roof at this property, and 1 sq ft was typed: more than 20% smaller. Check the size and type the whole roof. If the typed size is right, a manager or an admin signs this plan up: they can confirm it." |
| Technician or office user sending the tick themselves    | Refused, the same words                                                                                                                                                                                                                                |
| Office user, 47,999 sq ft                                | Refused                                                                                                                                                                                                                                                |
| Office user, 48,000 sq ft (exactly 80%) and 70,000 sq ft | Saved, the map's size kept beside it                                                                                                                                                                                                                   |
| Admin, 1 sq ft, no tick                                  | Refused: 'Tick "The typed size is right" …'                                                                                                                                                                                                            |
| Admin, 1 sq ft, ticked                                   | Saved, with the admin's name and the day                                                                                                                                                                                                               |
| No size on the map, technician, 20,000 sq ft             | Saved, marked as not checked                                                                                                                                                                                                                           |
| Confirming the mark: technician, office user             | Refused: "Only a manager or an admin confirms a plan's roof size"                                                                                                                                                                                      |
| Confirming the mark: admin                               | Mark off, name and day kept; a second confirm is refused                                                                                                                                                                                               |

In the browser, as a technician: the sign-up said the same words under the size box, offered no
tick, and held the button with "Still needed: a roof size that matches the map, or a manager to
sign it; …". As an admin, a plan marked as not checked showed "Roof size 55,000 sq ft: typed by
hand, not checked against the map" with Confirm the roof size, and after the press "confirmed by"
the admin.

## 7. Storm inspection

The break test's line: three presses in a day made three, two of them billed; a deleted storm
ticket came back each morning.

- First press by an office user: included, with their name kept.
- Second press the same day: refused, "A storm inspection was already added to this plan today
  by (name) at 2:00 PM. To add a second one the same day, open the plan, press Storm inspection
  and confirm it there."
- Confirmed as a second, but not as a billed one: refused, as before this change.
- Confirmed both: added as a billed one.
- An office user deleting the storm ticket: refused, in words that point to Take off.
- An office user taking it off: refused. An admin: the inspection and its ticket went; the billed
  one, not started and on no invoice, became the included one.
- A started one: refused.
- The morning run afterwards: one storm inspection, one live ticket. Nothing came back.

In the browser the box said who added one today and when, and held its button until the tick.
Take off removed the inspection from the plan.

## 8. No access

The break test's line: the free record taken off as a mistake; the one left stayed charged and
the next was charged too.

- Three visits by a technician: free, charged, charged (the first free held, as before).
- A technician taking one off: refused.
- An admin takes the free one off: the next in date order became free, with a note in its
  ticket's Activity; the one after stayed charged; the next visit would be charged.
- With the second one's return trip on an invoice: taking that one off is refused; taking the
  free one off leaves the billed one as billed and says so, and the third became the free one.

## 9. Renewal

The break test's lines: the offer said "charge in full" and an office user took the price of an
inspection off anyway; a plan that expired 435 days before was renewed with the credit.

- Rule says full (the inspection is not late yet). Office user picks half off: refused, "This
  renewal is charged in full, and the inspection still owed stays owed: it is not late yet.
  Taking its price off instead is for a manager or an admin. …". Picks full: saved. An admin
  picks half off: saved with the credit.
- Rule says half off (late, nobody asked). Office user picks full: refused. Picks half off: saved.
- Expired 60 days ago: still owed, credit offered. Expired 61 days ago: nothing owed, no credit.
- An admin renews a plan that expired 435 days ago, asking for half off: saved at the full price,
  no credit, nothing owed; once paid, nothing was carried and the new year had its two
  inspections.
- Held as before: too early is refused, a price that changed is refused, a technician is refused.

In the browser, as an office user, the other answer was greyed with "Only a manager or an admin
can pick the other answer."; as an admin both could be picked.

## 20. Skip this inspection

The break test's line: deleted plan tickets come back each morning.

- An admin deleting the inspection's ticket, the site's way and outright: refused, "Ticket #… is
  a Roof Care plan inspection, so it is not deleted: the site would make it again. To drop it,
  open Care Plan at the property and press Skip this inspection (a manager or an admin). It then
  counts as an inspection still owed to the customer."
- Skip with no reason: refused. By an office user: refused.
- An admin skips: the inspection is marked with the day, the reason and the name; its ticket is
  off the board with a note. After two runs of the morning job: no ticket for it.
- What reads it: the renewal still counts it owed, the refund counts it as not done. An
  inspection not yet due is skipped the same way, with no ticket to take off.
- Skipped, then renewed in full and paid: it came into the new year as a carried inspection, no
  longer skipped, with its ticket.
- The ticket put back from Deleted: no longer skipped. A done one: not skipped.
- Ending the plan still takes its open tickets off.

## 21 and 27. A technician's plan

The break test's lines: the technician read the plan's price, drive charge and refund sums from
the database, and the amount on his own no access record; his pop-up said "1 of 2 done" with both
done.

- As a technician, asked straight: the plan table, the inspection table and the no access table
  each answered nothing. The office user's read was unchanged.
- The technician's plan answer held no price, list price, drive, refund, credit or card amount,
  and no inspection carried an amount. His no access records came back with no amount.
- With the first inspection's ticket on somebody else and done, and his own done: he could read
  one of the two tickets; the answer said both done.

In the browser, as a technician: the Care Plan button and pop-up read "2 of 2 inspections done"
with neither ticket his, each named and not linked. The only dollar amount on the pop-up was the
minor repairs the plan includes a year. Sign-up, the No access box (opened, his record listed
with no amount, cancelled) and the cleaning question (answered Yes) all worked.

## 29. The sign-up's words

- At the start: "Still needed: the roof size, then Show my price; a plan; when the first
  inspection is; how you are paying; your name; the tick that you agree to the terms." The line
  shortened as each was given and went when the button could be pressed.
- A size of 0 or below: "Type the roof's size in square feet: a number above 0". A drive below
  zero: "The drive to this property came out below zero, which cannot be right. Ask an admin to
  check where the property is on the map." A size of 9,000,000: the custom-quote line.
- Two presses in the same instant: one request, one message, the success.

The card payment with no amount shows its own words in the payments change of the same day.

## Clean-up

Every trial was rolled back. The browser's temporary ticket, plan and records were removed, the
test property's map point and size were cleared again, the ticket and plan number counters were
put back, and the test login is an admin again.
