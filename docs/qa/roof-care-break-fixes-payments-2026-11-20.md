# Roof Care break test, the payment fixes (Nov 20, 2026)

The owner asked for the Roof Care plans to be broken on purpose, then said which of the numbered
findings to fix. This is the record of eight of them: 1, 13, 19, 22, 23, 24, 26 and 28. The
numbered list itself is private (the office note `roof-care-break-test-2026-11-20`).

No price, cost or margin is written here. Every trial ran on temporary "ZZ" properties under the
test customer and was rolled back, or was removed after.

## The rules as built

**1. A payment taken back must not leave a plan running unseen.**
While a plan is in force, the paid invoice it runs on cannot be voided, deleted, or left holding
less than its total. The office ends the plan first (Care Plan on the property, End plan), and
the refund is worked there. While a plan waits for its payment, an invoice with a payment on it
is not voided until the payment is taken off. After a plan has ended with a refund owed, the
payment the refund was worked from stays while the refund stands. The database refuses these
for every signed-in person, an admin included, and the invoice screen says the same words before
it tries. The Owner page's Needs attention list has a red row for a plan in force with nothing
paid toward it. A manager's free year owes nothing and is not listed.

Example: a check for a plan bounces. The office opens the invoice and sets the payment to 0. It
is told "Roof Care plan RC-1042 is running on this invoice's payment. End the plan first…". It
ends the plan on the property, and the plan's inspections come off the board.

**13. The plan year never starts before the day the plan was signed.**
The paid day is held between the signing day and today, for the start of the year and for the
day kept on the plan. The invoice keeps whatever date was typed on it.

Example: a plan signed today, its invoice marked paid with a date 400 days back. The plan year
starts today and ends a year from today.

**19. "Next window" uses a window that is open today.**
When at least 14 days of an open window are left, the first inspection is due from today to
that window's end. With fewer days left, or no window open, it is the next window to open. The
second inspection keeps its rule.

Example: paid on Nov 20 with the fall window open to Dec 31. The first inspection is due Nov 20
to Dec 31, and the second in the spring window.

**22. The old sign-up is switched off.**
`roof_care_sign_up()` started a plan at once with nothing paid. No code of the site calls it.
The function is kept and no signed-in person can run it.

**23. A plan starts on its invoice only when the money is there.**
The invoice has to be for the plan's price less its renewal credit, to the cent, and its
payment has to cover it. Marking any other invoice paid is refused with the two amounts in the
message, and the plan keeps waiting. A part payment recorded the usual way leaves the invoice
Final, so the plan keeps waiting, as before. A manager's free year has no invoice and starts by
itself, as before.

**24. The database refuses what the screens never offer.**

- A void invoice stays void.
- A minor repairs line or a leak call line goes only on an invoice of a ticket at the plan's own
  property, or on the plan's own inspection, and only while the plan is in force.
- The minor repairs line takes no more off than the invoice's other lines add up to. The leak
  call line takes off no more travel than the invoice charges. Checked when the line is written,
  whatever order the lines are written in, and again when the draft is made final.
- A return trip is on an invoice once, and only for a visit that was charged. Its price is not
  held to the recorded amount.

**26. Card payments.**
Every card payment is its own row (`roof_care_card_payments`), written only by the server's own
key, and a payment reference is taken once. A payment that covers what is owed starts the plan
and marks its waiting invoice, draft or final, final and paid by card with the reference. A plan
that waits with no invoice gets its invoice made first. A payment for a plan that is not waiting
(paid another way already, ended, or cancelled while it waited), or one that does not cover what
is owed, changes nothing on the plan: it is kept as money to send back, and the admins and
managers are told how much and why. An amount over what was owed starts the plan and they are
told what is over. Stripe is answered 200 for all of these, so it does not send them again.

**28. Who may run what.**
`roof_care_make_tickets()` is the morning run's and the plan functions' own: no signed-in person
runs it. `roof_care_price()` and `roof_care_windows()` answer only a signed-in person with
Service or Customers access. A technician who can sign a customer up still gets a price.

## Where it is

| What                  | File                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| 13, 19, 23            | `supabase/migrations/20261120600000_roof_care_start_rules.sql`       |
| 1, 24                 | `supabase/migrations/20261120610000_roof_care_invoice_guard.sql`     |
| 26                    | `supabase/migrations/20261120620000_roof_care_card_payments.sql`     |
| 22, 28                | `supabase/migrations/20261120630000_roof_care_rights.sql`            |
| 1, the server's words | `src/lib/invoice-payment.ts`, `src/lib/invoices.functions.ts`        |
| 1, Needs attention    | `src/lib/owner-attention.ts`, `src/lib/owner-attention.functions.ts` |
| 26, the site's side   | `src/lib/roof-care-checkout.ts`, `src/routes/api.stripe.webhook.ts`  |
| The new table's types | `src/integrations/supabase/types.ts` (added by hand)                 |
| Tests                 | `src/lib/roof-care-break-fixes-payments-nov20.test.ts`               |

The four migrations were applied to the live database on Nov 20 and each function's text was
checked against its file by fingerprint.

## Proof

**Tests.** 25 new tests, all passing. They read the four migrations and call the new rules, so
none of them can pass on the code before this change. Three older tests were brought up to date
with a dated note (`roof-care-go-aheads-nov19.test.ts`, twice; `invoice-payment.test.ts`).

**Rolled-back trials on the live database**, each on its own temporary property. The first
column is what the break test saw; the second is the answer now.

| Break test                                                         | Now                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1. Payment taken off: plan active, ticket on the board             | Refused: "…is running on this invoice's payment. End the plan first…"      |
| 1. Paid invoice voided: plan active                                | Refused, same words                                                        |
| 1. Admin deletes the paid invoice: plan active, no invoice         | Refused, same words                                                        |
| 1. (new) Payment taken off after a refund is owed                  | Refused: "…ended with a refund of $… worked from this payment…"            |
| 13. Paid date 400 days back: year already over, expired next day   | Paid and started on the signing day; still active after the morning run    |
| 19. Next window skips the open window                              | First inspection due today to the end of the open window                   |
| 22. Old sign-up, admin and technician: saved, active, nothing paid | Refused for both: permission denied                                        |
| 23. Invoice of 1 dollar marked paid: plan active                   | Refused: "This invoice is for $1.00 and plan RC-… costs $…"                |
| 23. Status paid with paid amount 0: plan active                    | Refused: "Only $0.00 of this invoice's $… is paid…"                        |
| 23. Set to paid holding part of the total: plan active             | Refused, same words                                                        |
| 24. Invoice A voided, credit used on B, A un-voided                | Refused: "A void invoice stays void."                                      |
| 24. Property 1 takes from the plan of property 2                   | Refused: "This Roof Care plan is at another property."                     |
| 24. From a plan still waiting for its payment                      | Refused: "…is waiting for its payment, so it has not started."             |
| 24. From a plan that has ended                                     | Refused: "This Roof Care plan has ended."                                  |
| 24. Leak call line far over the travel charged                     | Refused: "…cannot take off more travel than the invoice charges"           |
| 24. Plan line far over the invoice's other lines                   | Refused: "…cannot take more off an invoice than its other lines add up to" |
| 24. Same return trip twice on one invoice                          | Refused: "This return trip is already on this invoice."                    |
| 24. Trip line for the free first trip                              | Refused: "That visit was rescheduled at no charge…"                        |
| 26. Card payment for a plan paid by check: plan turned to card     | Kept as money to send back; plan still check, refund has no card fee       |
| 26. Second charge, new reference: first reference written over     | Kept as money to send back; plan keeps the first reference; two rows       |
| 26. Card on a plan cancelled while it waited: nothing recorded     | Kept as money to send back, reason "ended"                                 |
| 26. Card over the invoice's amount: nothing said                   | Plan started, invoice paid at its total, the amount over kept on the row   |
| 26. Card while the invoice is a draft: invoice left unpaid         | Invoice made final and paid by card with the reference; plan started       |
| 26. Card with no amount: a message with a blank in it              | Refused: "A card payment needs its amount"                                 |
| 28. A person with no access may make tickets, price                | Refused: make tickets (permission denied), price and windows (no access)   |

**What held before still holds**, in the same trials: a technician with a ticket at the property
signs a customer up, and one with no ticket there is refused; a plan paid by check starts on the
payment and its tickets are made; the manager's free year starts with no invoice; a part payment
leaves the plan waiting; a void invoice followed by a new one starts the plan; the minor repairs
cap; a void gives its credit back; the automatic credit line; Rebuild, with all lines written in
one statement and the plan's line first; the credit toward a return trip on the inspection's own
invoice; the morning run as the database; 18 refund sums by check and by card, each equal to the
sum worked by hand.

**As a signed-in admin, a real session**, on the test property "site 2": taking the payment off,
lowering it, voiding and deleting a plan's paid invoice were each refused in the words above;
the old sign-up and the ticket maker answered permission denied; the price answered; the card
payments table could be read and not written. With that plan's invoice then set unpaid by the
database itself, the Owner page listed the row "The plan is in force and nothing is recorded as
paid toward it…" with its link to the invoice. The plan and its invoice were removed after.

**Cleanup.** After the last trial: 55 tickets (highest 6075), 1 invoice, 0 plans, 0 card
payments, 276 notifications, 2 offers, no "ZZ" property, and the test login is an admin as
before. The ticket and plan number counters were set back from the rows that exist.
