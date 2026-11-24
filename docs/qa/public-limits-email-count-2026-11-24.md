# The public pages' limits and the day's email count, Nov 24, 2026

The owner, on the four suggestions of that morning's report: "Go on 4s suggestions".

## What changed

1. **The limits of the two public pages.**
   - Everyone together, a day: 2,000 price questions and 300 requests. They were 400 and 60.
   - One connection: 20 price questions and 5 requests an hour, as before, and now 60 and 10 a
     day.
   - The count is taken in one step, so two calls in the same instant cannot both slip under a
     limit. A call that is refused is not counted.
   - A day is the office's day, midnight to midnight Eastern.
2. **What a visitor is told.** Their own connection's hour: "Too many requests from this
   connection. Please wait a few minutes, or call us." Their own connection's day: the same
   with "today" and the office's number. The day's count for everyone: "We are getting a lot of
   requests right now, so this page is resting until tomorrow. Please call us at …". That last
   one used to blame the visitor's connection.
3. **What the office sees.** Setup › QR pages has a box, "Today on the public pages": quotes
   shown and requests sent beside their limits, the forms dropped as a robot's, and the last 30
   days. A count turns amber from four fifths of its limit and red at it.
4. **Notices.** An admin gets a notice when a day's count passes four fifths, and again when it
   is reached. To the bell and the phone, never by email.
5. **The day's emails.** The email service allows a plan so many emails in 24 hours (100 on the
   free plan). The site now keeps its own count over 24 hours, and takes the service's own
   count when it gives one.
   - From four fifths of the limit, emails to staff about notices wait. Each notice is still in
     the bell and on the phone. The rest of the day's emails is kept for customers: agreements,
     receipts, invoices, payment links.
   - An admin is told once when the count reaches four fifths, and once if the service refuses
     an email because the day's limit is reached.
   - The limit is a setting on Setup › QR pages, "Emails a day". 0 means the plan has no daily
     limit: nothing waits.

## Where it lives

- Database: `supabase/migrations/20261124900000_public_limits_and_email_count.sql`
  (`public_form_take2`, the older `public_form_take` kept for the payment link,
  `public_form_usage`, `email_take`, `email_seen`, `email_daily_cap_set`, the tables
  `email_sends` and `email_state`). Applied on the live database; all six functions match the
  file by fingerprint.
- Server: `withinLimit` in `src/lib/public-forms.functions.ts`, `tellPublicLimit` in
  `src/lib/public-forms.server.ts`, `countedEmail` in `src/lib/notify.server.ts` (every email
  the site sends goes through it: `sendEmail` and the invoice email).
- Words: `src/lib/public-forms.ts` (the visitor's), `src/lib/public-requests.ts` (the office's).
- Screen: `src/components/public-forms-setup.tsx`.

## Proof

- Tests: `src/lib/public-limits-nov24.test.ts`, 15 tests. Thirteen fail on the code of that
  morning; the other two read the new database file.
- Checks: lint 0 errors (16 warnings, as before), types clean, 671 test files and 10,217 tests
  pass, the build completes.
- On the live database, in one trial that was rolled back: the 1,600th price question of a day
  answers "near" and the ones around it do not; the 2,000th answers "reached"; the next visitor
  is refused with the day's count for everyone, and the older yes or no door refuses too; a
  sixth request in an hour and an eleventh in a day from one connection are refused, each with
  its own reason, and neither is counted. With the email limit set to 10 for the trial: the
  eighth email of the day answers "near"; a staff email after it waits; a customer's still
  goes; the service's refusal answers "full" once and not a second time; a limit of 0 holds
  nothing. An admin can set the limit; a technician cannot; nobody signed in can call the
  counters.
- In a browser on the test server, signed in, at desktop and phone width: the box reads
  "Quotes shown: 0 of 2,000", "Requests sent: 0 of 300", the 30 days open to one row for Nov
  23, the email card reads "0 of 100 sent in the last 24 hours…", the page is no wider than the
  phone, and Save stays off until something is changed.

## Not proven

The notices and the held emails on the published site: they need the publish and real traffic.
The first real email after the publish will show whether the service's own count comes back
with its answer.
