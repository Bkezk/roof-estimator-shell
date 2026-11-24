# Public pages: what was fixed after the audit, Nov 24, 2026

The owner read the audit of Nov 23 (`docs/qa/public-pages-audit-2026-11-23.md`) and answered
each point. "Go" on 1, 2, 6, 7, 8, 9, 10, 11 and 12. Points 3, 4 and 5 were questions: they are
answered in the report to him and nothing was built for them.

## What changed

1. **Request service.** A few words with no service ticked is a request. It is filed as "Other"
   and the opportunity carries what was written. Neither a tick nor a word is still refused, in
   plain words.
2. **Typing before the page is ready.** Both pages read their boxes themselves: once when the
   script is ready, and again at every press of a button (`typedBoxes` and the `adopt…`
   functions in `src/lib/public-pages.ts`). The same covers a browser that fills a form in
   without telling the page.
3. **A building far away.** A round trip over 24 hours or 2,000 miles is a custom quote, said in
   its own words: "This building is outside our usual service area…". The details can still be
   sent, and the opportunity says why no price was shown.
4. **Share preview.** `/care`, `/request` and `/pay/<token>` carry their own title, description
   and picture for a shared or texted link (`src/lib/public-share.ts`). They stay out of search
   results, as the owner asked.
5. **A price belongs to one building.** The server and the database ask for the city, a two
   letter state and a five digit zip, and a request is compared with its price on street, city,
   state and zip.
6. **What a visitor types is kept plain.** One-line boxes are kept as one line. An email is
   accepted only when it is nothing but an address. On the opportunity, a phone or email link is
   made only from a plain number or a plain address; anything else shows as text.
7. **A broken payment link** opens the payment page, which says the link is not active and
   gives the office's number. It used to land on the staff sign-in.
8. **Card payments.** A payment notice is taken only when it and the site's Stripe key are both
   test or both live, and a pasted secret is trimmed. Stripe is not set up yet: proven by tests.
9. **The small points.**
   - Spreadsheet files: a cell of words that starts like a formula gets a single quote in front
     (`src/lib/csv-safe.ts`). Numbers are untouched.
   - The scheduled, backup and restore addresses give one plain refusal, and the reason goes to
     the server's log. A `CRON_SECRET` under 16 characters still works and the log says to make
     it longer.
   - The same request sent twice within ten minutes is one request with one reference.
   - A form dropped as a robot's is counted by day.
   - A request is pointed only at its own customer's opportunity and plan.
   - A call to a server function that no page could have sent gets a plain "Bad request".

## Not done, and why

- **Lighter pages.** Loading the staff menu, search and bell only for signed-in people was tried
  and measured on the build: the first download of `/care` went from 358 KB to 338 KB
  compressed, about 6 percent, and every staff page would load its menu a moment later. It was
  put back. A real cut needs the public pages built as their own small bundle.

## Proof

- Checks on the merged code: lint 0 errors (16 warnings, as before), types clean, 670 test files
  and 10,201 tests pass, the build completes.
- New tests: `src/lib/public-pages-audit-nov24.test.ts` (20), `public-share-nov24`,
  `roof-care-stripe-checks-nov24`, `csv-safe-nov24`, `secret-doors-nov24`,
  `server-fn-body-nov24`. Fifteen of the first file's tests fail on the code of Nov 23; the
  other five read the new database file.
- The database change (`supabase/migrations/20261124600000_public_pages_audit_fixes.sql`) is
  applied on the live database. All seven functions there match the file by fingerprint.
- Tried on the live database in trials that were rolled back: a far building comes back as a
  custom quote marked far; a missing city, a state written as a word, a blank or short zip are
  refused; a request for the same street in another city or another state is refused; an honest
  request is kept; a request with words and no tick is kept, titled "…: Other", and sent twice
  it is one row with one reference; an email with extras is refused; a name with a line break is
  kept as one line; a dropped form is counted; another customer's opportunity or plan is
  refused while the ordinary match still works.
- In a browser on the test server: the request with no tick is sent; the page's scripts were
  held back while an address was typed, and Show my price then asked the server and showed
  three prices; the same on the request form; three broken payment links show "This payment
  link is not active." with no sign-in box; a staff page still goes to the sign-in; the share
  tags are the public ones on the three pages and the staff ones on the sign-in; five staff
  pages made 35 server calls with none refused.

## Left as it was

Requests 3, the request counter at 4003, notices 330, plans 0, no stray opportunity. The test
login ended as it began, apart from its email notices, which are off with the owner's.

## To see after a publish

The published site still runs the code of Nov 23 until the owner publishes. The database rules
are live already and the older page works with them. After the publish: one far address on
`/care`, one request with no tick, and the preview of a texted link.
