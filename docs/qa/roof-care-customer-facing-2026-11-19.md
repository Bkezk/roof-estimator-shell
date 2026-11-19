# Roof Care: the sign-up the customer reads, the plan's benefits, the agreement by email

The owner, Nov 19, late, with a picture of the sign-up as it was:

> the care plan menu in the second screenshot will likely be customer facing so we need it to be
> visually appealing, explain the plans, and the verbiage should be as if a customer is reading
> it, also if the pay by card is selected at the end it needs to reroute to the stripe checkout
> once that's set up … the terms need to be emailed to the customer at signup as well as a
> receipt ideally.

And, in his next message:

> we need to ensure one property doesnt get mulitple care plans so if there is a ticket there
> where a care plan is already present if they click care plan it pops up the plan they are
> currently on and its benefits. we also need to ensure everything related to the care plan is
> labeled and keeps track of what it should as far as associated with the property tracking
> repair allocation and amount of free inspections/other benefits that have already been given.

No price or amount of the office's is in this file.

## What changed

| Before                                                                    | Now                                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The sign-up spoke about the customer: "How they are paying", "Who agreed" | It speaks to them: "How would you like to pay for the year?", "Your name", "I have read these terms and agree to them." |
| Each plan was a name and a price                                          | Each plan is a card: its one line, the price, and what it includes, with the recommended one marked                     |
| The plans showed only after a roof size was typed                         | The three plans are explained at once. The prices join them when the roof's size is in                                  |
| One long form                                                             | Five numbered parts: your roof, pick your plan, your first inspection, how you pay, your agreement                      |
| The office's notes sat among the customer's boxes                         | They are set apart at the bottom, marked as JBK's                                                                       |
| The plan kept no email address                                            | The sign-up asks for one, and the office can add or correct it on the plan                                              |
| Nothing was sent to the customer                                          | The agreement is emailed at sign-up and the receipt when the payment is received                                        |
| Care Plan on a property with a plan showed the plan's inspections         | It also shows everything the plan includes and "Used this plan year"                                                    |
| What was used was three separate lines                                    | One tally: inspections, minor repairs, leak calls with no trip charge, storm inspection                                 |

## One plan to a property

This was already the database's rule and it is unchanged: a sign-up is refused when the
property has a plan in force or one waiting for its payment, and two indexes hold it. The Care
Plan button opens the plan that is there, never a second sign-up. Proven again today in a
rolled-back trial (below) and in the browser.

## What each plan includes

The wording follows the Roof Care Plans sheet. The numbers in it are not in the code: the
minor repairs each year, the leak calls with no trip charge and the storm inspections come from
the plan settings (`roof_care_benefits()`), and for a signed plan from its own record. A test
fails if a dollar amount is typed into `src/lib/roof-care-benefits.ts`.

## The tally

"Used this plan year" lists only what the plan includes.

- Inspections: done of two.
- Minor repairs: used, of the year's amount, and what is left.
- Leak calls with no trip charge: used of the year's number.
- Storm inspection: used of the year's number. One is used when it is asked for.

The repairs and the leak calls are counted from invoices. A person who does not see invoices is
told what the plan includes and not what was billed.

## The emails

- The agreement: the plan, the property, the price, how they pay, the first inspection, what
  the plan includes, and every term that was agreed, word for word, with the version.
- The receipt: what was paid and when, the invoice number, and the plan year it bought.
- Both are tried at once where they are made, and again by the scheduled run twice an hour
  until they have gone. Each is claimed before it is sent, so two runs send one between them.
- A send that fails is put back with why, and the plan says why.
- Nothing older than 30 days is sent. A plan that agreed to an older set of terms gets no
  agreement, because only the current set is on file to send.
- A renewal's emails go where last year's went.

Email needs two secrets in Lovable Cloud that are not there yet: `RESEND_API_KEY`, and
`NOTIFY_FROM_EMAIL` on a domain the email service has verified. Until both are in, nothing is
sent and the plan says "Email is not set up on the site yet." A plan signed in that time gets
its agreement once they are in, if it is under 30 days old.

## Card

The customer picks Check or Card. Card says "Our office will contact you to take your card
payment." When Stripe is set up, signing with Card sends the customer to Stripe's checkout.
`AGENTS.md` carries the reminder.

## Proof

Tests: `src/lib/roof-care-customer-facing-nov19.test.ts`, 24 tests. Six older pins were updated
with dated notes where the wording changed.

Live database, one trial rolled back at the end, 14 checks, all as expected:

1. `roof_care_benefits()` answers for the three plans, and Roof Watch has no repairs amount.
2. A plan signed takes the settings' repairs amount and leak calls.
3. A second sign-up at the same property is refused.
4. An email is saved lower case and trimmed.
5. A bad address is refused.
6. The same address again keeps the sent stamps.
7. A changed address clears them.
8. A blank clears the address.
9. A technician who did not sign the plan up cannot change it.
10. A technician can read what the plans include.
11. The person who signed it up can change it while it waits for its payment.
12. Not once the plan is in force.
13. Nobody signed out can read the numbers.
14. Neither function can be run without signing in.

Browser, test customer's "site 2" only, desktop and phone width:

- Care Plan on a property with no plan opens the sign-up. Three cards show before any price,
  none can be picked. After the size, three prices show and the five parts.
- A bad email holds the button. No email is allowed, with a line saying no copy can be sent.
- Signed with Card: the plan was made, waiting for its payment, with the email on it.
- Care Plan again opened the plan, not a sign-up, with what it includes open.
- After the payment (by SQL, with a storm inspection added): the pop-up showed the eleven lines
  Roof Guard includes and the tally of four rows.
- No page errors. No notice was sent. The temporary plan and its invoice were removed.

Not proven: a real email arriving. The local server cannot send, and email is not set up on
the site. The sending is proven by tests with a stand-in sender.
