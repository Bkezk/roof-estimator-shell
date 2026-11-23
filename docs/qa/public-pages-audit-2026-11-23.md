# Public pages audit, Nov 23, 2026

The owner: "Do an audit on what we've been working on especially the public pages. Try to break
them as to find issue, don't assume test everything, this is likely going out as an ad soon so
it's essential the public pages works and are secure".

Code at `43e4580`. No code was changed by the audit. This page lists what was tried and held.
What did not hold is kept out of this repository, in the admin-only table
`office_reference_notes` on the live database (key `roof-care-break-test-2026-11-20`, the part
headed "PUBLIC PAGES AUDIT, Nov 23 2026"), with a fix beside each point.

## What was tried

- The published site, as a stranger: `/care`, `/request`, `/pay/<token>`, the signed-in pages, the
  addresses that need a secret, the scripts the browser downloads, the answer headers.
- The database, with the public key and with no key: every table, view, function, file store.
- The price question, replayed outside the page with other bodies: missing and extra fields, wrong
  types, huge and tiny sizes, hostile text, forged connection headers, 21 questions in an hour.
- The request form at the database, in trials that were rolled back: a changed price, a price from
  another plan, the low end of a size range, an old price, a made-up price, a price for another
  building, a custom quote sent with a price.
- The pages on the test server: wrong and missing answers in every box, double presses, a changed
  building after the price, Back after sending.
- What the office sees when a stranger types HTML and script into every box (a temporary request,
  removed after).
- Load times of `/care` on a slowed phone connection.
- An independent read of the code by a second reviewer.

## What held

1. Nothing in the database can be read with the public key: no row in any table or view, no
   function can be run, no file can be listed or fetched. No rule in the database applies to a
   visitor who is not signed in. New accounts cannot be made by a stranger.
2. The public scripts hold no secret, no service key and no source map.
3. The site answers on `https://jbkbid.com` only, with the security headers set. It cannot be put
   inside another site's frame.
4. Every address that needs a secret refuses without it. The card payment address refuses while
   Stripe is not set up.
5. Every signed-in page sends a stranger to the sign-in screen. No data and no server answer
   reaches the browser first.
6. A call to the site's server functions from another site is refused.
7. A price cannot be changed by the visitor. The database proves the price against its own record
   of the price question, for that building and that plan, and refuses anything else. A size range
   cannot be sent with its low price. A custom quote keeps no price.
8. The limit for one connection holds, and a forged connection header does not get round it.
9. An existing customer's address answers exactly as the building next door: the form tells a
   stranger nothing about who is a customer.
10. HTML and script typed into every box show as plain text on the opportunity, the opportunities
    list, the Owner page, Work Overview and the sign-up. No script ran.
11. Accents and emoji in an address are fine. A double press sends once.
12. A payment link that matches no plan says "This payment link is not active."

## Left as it was

Requests 3, the request counter at 4003, notices 330, plans 0, no stray opportunity. The audit's
own price questions were removed from the live database. The test login ended as it began.
