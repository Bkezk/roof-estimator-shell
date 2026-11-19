# Roof Care: was the plan offered?

The owner, Nov 19, night:

> we also need to track if the care plan was even offered so track the care plan button click on
> the ticket to ensure it's being offered.

## What changed

| Before                                                   | Now                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Nothing was kept when Care Plan was pressed              | The press is kept: which ticket, who, when, and whether the property had a plan      |
| A ticket said nothing of the plan being shown            | The office sees a line under the buttons: who opened it and when, or that nobody has |
| Nobody could tell who offers the plan and who never does | Owner page, Business tab: for each technician, opened on how many finished tickets   |

## The rules

- A press is kept on a ticket only: the ticket screen and the two bars of the workflow. The
  buttons on a property's own page keep nothing, because there is no ticket.
- One row for each person on each ticket. Pressing again adds nothing.
- Only someone who may work the ticket can mark it: the office, or a technician with a ticket at
  that property. The database writes the row; nobody can write or remove one directly.
- The office reads every row. A technician reads their own.
- The rows go with their ticket if a ticket is removed for good.

## The count on the Owner page

"Care Plan offered, last 30 days", one line for each technician, the one who opens it least
first: "Opened on 3 of 8 finished tickets. 1 signed up." and the numbers of the tickets it was
not opened on, as links.

A ticket counts when all of these hold:

- it was finished in the last 30 days, by the office's calendar;
- it has a property;
- it is not one of a plan's own inspections;
- the property had no plan the day it was finished. A plan signed within 7 days before that day
  counts as signed on that visit, not as a plan the property already had.

"Opened" means the Care Plan button was pressed on that ticket, by anyone. It shows the screen
was opened. It cannot show what was said to the customer.

## Proof

Tests: `src/lib/care-plan-offers-nov19.test.ts`, 14 tests. Three older pins on the button's
call sites were updated with a dated note.

Live database, one trial rolled back at the end, 11 checks, all as expected:

1. Pressed twice by one person: one row, with the name and the property.
2. A technician with no ticket at the property is refused.
3. The technician on the ticket can mark it.
4. That technician reads one row, their own.
5. A direct insert is refused.
6. A direct delete is refused.
7. The office reads both rows.
8. Pressed where a plan already waits: kept as "had a plan".
9. A deleted ticket is refused.
10. Nobody signed out can mark.
11. The rows went when the ticket was removed.

Browser, two temporary finished tickets at the test customer's "site 2":

- The Owner page read "Opened on 0 of 2 finished tickets" for the test login, with both ticket
  numbers.
- The ticket said "Care Plan has not been opened on this ticket."
- After pressing Care Plan the sign-up opened, and the line named who opened it and the day.
- A second press left it at one.
- The Owner page then read "Opened on 1 of 2", with the other ticket as a link.
- No page errors. The two tickets and their rows were removed.

## A technician's own press on a phone (Nov 19, evening)

The owner asked for this one. An emulated iPhone 13 in the browser, signed in as a login set to
technician only for the test, with one temporary ticket at the test customer's "site 2" assigned
to it.

- The login landed on the technician's day, with the ticket on its list.
- The pinned bar of the ticket's workflow had the Care Plan button.
- The line that says who opened Care Plan did not show. It is for the office.
- Pressing Care Plan opened the customer's sign-up with its three plans.
- A second press opened it again.
- The database kept one row for the two presses, with the technician's name, the right property
  and "had no plan".
- The ticket and its row were removed, and the login was set back.

The test opened the workflow by its address. Its tap on the ticket's number in the list opened
nothing, and that is right: for a technician the number and name are words, not a link (the
owner's rule of Nov 18), and the card's own button goes to the same address the test opened.

Not proven: the same press on a real phone in a technician's hand.
