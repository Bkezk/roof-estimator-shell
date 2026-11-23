# Behind the two public pages: what was built and how it was proven (Nov 21, 2026)

Roof Care step 4. The pages a visitor sees (`/care`, `/request`) and the flyer look are in
`docs/qa/roof-care-flyer-look-and-public-pages-2026-11-21.md`. This record is everything behind
them: the four server functions with no sign-in, the database, the limit on Google lookups, the
office's list, the Setup page with the QR sheets, and the proof.

## What a stranger can reach

Four server functions, in `src/lib/public-forms.functions.ts`, and nothing else:

| Function                | What it answers                                                         |
| ----------------------- | ----------------------------------------------------------------------- |
| `publicRoofCareQuote`   | The three yearly prices for one building and what each plan includes    |
| `submitRoofCareRequest` | A reference ("R-4001") after keeping a Roof Care request for the office |
| `submitServiceRequest`  | A reference after keeping a service request for the office              |
| `publicServiceChoices`  | The office's list of services to tick                                   |

**Nothing in the database is open to a stranger.** No function and no table is granted to the
anonymous role. The four functions reach the database with the site's own server key, the way
the two older public links (`/d/…`, `/i/…`) do. The database functions they call are granted to
the server alone and each checks again, itself, that the caller is the server. The rule of
Nov 14 stands untouched, and its test (`stranger-access-nov14.test.ts`) still fails on any grant
to the anonymous role in a later migration.

On the local test server there is no server key, so there the four functions answer made-up
sample numbers marked `sample: true` and keep nothing. On a published build without the key
they refuse in plain words ("This page is not available just now. Please call us.").

## What each one refuses

All refusals are one plain sentence. A fault of ours (anything the database did not word itself)
is never shown: the visitor reads "That did not go through. Please try again in a minute, or
call us."

**Every function**

- Over the limit: "Too many requests from this connection. Please wait a few minutes, or call
  us." (`PUBLIC_TOO_MANY`, the whole message, which the pages look for.)
- Every text has a top length, checked on the server and again in the database.

**The price question**

- An address under 3 letters or over its length; a roof size that is not a number above 0.
- The answer holds `found`, `rough`, `place`, `sqft`, `sqft_source`, `custom_quote`, `plans`
  and `quote_token`. Each plan holds its key, its name, its yearly price and what it includes.
  No cost, no list price, no drive, no profit, no id, and nothing about who is a customer: the
  server copies those named fields out and drops whatever else the database added (tested with
  extra fields added on purpose).
- A building's own stored size is never used: it would tell a stranger who is a customer. The
  size is the map's outline when it is sure, else what was typed, else the middle of the range
  picked.
- The largest range, and a roof the price function calls a custom quote: no numbers.
- An address the map cannot place, even by its town: no numbers.

**A Roof Care request**

- No name; no phone with its area code and no email; an email that does not look like one.
- A price answer that is unknown or older than two days; an address or zip changed since the
  prices were shown.
- Where prices were shown: no plan picked, no way of paying, the terms not ticked, no name
  typed for the agreement, old terms, or a price that is not the one kept for that plan.
- Where no price was shown (a custom quote, several buildings, an address not placed) the
  request is kept as "call me with a custom quote". The database decides this from the price
  answer it kept, never from the form. No price, no way of paying and no agreement is kept,
  whatever the page sent in those boxes.

**A service request**

- No name, no way to reach them, no service ticked, or a service that is not on the office's
  list.

**Robots.** A hidden box no person fills in, and a form sent within three seconds of opening:
the sender is answered as if it worked and nothing is kept or counted. The reference a robot
is given has three digits, which a real one never has.

**Text is text.** What a visitor types is stored as typed and shown by React as text. A trial
sent `<b>bold</b>`: it came back as those letters.

## The limits

| Who               | Price questions | Requests  |
| ----------------- | --------------- | --------- |
| One connection    | 20 an hour      | 5 an hour |
| Everyone together | 400 a day       | 60 a day  |

A connection is counted under a keyed hash of the address the request came from. The address
itself is never stored. Counts older than three days, and price answers older than fourteen,
are cleared as new ones come in.

## The database

`supabase/migrations/20261121100000_public_forms.sql`, applied by hand on Nov 21.

- `public_form_settings`: one row. The services list, the web address for the QR codes, the
  Google limit. Read by people with Customers access; changed by an admin or a manager.
- `public_requests`: what visitors sent. Read by people with Customers access. Nobody writes to
  it directly: the server adds a request through `public_request_submit`, the office answers
  one through `public_request_handle`.
- `public_quotes`, `public_form_hits`, `google_route_uses`: the kept price answers, the limit
  counts, the day's Google count. No one reads them directly.

Fingerprints (first 8 of `md5(prosrc)`), the file and the live database the same:

| Function                 | Fingerprint |
| ------------------------ | ----------- |
| `google_route_take`      | 6f0623cb    |
| `google_route_today`     | 39f2dab9    |
| `public_form_take`       | d12fd2fd    |
| `public_form_norm`       | fdd85057    |
| `public_care_quote`      | 4a6eb153    |
| `public_request_submit`  | 5113a473    |
| `public_service_choices` | bbc86d30    |
| `public_request_matches` | bfd0f45f    |
| `public_request_handle`  | 271051e4    |

Grants to the anonymous role or to everyone, on these functions and tables: 0. Row security is
on for all five tables. The three policies check the person once per query, the house way.

## The limit on Google drive lookups

The site asks Google for a set number of drives a day (200 to start, a setting), counted for
the whole site in the database (`google_route_take`). Over it, or if the count cannot be read,
the free router answers and nothing fails. The office's drive tool then says "by road, from the
free router: today's limit of Google lookups is reached". Setup › QR pages shows today's count.

## The office's side

**Opportunities › Public requests** (`/opportunities/requests`, Customers access). Moved on Nov 23:
it was a menu row under Customers at `/customers/requests`, which still opens and sends people
on. It is now opened by the Public requests button at the top of the Opportunities page, which
carries the number waiting (`docs/qa/screens-2026-11-23.md`).

1. Each waiting request shows who sent it, how to reach them, the address, and what they asked
   for.
2. Under it: the customers who may be the sender, with why ("same phone number", "same email",
   "a name alike", "same street address"), and the property when the address matched. Broad on
   purpose: the site only offers, a person decides.
3. **This is <customer>**: the request is tied to that customer. If the address is not one of
   their properties, the property is made.
4. **New customer**: the customer and the property are made from what was typed, with the
   functions that already make them.
5. **Dismiss**: needs a reason. A dismissed request can be put back.
6. After a match:
   - a service request becomes an opportunity (the services, their words, who referred them),
     assigned to the person who matched it, due the next working day;
   - a Roof Care request opens the property with the normal sign-up filled in with the plan,
     the size, the way of paying, the visitor's own typed name and who referred them. The plan
     waits for its payment as any other;
   - a custom quote request opens the property and says to call them with a price. No sign-up
     is opened from it.

An unanswered request is on the owner's **Needs attention** list: amber, red after two days.
The admins and managers get **one notice** per request, sent when it arrives and, failing that,
by the 8:00 run.

**Setup › QR pages** (`/setup/qr`, admins and managers). Since Nov 23 it is the sixth tab of
Setup, not a menu row of its own; the address is the same.

- The two sheets, one a page: the name, a line of what the page is for, the code, the address
  in letters. No prices. **Print the two sheets** and **Download as picture**.
- **The web address inside the codes.** `https://` and the name only. Blank means the site's
  own, and then the page warns not to print: that address is borrowed and can change, and a
  printed code is permanent.
- **The services** a visitor can tick: add, rename, reorder, remove.
- **Google drive lookups a day**, with today's count.

## How the QR codes were proven

The site draws the codes itself (`src/lib/qr.ts`, the `qrcode` package for the pattern, error
correction Q, a four-cell light edge). No outside service is asked and no picture is fetched.
In the tests each code is drawn as pixels and read back by a separate QR reader (`jsqr`): the
text read is the page's exact address, for the site's own address and for a saved one, and a
trailing slash does not double up. Not proven: a code printed on paper and scanned by a phone.

## Trials on the live database (all rolled back unless said)

As the anonymous role: every one of the nine functions and all five tables refuse (42501).

As the server:

- one connection: 20 of 22 price questions and 5 of 7 requests are let through;
- a short key and the key `*` are refused;
- a price answer holds only `custom_quote`, `plans`, `quote_token`, and a plan only `benefits`,
  `name`, `plan`, `price`;
- a very large roof: a custom quote, no plans. Sent the way the page sends it (a plan standing
  in, a price of 0, the tick): kept with no plan, no price, no way of paying, no agreement;
- several buildings with prices on the page: kept with the plan they leaned to and no price;
- a priced request with a price of 0, or the right price and no tick: refused;
- a one-letter address, a 500 hour drive, a changed address, no way to reach them, an unknown
  plan, an unknown service, no service, 2,001 letters: each refused in plain words;
- a good Roof Care request and a good service request are kept; a service ticked twice is kept
  once.

As an office user: the test customer is offered for a matching address, name and phone, with
its property; a direct update is refused; dismiss needs a reason; dismissed, put back, matched;
a property that is not the customer's is refused; a matched request cannot be dismissed.

As a technician: reads no rows; the office functions refuse.

Google count at a limit of 2: true, true, false.

**One pass that was kept, then removed.** The two public pages were driven in a phone-width
browser, signed out, with a made-up "ZZ" visitor: prices shown, a plan picked, both forms sent,
both answered with a reference. On the test server that is the sample path and nothing is kept.
The same two requests were then put in through the database's own door as the server does, and
read back as the office reads them: both listed as new, the Roof Care one with its plan and
price, the service one with its two services and its text as typed. They were dismissed and put
back as an office user (rolled back), then removed: 2 requests, 1 price answer, 4 limit counts.
No notice was made. A signed-out visitor who opens the office's list or the QR page is sent to
sign in.

## Tests

`src/lib/public-forms-nov21.test.ts`. On the code before this change the file cannot load: it
imports modules and reads a migration that did not exist. Older pins that changed, each with a
dated note: `owner-attention-nov16`, `roof-care-nov18`, `roof-care-locate-nov18`,
`drive-router-named-nov20`, `travel-estimate`, `bid-due-notice`, `setup-page`.

## Not proven here

- The real path end to end from a published page (the server key lives only on the published
  site): a request typed on a phone arriving in the office's list.
- A real notice, and any email (email is not set up).
- The office's buttons pressed in a browser. Pressing them makes real customers and
  opportunities, so they were proven by the trials above and by tests.
- A printed code scanned off paper.

## Left clean

Requests 0, kept price answers 0, limit counts 0, Google counts none, notices 0, temporary
tickets 0, "ZZ" customers and properties 0. The request numbers start at R-4001. The two older
sequences were reset by the computed form. The Roof Care settings and the new settings row are
as they were. The test login is as it was.
