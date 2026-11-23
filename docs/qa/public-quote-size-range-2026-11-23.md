# The public price page: a size range shows a range of prices (Nov 23, 2026)

The owner, after his own try of `/care`: "how is the range of building size calculating the
price? thats a very different price based on what they decide and may give them much smaller
idea of what they will pay". Five choices were put to him. He chose: "go with B and C".

- **B**: a visitor who picks a size range and types no size sees each plan from its lowest price
  to its highest for that range.
- **C**: the page says which roof size the prices are for, and asks for the exact size to get
  one price.

Prices are left out of this record on purpose. Every number in the tests is made up.

## What was wrong

The size the prices are worked on is, in this order: the roof's outline on the map when the
address itself is found, else the size the visitor typed, else the size range they picked. For a
range, the page priced the middle of it and showed that one price. Nothing on the page said
which size the price was for. A roof at the large end of its range was shown a price well below
its own.

## What a visitor sees now

- **A range picked, no size typed, no roof on the map.** Each plan's card shows "$X to $Y" per
  year: its price at the small end of the range and at the large end. Under the cards: "You
  picked 25,000 to 50,000 sq ft, so each plan shows its lowest and its highest price for a roof
  that size. For one price, type your roof's size in step 1 and press Show my price again." The
  line above Send carries the same two prices.
- **The smallest range** costs the same from end to end, so it stays one price, with "These
  prices are for a roof under 10,000 sq ft, the size you picked."
- **A typed size**: one price, and "These prices are for a roof of 31,000 sq ft, the size you
  typed."
- **A roof found on the map**: one price, and "These prices are for a roof of about 28,812 sq
  ft, the size we measured from the map at your address."
- **Over 75,000 sq ft**: no price, as before.

A range of prices is printed one size smaller than a single price, so it stays on one line in
its card.

The line "These prices are an estimate until we measure your roof. If the roof's size is
different, the price is corrected once, before you pay" is unchanged, and so are the terms.

## What the office sees now

- **On the opportunity**, the strip of what the customer sent: "Roof Care, shown $X to $Y a
  year, for the size range they picked (25,000 to 50,000 sq ft). They typed no roof size." It
  used to give the middle of the range as if it were the roof's size.
- **The sign-up opened from that request** starts with a blank roof size box, and says: "They
  typed no roof size and picked 25,000 to 50,000 sq ft, so the page showed them $X to $Y a year.
  … The roof size box is blank: type the roof's real size, press Show my price and choose when
  the first inspection is." It used to put the middle of the range in the box.
- The opportunity's value is still the middle price. It is an estimate until the plan is signed
  with the real size.

## How it is built

- The site's server sends the two ends of the picked range with the middle
  (`PUBLIC_SIZE_RANGE_ENDS`, `quoteFor` in `src/lib/public-forms.functions.ts`), only when the
  range is all there is.
- The database prices both ends with the same price function and the same drive
  (`public_care_quote`, `supabase/migrations/20261124500000_public_quote_range_prices.sql`).
  Each plan keeps its one price, the middle, which a request is still proved against, and gains
  `price_low` and `price_high`. They are kept with the quote, so the request holds them too.
- Ends that do not sit around the size, or a pair that does not sit around the price, are
  dropped, in the database and again on the server. An end that would be a custom quote gives no
  ends. The page then shows the one price, as before.
- The words are in `src/lib/public-pages.ts` (`offerPriceWords`, `priceSizeLine`) and
  `src/lib/public-requests.ts` (`careShownWords`, `carePrefill`, `carePrefillWords`).

## Proof

**Database.** First on the live database inside a trial that was rolled back, then applied. The
live function's fingerprint matches the file. Tried with the real prices, at a one hour drive:

| Asked                                       | Answer                                                 |
| ------------------------------------------- | ------------------------------------------------------ |
| Each of the three middle ranges, with ends  | Three plans, each with a low and a high around its one |
| The smallest range, with ends               | Low and high equal the one price                       |
| A typed size, with stray ends sent          | One price, no ends                                     |
| A range whose low end is above the size     | One price, no ends                                     |
| A range whose high end is a custom quote    | One price, no ends                                     |
| A range with no ends sent (the site before) | One price, no ends: nothing changes until the publish  |
| Kept with the quote                         | The same plans, ends included                          |
| A signed-in person calling it               | Refused                                                |
| Rights                                      | The site's own server only, as before                  |

**Tests.** `src/lib/public-quote-range-nov23.test.ts`, 23 tests. On the code before the change
they fail. One older test that pinned the single price on the card was updated with a dated
note.

**Screen, the public page.** On the local test server, which shows sample numbers, at a
computer's width and a phone's: a range (low to high on all three cards, the size line, the line
above Send), the smallest range (one price), a typed size (one price and its line), and the
largest range (no price and no line). No sideways scroll and no price cut off at either width.

**Screen, the office.** One temporary request with made-up prices, tied to a temporary
opportunity, on the test customer's address: the strip and the sign-up read as written above,
and the roof size box was empty. Nothing was signed.

## Not seen yet

The real prices on the published page. The database's side is proven with them; the page's side
was seen with sample numbers. After the next publish, pick a size range on `jbkbid.com/care` and
look at the three cards.

## Clean-up, checked on the live database

The temporary request, its opportunity, the opportunity's event and their history rows are
gone. Requests 3 (the owner's own three, which he removed from Opportunities himself), notices
330 (unchanged), plans 0, no trial quotes kept, the request counter unchanged, the test login an
admin again with nothing else changed.
