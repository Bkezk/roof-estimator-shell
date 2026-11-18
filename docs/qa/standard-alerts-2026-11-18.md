# Reminders and alerts: the same lines for every kind of work

Date: Nov 18, 2026

The owner's words: "i feel like its still a bit confusing. can you make a standardized version for
each type opp, bid, service ticket etc. where you can select multiple people from a dropdown on
who gets alerted and the frequency in days." Three layouts were offered. The choice: "i like idea
1, and yes skip working days and make a note that shows that, nobody on it should send alerts too.
each step line should be able to be turned on for opps and bids too but defaulted off for now".

## What the page was

Admin › Settings › Reminders had a section per rule (Opportunities, Tickets, Bids, Needs
assignment, Untouched work), each worded its own way.

- Who was reminded was fixed: the person assigned.
- The people told about untouched work were one list for tickets and opportunities together.
- Work with nobody on it only turned red on Work Overview. Nobody was told.
- Tickets counted working days. Opportunities and bids counted calendar days.

## What the page is now

One card for each kind of work: Service tickets, Opportunities, Bids. Every card has the same
lines, and every line is a number of days and a dropdown of who is told.

| Line          | What it is                                                                  | Tickets | Opportunities | Bids |
| ------------- | --------------------------------------------------------------------------- | ------- | ------------- | ---- |
| Coming up     | Before the date: every N days, and a notice N days before                   | yes     | yes           | yes  |
| Past due      | After the date: every N days until it is finished                           | yes     | yes           | yes  |
| Not started   | It has a person and nothing has happened: after N days, then at Past due    | yes     | yes           |      |
| Nobody on it  | Nobody is on it: after N days, then every N days                            | yes     | yes           |      |
| Done, waiting | Done, waiting to be authorized: every N days                                | yes     |               |      |
| Each step     | Once each time it is opened, assigned, changes stage or status, or deleted | yes     | yes           | yes  |

A bid always has the person who started it, so it has no "Not started" or "Nobody on it" line. A
bid's "Coming up" has the one notice only. Whoever sets up a bid can still pick their own "Remind
me on" day.

The dropdown has tick boxes: the person the work is assigned to, Every admin, Every manager, then
everyone by name. Any number can be ticked. Nobody ticked turns the line off, and the button then
reads "Nobody (off)". A blank day box turns its part off too.

A note sits above the cards: "Days are working days. Saturdays and Sundays are not counted, and no
alert is sent on one, except a reminder on the item's own date. Reminders go out at 8 AM Eastern.
“Each step” notices go out at once."

Tasks are not a card. The page says they keep their own notices. The Owner page's Needs attention
limits stay at the bottom, and the Delivery health card is unchanged.

## Who each line tells until someone changes it

Exactly who was told before, plus the two new lines.

- Coming up, Past due, Done waiting: the person assigned. For a bid, whoever started it.
- Not started: every admin and manager (the old "Also tell" list, carried over).
- Nobody on it: every admin and manager. New.
- Each step: tickets tell every admin and manager, as since Nov 17. Opportunities and bids tell
  nobody until people are picked.

## What changed in how alerts behave

1. **Working days everywhere.** Opportunities and bids now count working days and send nothing on
   a Saturday or Sunday. A reminder on the item's own date still goes on a weekend. A bid notice
   "1 day before" a Monday goes on the Friday.
2. **Nobody on it sends alerts.** A ticket or an opportunity left with nobody on it is alerted
   after its limit (1 working day), then every 3 working days, at 8 AM, until someone takes it or
   it is finished. The count starts the day it lost its person, not the day it was entered.
3. **Work Overview's red "Overdue" on an unassigned row follows the same clock.** A ticket whose
   technician is taken off no longer turns red at once.
4. **An opportunity's first reminder** is the first step of its Coming up pace: 7 working days
   after it is assigned. It was 3 calendar days. Opportunities also gained the "notice N days
   before" box, blank for now.
5. **The Done-waiting reminder has its own number** (3). It used the tickets' Past due number.
6. **"Not started" alerts go at 8 AM**, like every other reminder. They went on the day's first
   pass, at 7.
7. **Someone else's reminder says whose work it is.** A person on a line who is not the assignee
   reads the same reminder with "Assigned to <name>." at the end.
8. **Told once a day.** A person listed on two reminder lines is told once a day about one item.
9. **Each step for opportunities and bids** exists and is off: opened or started, assigned,
   reassigned, a new status, deleted. The person who made the change is told only with "My own
   changes" on, as everywhere else.

## The database

Applied by hand on the live database and checked, statement by statement
(`supabase/migrations/20261118120000_standard_alerts.sql`).

- New day boxes and the lists of people on the settings row, with a check on the numbers. The old
  "Also tell" list was carried over to the two Not started lines once.
- A small table that records when each ticket or opportunity was left with nobody on it and when
  it was last alerted. The database keeps it as people are put on and taken off. The office can
  read it. Nobody signed in can write it.
- The database's own "next reminder" rule now counts working days for opportunities and the
  Done-waiting timer too, as it did for tickets.

Tried on the live database inside trials that were rolled back: the mark is made when a person is
taken off, removed when one is put on, and made again later; a direct write by a signed-in manager
is refused; an opportunity's first reminder lands 7 working days out at 8:00; the Done-waiting
timer steps 3 working days at 8:00; a ticket's reminders are as they were.

Because the database change is live before the site is published, **opportunity reminders already
step in working days on the published site**. Everything else waits for the publish.

## Proof

- New checks: `src/lib/standard-alerts-nov18.test.ts` (70). The rules; the lists and how a saved
  list is read; the real reminder pass against a stand-in database (who gets each reminder, the
  "Assigned to" ending, once a day, weekends, the Done-waiting timer, opportunities on working
  days); the nobody-on-it alerts day by day with their claim and put-back; bid notices to their
  lists; the step notices and that they are silent until people are picked; the page; the save;
  the bell's labels; the database change.
- Older checks updated where the rule or the wording changed on purpose, each with a dated note:
  opportunities and bids on working days, the 8 AM gate on "not started", the page's layout and
  wording, the settings the save takes.
- Full run: 594 files, 8,474 checks pass. Lint, types and the production build are clean.
- Browser, desk (1500 px) and phone (390 px), with every save blocked and Save never pressed:
  three cards with their lines; the note; the tasks line; every dropdown shows who it tells today;
  a dropdown lists the roles and all nine people; two ticked reads as two names, unticked reads
  "Nobody (off)"; no sideways scroll; on a phone each dropdown and each tick row is 40 px tall;
  Work Overview loads with the new limits. No page errors.
- The live settings row was read afterwards: not changed by the tests. No alert of a new kind has
  been sent. The test login is as it was.

## Not done, on purpose

- Tasks have no card. They keep their three notices.
- The Owner page's Needs attention limits still count calendar days. The page says so.
- Nothing was tried on a real phone.
