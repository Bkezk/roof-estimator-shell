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

## Later the same day: a notice for a new opportunity, and four more ticks

The owner was asked whether the public pages' requests and the Roof Care plan notices should
have ticks. He said: "wouldnt those both be under opportunities?", then "we also need
notifications for a new opportunity i dont see that on there. go on 1, 2 ... 3 go".

- **New opportunity** is a notice of its own now. It has a line on Admin › Reminders, first on
  the Opportunities card: every admin and every manager until someone changes it. Anyone on the
  "Each step" line hears it too, once. Before this, a new opportunity told only the people on
  "Each step", and nobody is on that line until someone picks people.
- **A request a technician takes down on site** (the Additional Services button) made an
  opportunity and told nobody. It tells the same line now.
- **Four more ticks.** Under Opportunity notices: New opportunity, New QR page request, Roof
  Care plan (paid by card, a card payment that has to be sent back, or expired). Under Service
  notices: Roof Care: no access. The lists now read 16, 8 and 4.
- These four used to be under no switch, so they were always sent. They follow their switch
  now. Nobody had the Opportunity or Service switch off when this shipped. The "Always sent"
  section above is true for tasks, mentions and the test notice only.
- Database: `supabase/migrations/20261124950000_notice_more_ticks.sql`, applied on the live
  database: `notice_fine_keys()` knows 28 keys and matches the file by fingerprint. In a trial
  that was rolled back, the four new keys saved for the test login and a made-up key was
  refused.
- Checks: lint 0 errors (16 warnings), types clean, 676 test files and 10,355 tests pass, the
  build completes.
- In a browser on the test server with the test login and the real database, at phone width:
  the lists read "All 16 on", "All 8 on", "All 4 on"; New opportunity was unticked and the line
  read "1 of 8 off", still after a fresh load; ticked again it read "All 8 on". Admin ›
  Reminders showed the line "New opportunity" with "Every admin, Every manager". The database
  then showed nobody with anything off.
- Not proven: a real new opportunity's notice. Making one would have sent a notice to every
  admin and manager. The tests prove who is told and with what words.

Still open with the owner: he asked whether the plan tick "should be needs payment". Today a
signed plan that is not paid shows on the Owner page's Needs attention list and sends no notice.
A notice for it was suggested to him, not built.

## Not proven

A tick stopping a real notice on the published site: that needs the publish and a real ticket
step. The rule itself is proven by the tests, against the sender and the inbox.
