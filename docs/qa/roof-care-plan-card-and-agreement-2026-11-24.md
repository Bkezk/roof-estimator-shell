# Roof Care: the plan card's layout and the agreement email, Nov 24, 2026

The owner ran his first test payment and wrote, with pictures:

- "this is a bit messy once you have a care plan is there any way to make that part more
  visually friendly?", then of the same card on the customer page: "its very visually
  unappealing and difficult to read".
- "i got this email prompting me to pay by card even though stripe opened and i paid by card
  then. that would be confusing. also even if i didnt pay by card the office needs to review and
  then send the payment request after theyre sure of the roof size so even then the pay by card
  button isnt appropriate."
- "this isnt showing the suggested sq foot for some reason", and "what happens if you dont
  confirm the roof size or its incorrect?"

## 1. The plan card

Every word and every button the card had is still there. Only where they sit changed.

- The plan is in one box of its own on the property and on the customer page.
- **Top line.** The plan's badge and how many inspections are done on the left. When it renews
  and what it costs a year on the right.
- **Inspections.** One row each: its name, where it stands, when it is due and its ticket on the
  left; Push back and Skip at the right. The cleaning answers are the row's second line.
- **Used this plan year.** One small tile for each thing the plan gives, with a thin bar for how
  much of it is used. No bar for a reader who does not see invoices.
- **What the plan includes.** Folded, as before. Open in the Care Plan pop-up, as before.
- **Plan details.** A new fold: who signed and when, the roof size and who confirmed it, the card
  payment and its reference, where the agreement and the receipt went with Change the email, and
  the invoices that used the minor repairs.
- **Never folded:** a roof size that waits to be confirmed, with its button; an agreement or a
  receipt that has not gone; a card payment whose invoice is still open; a price that is still
  an estimate; running late; the renewal.
- **End plan** sits apart at the bottom right.
- On a ticket the short form is as it was: the badge, one sentence and that ticket's inspection.

## 2. The agreement email holds no Pay by card button

What happened in his test: the agreement email went out the second the plan was signed. He paid
on the card page a minute later. So the email asked him to pay for what he was already paying.

- The agreement never holds the payment link or a button now, for any plan.
- For a plan that pays by card and has not been paid when the email goes, it says one sentence in
  its place: "You chose to pay by card. If you have not paid yet, we will email you a secure
  payment link after we review your sign-up. Your plan starts the day we receive your payment."
- The payment request is the email the office sends from the plan: Card payment link, then Email
  it. That was already there. It is now the only way the link reaches a customer.
- Until somebody has sent it, that box says in amber: "Not emailed to the customer yet. The
  agreement does not hold this link: send it when the roof size is right."
- A plan signed from a public request with Card tells the office the same at the sign-up.
- The card page that opens at an on-site sign-up is unchanged.
- The "signed, not paid" notice 30 minutes after a card sign-up is unchanged. It already says to
  open the property to send the payment link.

## 3. Why no roof size was suggested, and what an unconfirmed size does

Read on the live database and in the code. Nothing was changed for this part.

- The test property's address is on the state's map as an address point with no building
  outline over it. The lookup of Nov 19 recorded the same for it. With no outline there is no
  area, so the sign-up has nothing to offer. 90 of the properties on file are like this, and 683
  have a size.
- A size typed where the map had none marks the plan "typed by hand, not checked against the
  map". The plan works in full: it can be paid, it starts, its inspections are made.
- It stays on the Owner page's Needs attention list, and in amber on the plan, until a manager
  or an admin presses Confirm the roof size. His test plan was confirmed that afternoon.
- Confirming only records who said the size is right.

## Proof

- Tests: `src/lib/roof-care-agreement-no-pay-button-nov24.test.ts`, 11 tests. Nine of them fail
  on the code of that afternoon. Three older tests that pinned the old email and the old cleaning
  line were changed to the new rule.
- Checks: lint 0 errors (16 warnings, as before), types clean, 680 test files and 10,419 tests
  pass, the build completes.
- In a browser on the test server, signed in, on the test customer's own paid plan: the card on
  the customer page and on the property page, at desktop width and at a phone's. Every line of
  the old card is on the new one or under Plan details. No sideways scroll and no page error.
- The test payment itself, on the live database: the plan active and paid by card, one payment
  row, its invoice paid in full, two inspections made, agreement and receipt sent, one "paid by
  card" notice to each of the five admins and managers. The agreement was stamped 62 seconds
  before the card payment.

## Not proven

- The new email and the amber line in the Card payment link box on the published site. They need
  the publish and a plan that waits for a card payment. The owner's second test, from the
  payment link, shows both.
- A plan that waits for its payment was not looked at in the new box in a browser: no such plan
  exists today.
