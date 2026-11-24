# Roof Care: a payment from a bank account, and the Stripe set-up review, Nov 24, 2026

The owner pasted the prompt Stripe gives a new account ("Stripe products I need: Payments,
Tax"). The site's Stripe side was already built, so it was read against Stripe's own pages
instead of rebuilt. Three things came out of it, and he said: "can you handle the rest of the
solutions you brought up in 1, 2, 3?"

## 1. Tax: nothing built, on purpose

A Roof Care plan is billed as a service with no sales tax. With Stripe Tax turned on, tax would
be added on top of the plan's price and the amount paid would no longer match the plan's
invoice. Stripe Tax stays off until the owner's accountant says a plan is taxable; then tax is
added to the plan's invoice and the payment page together.

## 2. A payment from a bank account

Stripe's bank payment (ACH) costs far less than a card on a plan's amount. The payment page
never fixed the ways to pay, so it offers a bank payment as soon as the owner turns it on in the
Stripe account. What was missing is how the site follows one. A bank payment is finished at the
checkout and clears up to four business days later, or fails.

- **Started.** Every admin and manager is told: "Bank payment started". Nothing is recorded as
  paid. The plan is marked as told, so the half-hour "signed, not paid: no card payment has come
  through" notice does not follow while the money is on its way.
- **Cleared.** Recorded as the plan's payment, as a card's is, and the plan starts. The notice
  says "paid by bank payment".
- **Failed.** Every admin and manager is told: "Bank payment failed", with what to do. Nothing
  is recorded. Until this, a failed bank payment told nobody.
- All three are under My account › Opportunity notices › Roof Care plan.

Stripe has to send one more event for this: `checkout.session.async_payment_failed`.

## 3. A restricted key

Stripe recommends a restricted key over the full secret key. The site only ever opens a payment
page, so the key needs one permission: Checkout Sessions, Write. The site has taken either kind
of key since Nov 24. The steps are on `docs/keys-and-secrets.md`. The key's value is the
owner's to make and to put in Lovable Cloud › Secrets.

## Where it lives

- Rules and words: `bankPlanEvent`, `bankPaymentNotice` and `cardPaidNotice` in
  `src/lib/roof-care-checkout.ts`.
- The handler: `src/routes/api.stripe.webhook.ts`.
- No database change.

## Proof

- Tests: `src/lib/roof-care-bank-payment-nov24.test.ts`, 15 tests. The ones of the handler fail
  on the code of that morning.
- Checks: lint 0 errors (16 warnings, as before), types clean, 679 test files and 10,407 tests
  pass, the build completes.

## Not proven

Any of it against Stripe itself. There is no Stripe account for the company yet. The first test
payment proves the card path; a bank payment needs its own test in the Stripe sandbox, which has
test bank accounts that clear and that fail.

## Stripe's plugin

The owner added Stripe's plugin to his Claude account that evening. It did not show up in the
session that did this work, so nothing in his Stripe account was read or changed by it.
