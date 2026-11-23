# A public request becomes an opportunity (Nov 23, 2026)

The owner, on the three ideas put to him: "i like option A however if someone pays for the care
plan via the qr code public page what happens then?"

## What changed

Until now a request sent from `/care` or `/request` waited on a list of its own (Opportunities,
Public requests) until someone matched it to a customer. Now it is an opportunity from the
moment it is sent.

1. **The database makes the opportunity** in the same step as the request
   (`public_request_submit`, migration `20261123200000`). It is in the normal Opportunities
   list with:
   - a title that says who and what: "Smith Widgets: Roof Guard plan", "Smith Widgets: Roof Care
     custom quote", or "Pat Smith: Roof leak or repair and 1 more";
   - the source "QR page", and who referred them;
   - the price the page showed as its value, for a Roof Care request that had a price;
   - tomorrow as its date, by the office's clock;
   - no customer and nobody assigned. The database's own "nobody on it" mark is made, so that
     alert covers it like any other unassigned opportunity.
2. **The notice** to the admins and managers opens that opportunity. So does the row on the
   owner's Needs attention list.
3. **The list shows a "No customer yet" badge** on an open opportunity with no customer.
4. **A strip on the opportunity** ("Sent from the Roof Care plans page" or "Sent from the Request
   service page") shows what the customer typed and the customers who may be the sender. A person
   presses **This is <customer>** or **New customer**. The site never picks by itself. The
   customer and the property are then on the opportunity and in its form, already saved.
   - A request that is not real: delete the opportunity. The request is then marked dismissed by
     the database, and comes back if the opportunity is restored.
   - Picking the customer on the opportunity's own form and saving counts as the match too.
5. **A Roof Care request** then shows **Open the sign-up**. It opens the normal sign-up on the
   property, filled in with what the customer picked, exactly as before. The opportunity is set
   to **Won** the day the plan is paid and starts, and its follow-up closes with it. An
   opportunity somebody already set to Lost or No response, or deleted, is left as it is.
   (For a few hours on Nov 23 this happened at sign-up. The owner chose payment day the same
   evening: a plan signed and never paid no longer leaves a Won opportunity. The database does
   it, migration `20261123300000`, so a check and a card both count.)
6. **A custom quote** (no price was shown on the page) never offers the sign-up: the strip says
   to call them with a price.
7. **Start a bid and Start a ticket are not shown** while no customer is on the opportunity.
8. **The separate list is gone.** `/opportunities/requests` and `/customers/requests` send people
   on to Opportunities. The Public requests button is removed.

Who sees what did not change. What the customer typed and who they may be is shown to people with
Customers access only (the server and the database both ask). Someone else who may read the
opportunity sees its title and description, which say where it came from.

## The owner's question: paying through the QR page

No payment is taken on the public page, by card or by check. The customer picks a plan, ticks the
terms, and says how they would like to pay. That is a request. The plan does not exist until the
office opens the sign-up and signs it, and it starts the day the payment is received, as for any
plan. The strip says "No payment was taken on the page" so nobody takes the request for a paid
plan.

Later the same evening the owner chose how such a customer pays by card: after the office signs
the plan, the customer gets a card payment link of their own. See
`docs/qa/roof-care-pay-link-2026-11-23.md`.

## Proof

Database, on the live database inside a trial that was rolled back:

- A service request, a priced Roof Care request and a several-buildings Roof Care request each
  made one opportunity with the title, source, referrer, value and date above, no customer, no
  assignee, a "nobody on it" mark and a "created" line in its history. The database sent no
  notice by itself.
- The possible match for the Roof Care request was found by its street address. "This is them"
  put the customer and the property on both the request and its opportunity.
- Deleting an unanswered request's opportunity marked the request dismissed; restoring it put
  the request back. A customer picked directly on the opportunity marked the request matched.
  A matched request stayed matched when its opportunity was deleted.
- The three functions on the live database match the migration file by fingerprint.

Screen, on the local test server signed in as the test admin, with two temporary requests that
were removed afterwards:

- Both were in the Opportunities list with the badge. No Public requests button.
- Both old addresses opened Opportunities.
- The Roof Care one showed the strip with the match offered. After "This is bell county" the
  strip said to open the sign-up, the form showed the customer, and the page said all changes
  were saved.
- "Open the sign-up" opened the property with the sign-up filled in from the request. It was not
  signed.
- The service one showed no match and the New customer button.
- No sideways scroll at phone width. An ordinary opportunity showed no strip.

Tests: `src/lib/public-requests-opportunities-nov23.test.ts`. They fail on the code before this
change. The older tests that pinned the list were updated with dated notes.

Not tried on the test server: a real send from the public page (the test server has no server
key), and signing a plan from a request (that would make a real plan and send notices). The Won
step is covered by the tests. Both are part of the owner's one real try from his phone after a
publish.
