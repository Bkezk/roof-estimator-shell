# Roof Care: the plan's cleaning questions are required (Nov 20)

The owner, of the open item that a manager could finish a plan's inspection with the cleaning
questions blank: "on 2 yes those questions should be required".

## The rule

A ticket that is a Roof Care plan's own inspection does not move into Done, Authorized, Invoiced
or Closed from a stage before them while a question the plan asks at that inspection is
unanswered. It binds everybody: the technician, the office, managers and admins.

| Plan       | Asked at the year's two inspections and at one carried over |
| ---------- | ----------------------------------------------------------- |
| Roof Watch | Nothing                                                     |
| Roof Care  | Were the drains and scuppers cleaned?                       |
| Roof Guard | The drains and scuppers, and: Were the gutters cleaned?     |

A storm inspection is asked nothing. A No is an answer, with its reason.

Only the move is checked. A ticket already Done or later moves on as before, and a ticket that
is not a plan's inspection is never read.

## What was wrong

| Before                                                                              | Now                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Only the ticket workflow asked. The server behind Complete checked nothing of it    | The server refuses, for a technician and a manager alike   |
| A manager could set Done or Authorized from the ticket page's stage picker          | Refused, with the questions named and where to answer them |
| Nothing in the database held it, so any other way of writing the stage went through | The database refuses the move, whoever asks                |
| "Complete anyway" would have skipped the questions with the other gaps              | It is not offered while a question is open                 |

## Every way a ticket reaches Done or later, and what covers it

1. Complete in the workflow, and "Complete anyway": the server function checks first, then the
   database.
2. The stage picker on the ticket page, and Authorize on a Done ticket: the server function
   checks first, then the database. Authorize starts from Done, so it is not a move into it.
3. An invoice finalised or paid, which sets Invoiced or Closed: the database. A plan's
   inspection is invoiced at Authorized, so it has already passed the check by then.
4. A write to the ticket straight at the database, by anyone with a login: the database.
5. Saving the ticket form, assigning on the Tech Board, En route and On site: none of these
   sets Done or later.
6. A new ticket made already Done: not checked. Nobody with a login can make a ticket that is
   tied to a plan's inspection. The site makes those itself, at Open or Scheduled.

## Where it is enforced, and why

- The database, in a rule on the ticket's stage
  (`supabase/migrations/20261120100000_roof_care_cleaning_required.sql`). It is the one place
  every way of writing a stage ends up, so it is the rule. It asks nobody who they are.
- The two server functions also check, before anything is written. Without that, a refused
  Complete would already have stopped the technician's clock and written its time, and a
  refused stage change would already have stopped the clocks on the ticket.
- The workflow hides "Complete anyway" while a question is open, and says to answer in the
  Checklist step. With a read that failed, the button stays: the server and the database read
  the plan themselves.

The words are the same in all three: "Not answered yet: Were the drains and scuppers cleaned?
Were the gutters cleaned? This is a Roof Care plan inspection. Press Open ticket, answer Yes or
No in the Checklist step, then finish the ticket."

If the plan cannot be read, the move is refused and says so, and says that nothing was changed.

## Who can answer

Whoever may finish the ticket: its technician, or a manager or an admin. A manager or an admin
presses Open ticket on the ticket page and answers in the Checklist step, as the technician
does. An office user who is not a manager cannot set Done at all (that was already so), so the
refusal never reaches them.

"No access" is not a completion. It still records with the questions open.

## What was proven

Tests: `src/lib/cleaning-required-nov20.test.ts`, 20 tests. They fail on the code before this
change: the rule and the server check did not exist, and a manager's Complete went through.
Four older tests that pinned the changed lines were moved, each with a dated note.

On the live database, in one trial that was rolled back, at the test customer's property
"bowling green hardees", on a Roof Guard plan:

1. An admin's move to Done is refused with both questions named.
2. A manager's move to Done is refused. So is a manager's move straight to Authorized.
3. A technician's move to Done is refused.
4. With the drains answered, it is refused naming the gutters only.
5. With both answered, one of them a No with its reason, the technician moves it to Done.
6. That Done ticket then moves on to Authorized.
7. Open and Scheduled moves are allowed with the questions open.
8. No access records with the questions open, and the ticket stays Scheduled.
9. A move straight to Closed is refused.
10. On Roof Care the refusal names the drains only.
11. A Roof Watch inspection moves to Done with nothing answered.
12. A Roof Guard storm inspection moves to Done with nothing answered.
13. A carried inspection is refused like the year's own two.
14. A ticket already Done with the questions open moves on to Authorized.
15. A plain repair ticket moves to Done.

In a browser, signed in as an admin, on a temporary Roof Guard plan and its inspection ticket,
removed after:

- The ticket page's stage picker offered Open, Scheduled, Done and Authorized. Picking Done
  said "Could not change the stage: Not answered yet: Were the drains and scuppers cleaned?
  Were the gutters cleaned? This is a Roof Care plan inspection. Press Open ticket, answer Yes
  or No in the Checklist step, then finish the ticket." The picker went back to Scheduled.
  Picking Authorized said the same.
- The ticket page has the Open ticket button.
- In the workflow the bar read "Finish step 1: Checklist", with both questions in that step.
- Pressing Yes on the drains saved and read "Answered by" the admin, so an admin can answer.
  With the gutters still open the bar still read "Finish step 1: Checklist".
- No page errors.

Not shown in a browser: the Complete dialog without "Complete anyway". The bar does not offer
Complete while a question is open, so the dialog is not reached that way. The tests cover the
button's rule. Nothing that completes or moves a ticket was pressed in the browser.

Not proven: the invoice's own stage change against an open question. It writes the stage the
same way, through the same rule.

## The database

`supabase/migrations/20261120100000_roof_care_cleaning_required.sql`, applied by hand through
the database tool and checked against the file.
