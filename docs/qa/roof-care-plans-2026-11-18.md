# Roof Care plans, steps 2 and 3: plans, inspections, sign-up on site

Date: Nov 18, 2026

The owner's words: "i love the auto generating inspection idea just make sure it works, when does
that start? at sign up? will there be a visual indicator on the customer page showing theyve had
1, 2, or 3 (called storm inspection) done this year? the inspection needs to specify that it is a
care plan inspection and it needs to be able to be pushed back and the subsequent inspection
pushed back with it", "it is billed half at first visit half at second visit and invoiced", and
later "Your good to start on 1 and 2", "credit is just a name", "if it cant find the location on a
map can you just provide the address and look it up from there?"

No plan price, cost or margin number is in this record, the code, the tests or the migrations.

## What was built

### A property's plan

- **Where it shows.** Under each property on the customer's page, on the property's own page, and
  on every ticket at the property.
- **The badge.** The plan's name, two dots for the two inspections and the words, such as "1 of 2
  inspections done". A storm inspection that is done adds a mark and "and a storm inspection".
- **Under it.** Who agreed and when, who signed them up, when it renews, and each inspection with
  the days it is due between, its ticket and what it bills. The money is shown to the office, not
  to a technician.
- A property has one plan at a time.

### Sign-up, on site or in the office

Anyone signed in can press **Sign up for a Roof Care plan**. A technician can for a property they
have a ticket at.

1. Type the roof's size and press Get the price. The site works out the drive from the office and
   shows each plan's yearly price and its two halves.
2. Pick the plan.
3. Pick the first inspection: **today**, **pushed back a number of days**, or **wait for the next
   window**. The form says what dates that gives before it is pressed.
4. Type who agreed. The person signing them up is named on the plan. That is the credit.

The price is never taken from the form. The server works the drive out again and the database
works the price out again.

### The inspections

- **The windows** are March 15 to May 15 and October 15 to December 31.
- **The second inspection** is in the first window still open four months after the first, so the
  two are never in one season. It is kept inside the plan year when it fits.
- **The plan year** is twelve months from sign-up.
- **The ticket** is made by the site two weeks before an inspection is due, once. A check runs
  every morning. An inspection for today or within two weeks gets its ticket at sign-up.
- The ticket's description says what it is: "Care plan inspection (Roof Guard), visit 1 of 2".
  Its timeline says the site made it and when it is due.
- "Today" by a technician puts the ticket on that technician, scheduled for today.
- A ticket made at sign-up is announced like any new ticket. One made by the morning check is
  not: it shows as unassigned work, and the "Nobody is on it" reminder covers it.

### Push back

- The office pushes an inspection back by a number of days, from the plan or from the ticket.
- The plan's later inspection moves back by the same days, unless it is already done.
- More than 30 days past its first date, counted in all, needs a manager and a reason.
- A dated ticket moves with it, with the usual line on its timeline and notice to its technician.
- A care plan ticket cannot be dragged past its last day on the board. The message says to use
  Push back.
- When the last inspection lands past the plan year, the renewal date moves with it and the plan
  says "Running late".

### Storm inspection, and ending a plan

- **Storm inspection**: a button on a Roof Guard plan, for the office. Past the number the plan
  includes, it takes a manager. It bills nothing.
- **End plan**: a manager's, with a reason. No more tickets are made for it.

### The invoice

- When a care plan inspection is authorized, the site makes its draft invoice.
- The invoice opens with the plan's line at that visit's half of the yearly price.
- The visit's own time, materials and purchase orders are listed at no charge, with their cost
  kept, so the Owner page knows what the visit cost.
- A price typed on one of those lines, for work beyond what the plan includes, is kept.
- Anyone who makes invoices can start it from the ticket if the automatic one failed. Every other
  inspection is still a manager's to bill.

### The Owner page

Needs attention lists a care plan inspection that is past its last day, and a plan pushed past
its year.

### Another service, asked for on site

**Customer wants another service** on the same card. Type what they want. It goes to the office as
an opportunity with nobody on it, and the name of the person who took it down. The opportunity
shows "Brought in by". The list of services to tick is on hold, so it is typed in words.

### An address the map cannot find

The price follows the drive, so an address with no place had no price. Only Kentucky and Tennessee
were on the map. Now, most exact first:

1. the building, on the site's own map;
2. the street address, anywhere in the country;
3. the centre of its zip code;
4. the centre of its town.

A price from the zip code or the town says it is an estimate. With none of the four there is still
no price. A property with a point already on its record is driven to that point.

## Choices made while building

These were not asked for in so many words. Each is one line to change.

| Choice                                       | Why                                                             |
| -------------------------------------------- | --------------------------------------------------------------- |
| Four months between the two inspections      | So a September inspection is not followed by a November one     |
| Tickets two weeks ahead                      | Time to schedule, without months of "nobody is on it" reminders |
| The 30 days are counted in all, not per push | Three pushes of 20 days should not pass unseen                  |
| A storm inspection bills nothing             | The plan includes it                                            |
| No renewal yet                               | A plan is twelve months old on Nov 18, 2027 at the earliest     |

## The database

Applied by hand on the live database and checked. Safe with the older published site.

| File                                            | What it does                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `20261118240000_roof_care_plans.sql`            | Plans, inspections, the price function, sign-up, tickets, push back, storm, end, the two ticket rules, the morning check |
| `20261118250000_additional_service_request.sql` | "Brought in by" on an opportunity, and the on-site request                                                               |

Nobody writes the plan tables by hand. Every change is a function, and each decides who may.

Tried on the live database in trials that were rolled back:

- **The price** for three drives and a roof over the limit: the same figures as the Roof Care
  plans page, which matches the owner's sheet.
- **Sign-up, today**: the plan, its two inspections with the right days and halves, one ticket
  scheduled today on the person who signed it, the line on its timeline.
- **Sign-up, 10 days out**: a dated ticket with nobody on it. **The next window**: no ticket yet,
  and the second inspection ends on the plan year's last day.
- A second plan on the same property, a blank name, no drive, a roof over the limit and 0 days
  are each refused in plain words.
- The morning check run twice makes nothing the second time.
- A later day on the ticket by hand is refused. Linking or unlinking a ticket by hand is refused.
- An office user pushes 10 days. 25 more is refused for them. A manager with no reason is
  refused. With a reason it goes through, the second inspection has moved by 35 days, and the
  ticket can then take the new day.
- A storm inspection on Roof Watch is refused. On Roof Guard it makes its ticket. A second by an
  office user is refused.
- An office user starts the invoice of a care plan inspection. On a plain inspection they are
  still refused.
- An office user cannot insert or change a plan by hand, and cannot read the costing numbers.
- A technician reads the plan of a property they have a ticket at, gets a price, cannot read the
  costing numbers, cannot sign up a property they have no ticket at, and cannot push back.
- A manager ends the plan, and the property can be signed up again.
- The on-site request: the opportunity is made with the property, the customer, the typed words
  and the name. A blank is refused. A technician is refused at a property that is not theirs and
  cannot insert an opportunity by hand.

## Proof

- **Checks**: `roof-care-plan-nov18.test.ts` (64) and `roof-care-locate-nov18.test.ts` (16), with
  made-up amounts. The windows and dates against what the database gave; the indicator; push
  back; the price answer read strictly; each server function; the invoice lines and the builder;
  the Needs attention rows; the text of the database change; where the card shows.
- Four older checks updated where a pinned line changed, each with a dated note.
- Full run: 600 files, 8,686 checks pass. Lint, types and the production build are clean.
- **Browser**, as an admin, at a desk and a phone size, with every save blocked, on a temporary
  plan made for the purpose:
  - the card on the property, the customer and the ticket, with the badge, both inspections,
    the ticket link and the buttons;
  - the ticket page says "This ticket is the plan's inspection 1" and its description names the
    plan;
  - push back: 10 days shows the new last day; 40 days asks for the reason and holds the button
    until one is typed;
  - sign-up: the boxes start blank; a Kentucky, a Tennessee and an Illinois property each get
    their drive and three prices, and the further ones show what the drive added; the three
    choices for the first inspection each show their dates; the button waits for the plan, the
    choice and the name; changing the roof size asks for the price again;
  - a property with no address says so in the form;
  - the request form waits for words and names who took it down;
  - a street that does not exist with a real zip code, and with a real town and no zip, each
    give a price marked as an estimate; a town that does not exist gives none;
  - no sideways scroll, no page errors.

## Left as it was found

The temporary plan, tickets, invoices and bids were removed with everything made beside them.
Ticket numbering is back where it was. The test login is an admin.

## Not tested

- No real sign-up was pressed in a browser, so nobody was sent a test notice. The sign-up was
  proved in the database and against a stand-in.
- The automatic invoice at Authorized was proved by its checks, not on a live ticket.
- A technician's screens were not opened in a browser. Their rules were tried in the database.
- The Illinois lookup took 22 seconds, because Kentucky's map is asked first.
- Nothing was tried on a real phone.
