# Which notices, one by one, Nov 24, 2026

The owner: "can you also add an ability to select which notifications they want on more
granularly like under ticket notifications you can choose to be notified at open and closed but
not scheduled?" Two ways were put to him and he chose: "Option A on notifications plz."

## What changed

On My account, under "Which notices you get", three of the five switches now have a "Choose
which" list: one tick for each notice under that switch. A tick turned off stops that one notice
for that person everywhere: the bell, the phone and email. Everything is on until a person
unticks it, so nobody's notices changed the day this shipped.

- **Service notices, 15 ticks:** Opened, Assigned to me, Reassigned, Scheduled, Date moved,
  Reminders, Not started, Nobody on it, Done, Authorized, Ready to invoice, Invoiced, Closed,
  Reopened or moved back, Deleted.
- **Opportunity notices, 5 ticks:** Assigned to me, Follow-up due, Not started, Nobody on it,
  Each step.
- **Bid notices, 4 ticks:** Due soon, Past due, My reminders, Each step. Trade bids share them.
- **Lead notices** and **Storm alerts** are one notice each, so they have no list.

A switch that is off still wins: its list goes grey and the ticks are kept for when it is turned
back on. Each person sets their own; there is no screen to set another person's.

## Always sent, with no tick

Tasks, mentions and the test notice, as before. Also a new request from the public pages and
the three Roof Care plan notices (plan expired, no access at an inspection, card payment
received): none of them is under a switch today, so every admin and manager gets them. Putting
one under a switch would stop it for anyone who has that switch off already. That is the
owner's call and was put to him.

## How it works

- Only what is turned off is kept: `profiles.notify_off`, a list of keys.
- The keys, their labels and the rule are in `src/lib/notice-types.ts`. One function,
  `takesNotice`, decides for the sender; the bell and the inbox use the same rule as a filter,
  and a test proves the two agree over every mix of switches.
- The step of an "every step of every ticket" notice is told by how its title starts
  (`src/lib/ticket-watch.ts`). A test walks every title the site can write.
- The save is `set_my_notify_off` in the database: the caller's own row, that one column, and
  only keys on the list (`notice_fine_keys`). A notice type added later needs that one function
  replaced; until then its tick says it could not be saved.
- Database: `supabase/migrations/20261124700000_notice_fine_choices.sql`, applied on the live
  database. Its three functions match the file by fingerprint. The read the sender uses
  (`notify_recipients`) was dropped and made again in one step, with one more column.

## Proof

- Tests: `src/lib/notice-types-nov24.test.ts`, `src/lib/notice-choices-send-read-nov24.test.ts`,
  `src/components/notice-choices-nov24.test.tsx`: 78 tests.
- Checks on the merged code: lint 0 errors (16 warnings, as before), types clean, 674 test files
  and 10,296 tests pass, the build completes.
- On the live database, in a trial that was rolled back: a list saved with one key twice comes
  back with each key once, in order; only the caller's row changes; the sender's read gives the
  list; a made-up key and an empty call are refused; a visitor who is not signed in is refused
  and reads nobody.
- In a browser on the test server, at phone width, with the test login and the real database:
  the three lists read "All 15 on", "All 5 on", "All 4 on"; Scheduled was unticked and the line
  read "1 of 15 off"; after a fresh load it still read "1 of 15 off"; it was ticked again and a
  fresh load read "All 15 on". The database then showed nobody with anything off.
- Every row of a list is at least 44 px tall on a phone.

## Not proven

A tick stopping a real notice on the published site: that needs the publish and a real ticket
step. The rule itself is proven by the tests, against the sender and the inbox.
