# One row per job, Nov 25, 2026

The owner, Nov 25: "if there is an opportunity then an inspection ticket gets generated from that
then the opportunity becomes overdue even though someone is going to do the inspection thats a
bit confusing". And: "id also like for only 1 thing to appear on the work overview at a time so
we dont have 3 or 4 things on there linked to the same opportunity/ticket but i also dont want
to miss things and a weird situation where theres an inspection/repair at the same location i
dont want to miss that". He was given a design with a step by step example and answered:
"2. go i like this setup".

## The rule

Things made from one another are one job: an opportunity, the inspection made from it, and the
repair ticket or the bid that came of that. The row that shows is the step that is waiting now.

- **The opportunity waits.** While a step made from it is open and somebody has it, the
  opportunity is not a row on Work Overview, is not overdue, counts nowhere as overdue and sends
  no reminder. It says what it waits on: "Waiting on inspection #6090, Dec 4, Garry Peters".
- **An open step** is a ticket that is Open or Scheduled with a technician, or a draft bid with
  its estimator. A ticket with nobody on it holds nothing back: the opportunity stays in sight.
- **The step is the row.** It says where it came from: "Opportunity: Leak at the dock".
- **The step is finished.** The moment nothing of the job is open any more, the opportunity is a
  row again. Its person is told once, "Inspection #6090 is done: follow up on Leak at the dock",
  and gets two working days: the follow-up day moves out to then, never in.
- **The step runs late.** The late ticket is the one overdue row. The opportunity's person is
  told once, the first working day after the step's date: "Inspection #6090 is late: …".
- **Two steps.** A repair and a bid from one inspection are different work for different people:
  both show, and the opportunity waits on both.
- **Two jobs at one property are never merged.** Rows are joined only by a real link, never by an
  address. Each open ticket that shares its property with a ticket of another job says so:
  "Also open at this property: repair #6070".
- **Nothing is stored.** What an opportunity waits on is read from its tickets and bids each
  time, so a ticket that is finished, deleted or left with nobody puts the opportunity back with
  nothing to remember. A read that fails shows every opportunity as it always was.

## Link an existing ticket

"Start a ticket" on an opportunity links the ticket by itself. A ticket made on its own is not
part of the job until it is linked.

- One small line under the opportunity's chain, "Link an existing ticket". It shows only when the
  customer has an open ticket that belongs to no opportunity, or one is linked. Only the people
  who create tickets see it.
- It opens one short window: each ticket on a row with Link or Unlink.
- Refused, each with its own sentence: another customer's ticket, a ticket of another
  opportunity, a finished ticket, a closed or deleted opportunity.
- A linked ticket moves the opportunity as a started one does: an inspection makes an Open
  opportunity Contacted, a repair makes it Won. The message says so.
- The ticket's history gets one line each way.

## Where it reaches

- Work Overview, list and calendar: `src/lib/my-work.functions.ts`.
- The Overdue opportunities tile on Customers: `src/lib/work-counts.functions.ts`.
- The Opportunities page, list rows and header: the badge, no Overdue tag, no "Next reminder".
- The Owner view's counts and each person's list, and Needs attention's "not started" rows.
- The reminder run: a waiting opportunity is skipped and not escalated, and the late-step notice
  goes out with the morning pass.
- The rule: `src/lib/job-steps.ts`. The reads and the two notices: `src/lib/job-steps.server.ts`.
  The link: `src/lib/job-link.functions.ts`, `src/components/link-ticket.tsx`.
- No database change. Both notices use the existing follow-up kind, so they are under the
  Opportunity reminders tick each person already has.

## How it was proven

- **Tests:** `src/lib/job-steps-nov25.test.ts`, 55 tests: the rule, the words, the two working
  days, the late day across a weekend, two jobs at one property, the Owner view's counts, the
  link's refusals, the server reads and both notices on a made-up database, and that every screen
  asks the one rule. None can run on the code before this change: the rule did not exist.
- Seven older tests pinned the exact old wording of lines this changed and were updated, each
  with a dated note. One of them caught a real slip while this was built: a second, unneeded
  lookup of people's names, which was removed.
- **Full chain:** 686 test files, 10,591 tests, lint, types and build all pass.
- **The screens,** on temporary rows of our own at the test customer, desktop and phone:
  - Before: the opportunity, 13 days overdue, and both tickets were each a row of their own. The
    two unrelated tickets at one property each named the other.
  - The link window listed the customer's open tickets. Link on the temporary inspection said
    "Inspection #… is linked to this opportunity."
  - After: the opportunity's own row was gone from Work Overview. The inspection's row said
    "Opportunity: …". The opportunity said "Waiting on inspection #…, Dec 4, …" and was no
    longer overdue. The unrelated repair kept its own row and its note.
  - With a draft bid as well, it said "Waiting on inspection #…, Dec 4 and bid …, Dec 10".
  - Unlink took the inspection off again and said so.
  - The bid set to Submitted on the Bids list: the opportunity was a row again, due the Friday,
    two working days on, and not overdue. The database showed the one notice, to the
    opportunity's person only, one line in the opportunity's log, and the timer moved to 8 AM
    that Friday.
  - No sideways scroll, no page errors. The Owner page and Customers loaded clean.
- **Not pressed on the live data:** marking a ticket Done. That press tells the owner and every
  manager "ready for your review", and a temporary ticket should not do that. The same function
  runs for a ticket as for the bid that was pressed, and the tests cover the ticket's path.
- Every temporary row was removed with its history, notices and log lines. The ticket counter was
  not touched: the temporary tickets carried numbers of their own. No real ticket, opportunity or
  bid was changed.

## Left with the owner

- Publishing. Until then the live site is as it was.
- On the calendar, a ticket's chip is its number and its description, so a ticket with an empty
  description shows only its number. Suggested, not built: every ticket chip leads with the
  customer.
