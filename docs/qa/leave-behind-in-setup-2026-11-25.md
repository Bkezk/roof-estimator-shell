# The printed sheet on Setup › QR pages, Nov 25, 2026

The owner, Nov 25: "create the one sheeter with the qr codes for the care plans and then another
page for the additional services that i can print front and back ... dont show pricing on it".
The sheet was first made as a PDF in the session. Then: "site is published and the repair amounts
are fine to keep, plz put the design in the setup qr pages".

## What changed

Setup › QR pages, the card "The QR codes":

- **Before:** two plain sheets, each a title, one line and a code, and a "Print the two sheets"
  button.
- **Now:** the designed sheet, both sides, shown small as it will print. One button, **Print the
  sheet, front and back**. Under it, two small buttons save each code by itself as a picture, as
  before.

The sheet is one piece of letter paper:

- **Front:** the three Roof Care plans, what each includes, the small print for the star and the
  dagger, and the code for `/care`.
- **Back:** the additional services, three steps, and the code for `/request`.
- His flyer's look: the green band, the blue foot, the condensed headline face, the site's logo.
  The body face (Inter) is shipped with the site, so nothing is fetched from elsewhere to print.

## It is never typed twice

- The plans' lines are the public page's own (`planIncludes`), with the numbers the database
  holds today, a little shorter to fit a third of a page (`sheetLineText`).
- The services are the list saved on the same page, in its order. Each of the eight starter
  services has a headline and one line (`SERVICE_WORDS` in `src/lib/leave-behind.ts`). A service
  the office adds prints under its own saved name with no line: nothing is invented for it.
- The codes hold the saved web address.
- So a change to a plan, to the list or to the address is on the next print.

## No price

- No price is on the paper, and no "Priced to your roof" line (owner: "its unnecessary").
- The two minor repairs amounts are printed: they say what a plan includes, not what it costs
  (owner: "the repair amounts are fine to keep").
- No roof size is named for the custom quote: that number lives in the price settings.

## A list longer than usual

- The back has room for ten services. With more saved, the first ten print and the page says how
  many are left out.
- A fuller side is set a little smaller, a step at a time, up to three steps, until it fits. The
  page measures the small copy and the printed copy takes the same step.
- If a side is still too full at the smallest step, the page says so in plain words and asks for
  a shorter list.

## How it prints

- The full-size copy hangs straight under the page's body and is hidden on the screen. In print
  everything else is taken away, so the paper holds the two sides and nothing else.
- Every size is in inches and points, and the colours are the sheet's own. The site's text size
  setting and the dark theme do not reach the paper.

## How it was proven

- **Tests:** `src/lib/leave-behind-nov25.test.ts`, 26 tests: the lines against the public page's
  own, the bold leads, no price and no stray dollar sign, the services and the ten-service limit,
  both codes for the saved address, the print rules, the fit steps, and the Setup page. They
  cannot run on the code before this change: the sheet did not exist. One older test pinned the
  plain sheets' print rule and was updated with a dated note.
- **Full chain:** lint, types, every test and the build pass.
- **The screen,** on the dev server as the test login, desktop and phone, dark theme on:
  - Both sides showed, white paper with dark ink, no sideways scroll, no page errors.
  - The full-size copy was under the body and not shown on the screen.
  - The eight saved services were on the back, and the codes held `https://jbkbid.com/care` and
    `https://jbkbid.com/request`.
- **The paper,** printed by the browser to a PDF with the dark theme left on:
  - Exactly two letter pages. Nothing of the menu or the page was on them.
  - The only dollar amounts were the two minor repairs amounts.
  - Both codes were read back from the printed pages, at full size and at half size.
  - The faces in the PDF were Inter and Barlow Condensed.
  - Printed the plain way too (letter, backgrounds not asked for): two pages, colours kept.
- **A longer list,** shown to the page only by changing the server's answer on its way to the
  browser, so nothing was saved:
  - Two added services with long names: the back took one step smaller, nothing was cut, and the
    printed copy carried the same step. Two pages.
  - Five added: the first ten printed and the page said the last three are not printed.
- Nothing was saved or changed in the office's settings, and no row was made in the database.

## Left with the owner

- Publishing. Until then the live page prints the two plain sheets.
- A real print on the office printer: most leave a thin white edge round the colour.
- His own services list is still on hold. When it comes, each service wants its one line in
  `SERVICE_WORDS`.
