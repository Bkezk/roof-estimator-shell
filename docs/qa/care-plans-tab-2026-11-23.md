# Customers: a Care plans tab (Nov 23, 2026)

The owner: "Under customers currently there is customers and vendors tab can you add a care plan
tab that shows the customers that have a plan, which plan they have, their reference number they
get when they sign up, their price, and any other pertinent details? This of course isn't viewed
by techs as nothing on the customer page is."

## What it is

A third tab on the Customers page, beside Customers and Vendors: `/customers?tab=care`. One row
for each Roof Care plan. It is a list to read and to find a plan in. Nothing is changed from it:
a row opens the customer or the property, and the plan is signed, paid, renewed and ended on the
property's page as before.

Each row shows:

- the customer and the property, each a link, with the property's town;
- who signed the customer up, and who the customer said referred them, when known;
- the plan, and "(renewal)" when it carries on from last year's;
- the roof size the plan was priced on;
- the plan's number, RC and four digits, the one on the customer's agreement and invoice;
- the yearly price, how it is paid, the day it was paid, and the minor repairs it includes;
- where it stands: Active, Waiting for payment, Expired or Ended, with the reason for an end;
- the day it renews, with how close that is inside the last 60 days;
- the next inspection still to do, in red when it is past its last day.

Over the list: a search (customer, property, town, plan or number), five views (Current, Active,
Waiting for payment, Ended or expired, All), and one line: how many plans are active, what they
bring in a year, and how many wait for payment. Current is the view it opens on: every plan that
is not over.

Order: waiting for payment first, then active plans by the day they renew, soonest first, then
the ones that are over.

On a computer it is a table. On a phone each plan is a card, so nothing scrolls sideways.

## Who reads it

People with Customers access. The Customers page is not a technician's page. The server refuses
a technician with field pages only, and anyone without Customers access, before it reads
anything. The database's own rule on the plan tables says the same.

The parts of a price never leave the server: only the yearly price.

## How it is built

- Rules: `src/lib/care-plan-list.ts`.
- Server read: `src/lib/care-plan-list.functions.ts` (`listCarePlans`). It reuses the read the
  property's page uses for a plan and its inspections, so the two cannot disagree.
- Screen: `src/components/crm/care-plans-section.tsx`, on `src/components/customers-page.tsx`.
- No database change.

## Proof

**Tests.** `src/lib/care-plan-list-nov23.test.ts`, 21 tests, with made-up prices: the rows the
server answers for an active, a waiting and an expired plan; a late inspection; no plans at all;
who is let in and who is refused; the views, the search and the order; the line over the list;
the Renews column; the screen's parts; and that the tab only reads.

**Screen**, on the local test server as the test admin, at a computer's width and a phone's:

| Step                                         | Seen                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No customer has a plan                       | Three tabs. "No customer has a Roof Care plan yet. A plan is signed from a property's page, with the Care Plan button."            |
| A temporary plan signed on the test customer | One row: waiting for payment, its number, its price, "By check", "Starts when it is paid". The line: "1 plan waiting for payment." |
| That plan paid                               | Active, the day it was paid, the day it renews, the next inspection's day. The line: "1 active plan" and its yearly price.         |
| The five views and the search                | Each shows the rows it should; a search that finds nothing says so.                                                                |
| The row's two links                          | The customer's page and the property's page.                                                                                       |
| A phone                                      | A card with the same facts. No sideways scroll.                                                                                    |

## Clean-up, checked on the live database

The temporary plan, its two inspections, its draft invoice and line and their history rows are
gone. Plans 0, inspections 0, invoices 1 (the one that was there before), notices 330
(unchanged), no ticket was made, the plan number counter is back at its next free number, and the
test login is an admin again with nothing else changed.

## Asked with it, and not built

"Also help me come up with a commission plan for reps let's base it of the minimum roof size/drive
time that's set". Choices were put to the owner with what each leaves the company. Nothing was
built. The working is in the office's private note, with the plan prices.
