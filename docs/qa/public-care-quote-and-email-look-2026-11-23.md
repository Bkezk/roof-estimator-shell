# The public price page works, and the Roof Care emails look like the handout (Nov 23, 2026)

Two things the owner found on the evening the site moved to `jbkbid.com` and email came on.

## 1. Show my price on `/care` answered "That did not go through"

The owner typed a building into `https://jbkbid.com/care`, picked a roof size and pressed Show my
price. The page said: "That did not go through. Nothing you typed is lost: try again, or call
us".

**The cause.** The price needs the drive from the office to the visitor's building. The drive
starts by finding both addresses on the map, with two lookups in the database
(`service_aerial_address_candidates`, `service_aerial_buildings_near`). Both let a caller through
only when a signed-in person has Service, Customers, Prospecting or Estimate access. On the
public page nobody is signed in: the site's own server asks, with its own key. Both answered
"Forbidden: Service access required". The page turned that into its plain "did not go through"
words, as it does for any fault of ours.

No public visitor ever got a price. The page was built on Nov 21 and its real path could only be
tried once it was published; the local test server shows a sample and never reaches the
database. Every other step of the public quote was tried as the site's own server that evening
and answered: the request counter, the office's address, the Google lookup counter and the
price itself.

**The fix.** Both lookups now also answer the site's own server, the way `roof_care_price` and
`google_route_take` already do
(`supabase/migrations/20261124400000_public_quote_map_lookups.sql`). Applied by hand, and both
match the file by fingerprint. Who may call them did not widen: a signed-in person without one of
the four kinds of access is still refused, and someone not signed in has no right to call them at
all. Both were tried, inside a trial that was rolled back.

**Proof on the live site.** With no sign-in, the same address and size: before the fix the
server's answer carried the error; after it, the page showed the three plans, each with its
price and "per year", and no error line.

Test: `src/lib/public-quote-map-lookups-nov23.test.ts`. Two of its three tests fail without the
migration.

Still the owner's to try: sending a request from `/care` and from `/request` to the end.

## 2. The Roof Care emails look like the handout

The owner, on the first agreement that reached his inbox: "id rather it be more visual like the
handout i gave you for reference".

The agreement, the receipt and the payment-link email now wear the handout's parts, the same
ones the sign-up and the public pages wear (`src/lib/roof-care-email-look.ts`):

- the company's name at the top, with what it does and where;
- the green band with the heavy headline: "Your Roof Guard plan.", "Payment received.", "Pay for
  your plan.";
- numbered headings, the number on a green square and the title in heavy blue capitals;
- the plan as a card: its name, one bold line of what it is, the price in the heavy face with
  "per year" under it, then the plan number, the property, how it is paid and the first
  inspection;
- what the plan includes, with small green squares;
- the terms in a box, word for word;
- the sign-off in the deep blue band at the foot.

A mail program is not a browser. Every style is written on its own element, the layout is
tables, and there is no picture: the email reads the same with pictures switched off, and it is
not made heavier for the spam filters. The plain-text copy of each email is unchanged.

**The notes are the plan's own.** Under "what the plan includes" every agreement carried the
gutters note, the storm note and the minor repairs note. A Roof Watch customer has none of the
three. Each note now shows only where the plan has what it speaks of (`footnotesFor`).

Tests: `src/lib/roof-care-email-look-nov23.test.ts`, 13 tests; none can run on the code before
it. Samples with made-up numbers were drawn at a computer's width and a phone's: no sideways
scroll at either.

Not seen yet: the new look in a real inbox. It reaches customers after the next publish.

## Also noted that evening

- The first agreement landed in the owner's spam folder. The domain was bought that day and had
  never sent an email, so it has no reputation yet. Its records check out.
- The phone number at the foot of the emails is the one saved under Estimate Pricing › General.
  The owner said it was wrong and, later that night, gave the right one: the number the public
  pages already carried. Estimate Pricing › General was set to it at his word. No code changed.
- At his asking ("its published so go ahead and resend") a second test plan was signed on the
  live site with him as the recipient, at 20:24 UTC. The agreement went out with no error. The
  plan, its draft invoice and their history rows were then removed, and the plan number counter
  was put back. Not known yet: that it arrived, and how the new look reads in his inbox.
- He said "the test notification worked". The database shows that notice's email handed to the
  email service at 20:08 UTC with no error.
