# Roof Care: the owner's go-aheads of Nov 19, night

The owner, on the numbered list of issues: "Go on 1, 2, 4 (build the infrastructure for this and
I'll add the stripe backend when I get that done), 5, 7, 8, 9, 13."

This record covers the Roof Care ones: 4, 5, 7, 9 and 13. Items 1 and 2 are in
`docs/qa/bids-draft-restore-2026-11-19.md`. Item 8 and the workflow part of 5 are in
`docs/qa/service-cleaning-ticks-no-address-2026-11-19.md`.

No price or amount of the office's is in this file.

## 4. Paying by card online: the site's side

| Before                                         | Now                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Card always meant the office takes the card    | With Stripe set up, signing with Card goes on to Stripe's checkout page      |
| A payment was only ever typed in by the office | Stripe's signed message records the payment on the plan, and the plan starts |
| The office could not hand a customer a page    | A plan waiting for a card payment has "Open the card payment page"           |

It is off until two secrets are in Lovable Cloud (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`) and Stripe has a webhook endpoint at the site's address plus
`/api/stripe/webhook`. Until then everything reads and works as before.

How a payment is trusted:

- The message must carry Stripe's signature, made with the endpoint's secret over the exact
  body, and be under five minutes old. Anything else is refused and nothing is recorded.
- Only a paid Roof Care checkout in dollars counts. Other events are acknowledged and left.
- The amount must cover what is owed: the final invoice's balance, else the plan's price less
  any renewal credit. Too little is refused and the admins are told.
- A payment is recorded once. The same message again changes nothing.
- Only the server's own key can record a card payment. No signed-in person can.

What happens when it is recorded:

- The plan's final invoice is marked paid by card, which starts the plan by the invoice's rule.
- With no final invoice yet, the plan starts and says its invoice still has to be finalised
  and marked paid.
- A payment for a plan that was not waiting is recorded and flagged: it may have been paid twice.
- The admins and the managers get a notice. The receipt email goes when email is set up.

No Stripe library was added: one request makes the checkout page, and the signature is checked
with the platform's own HMAC.

Not proven: a real payment. There is no Stripe account yet. Everything up to Stripe's door and
from its message onward is proven by tests and by a live database trial.

## 5. The cleaning at an inspection, and the budget forecast

- Each of a plan's two inspections (and one carried from last plan year) is asked what the
  plan includes: drains and scuppers for Roof Care and Roof Guard, gutters for Roof Guard.
- Each is answered Yes or No. A No needs its reason.
- The plan year's tally shows "Done at 1 of 2 inspections" for each.
- The office marks Roof Guard's yearly budget forecast sent, and can take the mark off. The
  tally shows the day, or "Not sent yet".

## 7. An expired plan opens its renewal

Care Plan on a property whose plan has expired, and is not closed out, opens that plan with
Renew, not a new sign-up. A new sign-up would have dropped what the renewal owes the customer
for an inspection that was not done. A technician cannot renew, so on the roof the button reads
"The customer wants to renew" and sends it to the office with the technician's name on it. A
plan a manager closed out is over: there a new sign-up is right.

## 9. A refund of a year paid by card

The refund is less the card fee on the amount refunded. The fee's rate is two boxes on the plan
setup page, "Card fee, % of a payment" and "Card fee, flat sum per payment". Blank takes
nothing off. Term 9 says so, and the terms are version 2026-11-19.3.

A year counts as paid by card when it was paid online, or its invoice was marked paid by card,
or Card was chosen at sign-up and no invoice says otherwise.

## 13. The terms

A draft of sixteen added terms, each with its reason, and seven questions for an attorney, was
handed to the owner as a file. None of it is in use. It is not kept in this repository.

## Proof

Tests: `src/lib/roof-care-go-aheads-nov19.test.ts`, 29 tests. Thirteen older pins were updated
with dated notes.

Live database, two trials rolled back at the end, 21 checks, all as expected:

- Card payment: too little refused; no reference refused; paid in full with no invoice starts
  the plan today with two inspections and no ticket; the same payment again answers "already";
  a payment on a plan in force answers "not waiting"; with a final invoice the plan's bare
  price is not enough when the invoice is more; the full amount marks the invoice paid by card
  and the plan starts; signed-in people cannot run it.
- Refund: by card the fee is the settings' percent of the refund plus the flat sum, and the
  refund is the rest; the same year paid by check takes no fee.
- Cleaning: a No with no reason refused; drains Yes kept with who answered; gutters No with
  its reason, drains unchanged; a storm inspection refused; gutters on Roof Care refused; a
  technician with no ticket at the property refused.
- Forecast: Roof Care refused; a technician refused; the office marks it today; the mark comes
  off.
