# Bid rows, Bid Setup and notices about your own changes (Nov 13)

Four asks from the owner in one afternoon. Each has its own test file.

## 1. A bid marked Submitted by accident, put back

"i just accidenlty made a bid submitted can you find it and move it back to drafts?"

History showed one bid status change by the owner that day: a draft marked Submitted at 4:02 PM
Eastern. It had no opportunity, no notices and no lock. Put back by hand on the live database:

- status Draft, the submitted day cleared, the status-changed stamp cleared (it had none before).
- "Last saved … by" back to what the row showed before (the Oct 21 time and name).
- The submitted day cannot be cleared through the page: the stamp trigger keeps it once set, so a
  later real submit would have carried the accident's date. The trigger was switched off for the
  one statement, inside one transaction, and is on again (checked: every trigger enabled).

History keeps both lines: the accident, and the change back by "system".

## 2. Bid rows take less room

"can the status form … be smaller so that it takes up less space … and the bid info is ideally on
one line", "move the folder, copy, document, and delete icons a bit closer together".

- Status box: 130 px wide to 88 px, shorter, less padding. "Submitted", the longest word, fits.
- The four icons sit in one tight group of square buttons. A size larger on phones for fingers.
- Less space between the due day, the total, the status and the icons.
- The bid's info takes the room that is left and wraps only when it must.

Measured in a browser on the 24 live bids, nothing clicked:

| Window | Controls beside the info | Info on one line | Controls width |
| --- | --- | --- | --- |
| 1920 | 24 of 24 | 23 | 437 to 459 px (was about 700) |
| 1650 | 24 of 24 | 14 | same |
| 1366 | 24 of 24 | 2 | same |
| 390 | under it, as before | wraps | 336 px |

No sideways scroll at any width. At 1366 the info is two lines with the controls beside it; the
row is still shorter than before, when the controls dropped to a line of their own.

Tests: `src/lib/bid-row-tight-nov13o.test.ts`, 9 tests, all fail on the old page.

## 3. Bid Setup, General Info

"hide building type as its always going to be commercial, move date created up to just below the
job name form and then in the empty white space there can we show the linked customers contact
info, if no contact info on file, the primary contacts info".

- **Building Type** is hidden while it is Commercial. Every saved bid is (24 Commercial, 3 with
  none, which load as Commercial). The value still rides with the bid. It drives no price. A bid
  that somehow held another type would show the box.
- **Date Created** is under Job Name, beside the customer box.
- **Customer contact** fills the space beside Estimator, Status and Folder: the name, office
  phone, cell and email. Numbers call, the email writes, "Open" goes to the customer. Read only.
- Whose contact: the customer's own card when it has a number or an email; else its Primary
  contact; else the first contact that has one; else "No phone or email on file for this
  customer." (`src/lib/bid-customer-contact.ts`).
- On a phone the boxes follow each other, the contact last.

Live data today: 561 customers have a number or an email on their card and 76 have nobody. No
customer is in the "Primary contact only" state, because the card and the Primary contact mirror
each other. So that fallback is proven by unit tests only.

Browser, a new unsaved bid, server writes refused: unlinked shows the hint; a customer with a
card shows the name, phone and email as links; a customer with nobody shows the plain line.
Checked at 1366, 1920 and 390 wide. Building Type did not show.

Tests: `src/lib/bid-setup-contact-nov13p.test.ts`, 15 tests, 4 fail on the old page (the rest
test the new rule).

## 4. Notices about your own changes

"so i just assigned a ticket to myself but i didnt get the notifcation on my phone", then
"notifications should go out to myself even if im the one who did it."

The site never told a person about what they did themselves. That stays the rule for everyone
who does not ask otherwise. New switch on My account: **My own changes**, off by default
(`profiles.notify_own`). With it on, the person is also told about:

- a ticket, an opportunity or a review assigned to themselves;
- their own ticket marked done or authorized, when they are among those told;
- a ticket they reassigned off themselves, or whose day they moved;
- a task they made or took for themselves, and a mention of themselves.

Applied on the live database (`supabase/migrations/20261113200000_notify_own.sql`, function md5
d84e4a87…). The owner's own switch was turned on by hand, as asked. Nobody else's is on.

Proof:

- **Who may flip it.** A technician can set their own, on and off; nobody else's row changes; an
  anonymous caller is refused; a blank value is refused. Rolled back.
- **In the browser,** two temporary tickets the test login assigned to itself. Switch off: no
  notice written. Switch on: exactly one "Assigned to you" notice, to the test login. Both
  reminder timers started either way. The switch was put back off.
- **Cleanup.** The two tickets, their timers, events, the notice and History lines are removed.
  Nothing named ZZ is left; the ticket counter equals the highest real ticket.

Not seen: a push arriving on a phone for a self-assignment. The local test server sends no
pushes. The owner's phone is registered and took two pushes earlier the same day.

Tests: `src/lib/own-notices-nov13q.test.ts`, 21 tests, 7 fail on the old code.

## The chain

554 files, 7,262 tests, lint 0 errors, types, build. Eight older tests pinned lines changed on
purpose and were updated, each with a note naming the new test.
