# Roof Care: no payment before the roof size is confirmed, and the second test payment, Nov 24, 2026

The owner ran his second test payment, from a customer's own card payment link, and wrote:

- "doesnt clicking care plan open the same info? does the plan need to show on the property like
  that if the info is all available by clicking the care plan button?"
- "the non paid plan probably needs a rework as well its a bit messy. also how do you confirm
  payment was recieved if theyve sent a check or something."
- "ideally we arent requesting payment or taking payment until the roof size is confirmed. the
  only reason we take card payment when care plan is selceted on a ticket workflow is the tech
  can measure the roof there." Of holding the payment link until then: "yes thats a good idea
  and on site sign up is ok".
- "it does stay on this page for longer than id like after payment", of the card page.
- "the receipt for that way didnt show what the roof plan included or the terms. like the other
  confirmation did."

## 1. The second test payment: proven

On the live database, plan RC-1004 at the test customer's second property, in Stripe's test mode.

- Signed 19:19:15 UTC. The agreement went the same second, and the plan was not marked as sent
  the link: so the agreement of that afternoon's change, with no Pay by card button, is what
  went.
- The office emailed the link from the plan at 19:19:54.
- The card payment landed at 19:20:45. The plan started, its invoice was marked paid in full by
  card, and both inspections were made.
- The receipt went at 19:20:50.

With the first test payment (`docs/qa/roof-care-plan-card-and-agreement-2026-11-24.md`), both
ways to pay by card are proven in test mode.

## 2. No payment is asked for until the roof size is confirmed

A plan's price follows its roof size. A size typed by hand where the map had none to check it
is marked "not checked", and a manager or an admin confirms it on the plan.

- **The payment link.** While the size is not confirmed, the Card payment link box gives no link
  and cannot email one. It says: "The roof size is not confirmed yet, so no payment is asked
  for. A manager or an admin confirms it on the plan first."
- **The card page.** The same, for "Open the card payment page" on the plan and for the card
  page that opens at the end of a sign-up.
- **On a ticket it is as before.** The technician is on the roof and can measure it, so a
  sign-up from a ticket opens the card page at once, and "Open the card payment page" works
  there. The two buttons know they are on a ticket because the ticket's page and the workflow
  hand them the ticket.
- **A sign-up off a ticket** with Card and a size that is not confirmed is signed, and says: "No
  payment was asked for: the roof size is not confirmed yet. A manager or an admin confirms it
  on the plan, then sends the payment link."
- A size the map agreed with is not held: it was checked.
- Paying by check is not blocked. The roof size is the first step on the plan either way.

## 3. The plan on a property is shown in short

The property page and the customer page show the plan, when it renews and what it costs, and
only what waits for somebody: a roof size to confirm, an email that has not gone, a card payment
whose invoice is open, the renewal, a refund. One line says where the rest is. The Care Plan
button opens the whole plan, as it did: the inspections, the tally, what the plan includes, the
plan's details and End plan.

## 4. A plan that waits for its payment is shown as steps

In order, each in a row of its own, numbered, and ticked when it is done:

1. **Confirm the roof size.** The size, and the button for a manager or an admin.
2. **Ask for the payment.** By card: the card page and the payment link, or why they are held.
   By check: "Send the invoice", with the invoice and whether it is a draft, final or part paid.
3. **Record the payment.** By card: "A card payment is recorded by itself, and the plan starts
   that minute. Nothing has to be marked." By check: "When the check arrives, open the invoice
   and press Mark paid. The plan starts that day and its inspections are made."

An agreement email that has not gone, or has no address, stays in sight under the steps. One
that has gone is folded.

## 5. The receipt says what the plan includes and its terms

The receipt now ends with "What the plan includes" and "The terms you agreed to", word for
word, as the agreement does. A customer keeps the receipt, so it stands alone. When a plan's set
of terms is not on file, the terms are left out and the receipt still goes.

## 6. Back from the card page

Measured on the published site: our own page answered in 0.5 to 1.8 seconds. The rest of the
wait is the card company's own page finishing the payment, which the site cannot shorten.

- Our page used to say "One moment" until it had read the plan. It now says the thanks at once.
- It then looks for the payment after 1.5 seconds, not 4, and a few more times after that.

## The test rows are removed

After both payments were checked: the four test plans (RC-1001 to RC-1004) with their two
invoices, four inspections and two card payment rows, the inspection ticket they made, twenty
notices about them and eight history rows. The plan numbers start again at RC-1001, and the next
ticket number follows the last real ticket. Nothing else at the test customer was touched.

## Proof

- Tests: `src/lib/roof-care-size-before-payment-nov24.test.ts`, 16 tests. Thirteen fail on the
  code of that afternoon. Eight older tests that pinned the old layout were changed to the new
  rules.
- Checks: lint 0 errors (16 warnings, as before), types clean, 681 test files and 10,435 tests
  pass, the build completes.
- In a browser on the test server, signed in, at desktop width and a phone's: a paid plan in
  short on the property and whole in the pop-up; and a plan waiting for payment, made for the
  look and removed after, as a card plan with the size not confirmed and as a check plan with
  the size confirmed. No sideways scroll and no page error.

## Not proven

- The hold on the published site, with Stripe: it needs the publish. One sign-up with Card from
  a property, with a hand-typed size, shows it.
- The new receipt in a real inbox: the next test payment shows it.
- The test server has no Stripe, so the card page and the link box were not pressed there.
