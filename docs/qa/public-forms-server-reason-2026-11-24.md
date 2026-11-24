# The QR pages show the server's own reason, Nov 24, 2026

From the Nov 24 report on the public pages, item 5. The owner asked for the detail that night
and said: "yes on 5".

## What changed

When the server turns down a form on `/care` or `/request`, it has an exact reason, such as
"Type the state as two letters, like KY." or "The price changed after it was shown. Press Show
my price again, then send." The pages used to show one general line whatever the reason was:
"That did not go through. Nothing you typed is lost: try again, or call us at …".

They now show the reason itself. The general line is kept for a fault that is not the
visitor's: a dropped connection, or anything that went wrong on our side.

- Only a sentence on a list is ever shown (`PUBLIC_REFUSAL_LINES` in `src/lib/public-forms.ts`):
  the plain sentences the database's two public functions raise for a visitor, and the server's
  own three. A database's technical words are never shown.
- A test reads the sentences out of the database file and fails when one is missing from the
  list, so a sentence added to the database later cannot be forgotten.
- The database's price sentences say "Show my prices". The button reads "Show my price", so the
  page shows the sentence with the button's own name.
- No database change.

## When a visitor would see one

Rarely. The page checks most of these itself before it sends. The server's reason matters when
the page was left open more than two days, when the office changed the terms or the services
list while the visitor was on the page, or when the address was changed after the prices were
shown.

## Proof

- Tests: `src/lib/public-refusal-lines-nov24.test.ts`, 12 tests. They fail on the code of that
  morning: there was no list.
- Checks: lint 0 errors (16 warnings, as before), types clean, 678 test files and 10,392 tests
  pass, the build completes.
- In a browser on the test server, at phone size, on the Request service page: the form was
  filled in right, and the phone and the email were taken out of the request on its way to the
  server. The server refused, and the page read "Type a phone number with its area code, or an
  email address, so we can reach you." The boxes still held what was typed. With the connection
  cut, the page read the general line. Nothing was saved by either.

## Not proven

A reason that only the database gives, on the published site: the test server has no key to
the database. The same list and the same door carry it, and the limit sentences have gone
through that door since the morning.
