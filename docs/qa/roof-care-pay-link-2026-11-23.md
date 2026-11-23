# The customer's own card payment link, and Won on payment day (Nov 23, 2026)

The owner, on the new issues of the evening report: "1. A go, 2 go".

## 1. A card payment link the customer opens themselves

The problem: a customer who signs up through the QR page is at home, not at the office's screen.
The card payment page was only ever opened on the screen of whoever signed the plan.

What was built:

- **Every plan has a link of its own.** The site's address, `/pay/`, and a long random token
  that belongs to that one plan (`roof_care_plans.pay_token`, migration `20261123300000`).
- **The page the link opens** needs no sign-in. It shows the plan's name and number, the
  property's name, the amount for the year and one button, **Pay by card**, which opens the
  card payment page. After paying, the customer comes back to the same link and it says thank
  you and when the plan year runs to. It has the look of the two QR pages.
- **The payment starts the plan** exactly as a card payment does today: the same card page, the
  same message from the payment company, the same receipt.
- **The customer gets the link by email.** It is in the agreement email of a plan that pays by
  card, as a "Pay by card" button, when card payment is set up.
- **The office can copy it or send it again.** A plan that waits for a card payment has a
  **Card payment link** button: the link to copy into a text, and "Email it to <the customer>".
  Nothing is sent without a press. The plan says when the link was last emailed.
- **A plan signed from a public request with Card** no longer opens the card page on the
  office's screen. The sign-up says the customer pays from their own link, and where it is.

What a visitor can and cannot do with it:

- Only an address that is exactly `/pay/<token>` opens without a sign-in. Every other address
  still goes to the sign-in.
- The page answers about the one plan its token belongs to: the plan's name, the property's
  name and the amount. Nothing else of the customer, and nothing of anyone else.
- A made-up token, another shape of address and a plan that is over all get the same words:
  the link is not active, please call.
- Opening the page and pressing Pay are counted against the connection (30 an hour, 2,000 a day
  for everyone), by the same counter the QR pages use.
- The amount is worked out in one place for the office's card page and the customer's link
  (`planOwedCents`), so the two can never ask for different amounts.
- The payment company's own error words are never shown to a visitor.
- The page asks search engines not to list it and does not pass its address on to other sites.
- Nothing is granted to the anonymous role: the page's server functions read with the site's
  own key, as the two QR pages do.

It stays off until the owner sets up Stripe: until then the page says card payment is not
available and to call, and the office's box says "Paying by card online is not set up yet".
Emailing the link from the site also needs Email set up; copying it does not.

## 2. Won on the day the plan is paid

An opportunity made from a public request was set to Won when its plan was signed. A plan signed
and never paid then left a Won opportunity. Now:

- Signing the plan ties the request to it and changes no opportunity. The strip on the
  opportunity says "The plan is signed and waits for its payment. This opportunity turns Won the
  day the payment is received."
- The day the plan is paid and starts, the database sets the request's opportunity to Won and
  closes its follow-up, whichever way the payment arrived: a check recorded on the invoice, or
  the card. The strip then says "The plan is paid and has started."
- An opportunity somebody already set to Lost or No response, or deleted, is left as it is.
- A fault in this step can never stop a payment from being recorded: it is logged, the payment
  stands, and the opportunity is then set to Won by hand.

## Proof

Database, on the live database inside a trial that was rolled back:

- A new plan had a token; two plans had different tokens.
- Signed and not paid: the opportunity stayed Open and its follow-up stayed open.
- Paid: the opportunity became Won "by Payment received", its follow-up closed with the reason
  "status won", and its history shows the step.
- Set to Lost before the payment arrived: it stayed Lost.
- A request pointed at a plan that was already paid: Won at once.
- An ordinary plan with no request behind it started with nothing else changing.
- The counter accepted the new "pay" kind for the site's own server and refused an unknown one.
  The trial caught that the counter's table did not allow the new kind; that is fixed in the
  same migration.
- The four functions on the live database match the migration file by fingerprint.

Screen, on the local test server:

- With no sign-in, the link's page opened and stayed open, bare, with no menu, at phone width
  with no sideways scroll. The test server has no server key, so it showed its sample plan and
  said so; Pay answered "nothing can be paid here" and did not leave the site.
- `/pay` and `/pay/not-a-token` went to the sign-in.
- Signed in as the test admin, on a temporary plan waiting for a card payment (removed
  afterwards): the plan showed the Card payment link button, nothing was read or sent before the
  press, and the box then said card payment is not set up yet, which is true of the test server.
- The page carries the "do not list" and "do not pass the address on" marks.

Tests: `src/lib/roof-care-pay-link-nov23.test.ts` and the last block of
`src/lib/public-requests-opportunities-nov23.test.ts`. Both fail on the code before this change.

Not tried: a real card payment, and a real email. Neither is possible until Stripe and Email are
set up. Both are part of the owner's proof once they are: one test payment from the office's
screen, one from a customer's link, and the agreement email arriving with its button.
