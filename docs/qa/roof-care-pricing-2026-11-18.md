# Roof Care plans, step 1: the price follows the drive

Date: Nov 18, 2026

The owner's words: "that sheet just shows its profitable it doesnt adjust the price to make it
profitable. we need the prices to adjust to the travel distance x paying the crew to get there and
back based on customer location". Asked how, the owner chose "at cost", and "the calulators numbers
is what we want to move forward with".

This is the first of four steps. The plan for the rest is in `docs/roof-care-plans.md`.

No plan price, cost or margin number is in this record, the code, the tests or the migration. The
owner's numbers are in the database. The tests use made-up numbers.

## What was built

### The rule

- The list price of a plan is its base price plus its price per square foot times the roof.
- The list price covers a round trip of a set length, in hours and in miles.
- A building further from the office pays more. Each trip of the plan year adds the hours over the
  covered round trip, at the crew's pay for the whole crew, and the miles over it, at the vehicle's
  cost per mile.
- Nothing is added for profit on the drive. A far building earns what a near one earns.
- A closer building pays the list price. The price never goes below it.
- Trips a year: Roof Watch 2, Roof Care 2, Roof Guard 2 plus its leak calls and storm inspections.
- The price is split in two, for the invoice at each visit. The two halves add up to the price.
- A roof over the set size gets no price. It is marked for a custom quote.

### The page

Admin, Settings, **Roof Care plans**. Only an admin opens it.

- **Labor and travel**, **Repairs and extras**, **Plan prices**, **Hours on site per visit**: every
  number of the owner's costing sheet, each in a box.
- **Profit per plan, per year**: the sheet's own table, worked out from the boxes as they are
  typed. A plan that loses money is red.
- **Try a building**: type an address and a roof size. The page works out the drive from the office
  and shows each plan's price, what the drive added, each visit's half, and the profit. Nothing is
  saved.
- With a number missing, the page says which, and shows no price. It never fills in a number of its
  own.
- An address the map cannot find gives no price: "That address could not be found on the map, so no
  price is given."

### The hours table

A roof between two sizes of the table takes the hours in between. A roof smaller than the first row
takes the first row's hours.

## The database

One change, applied by hand on the live database and checked. Safe with the older published site,
which does not read it.

| File                                    | What it does                                       |
| --------------------------------------- | -------------------------------------------------- |
| `20261118230000_roof_care_settings.sql` | One row of settings, read and written by an admin. |

The owner's numbers were typed into that row from his costing sheet. The row says so: "From the
owner's costing sheet (Nov 18)". They can be changed on the page.

A manager, an office user and a technician cannot read the row. The later steps, where a
technician or a visitor is given a price, will need a read made for them that hands out the price
and not the costs.

## Proof

- **Against the owner's sheet.** With his numbers, the engine gives the price, the cost and the
  profit of every plan on all five rows of the sheet, to the dollar. This was run outside the
  repository, because it holds his numbers.
  - One row first came out a dollar off. The sheet prints one of its hours rounded to two places
    and works with three. The database holds the three-place figure.
- **Checks.** `roof-care-nov18.test.ts`, 32 checks with made-up numbers: the list price; the drive
  added per trip and per plan; never below list; a closer building; the two halves; the cost of
  each plan built up piece by piece; the hours in between; the custom quote size; every missing
  number named; a box that is not a number; who may read and save; the drive's round trip; the
  database change; the menu and the page's access.
- One older check updated for the third Settings tab, with a dated note.
- Full run: 597 files, 8,585 checks pass. Lint, types and the production build are clean.
- **Browser**, as an admin, at a desk and a phone size, without pressing Save:
  - the profit table equals the owner's sheet row for row;
  - emptying a box shows "No price can be worked out yet", names the box and hides both tables;
  - letters in a box show "A box is not a number. Fix it to save.";
  - a building 25 miles from the office: nothing added, the list price;
  - a building about 150 miles away: the drive added on each plan, twice as much on Roof Guard,
    which has twice the trips. The amounts equal the sum done by hand, and each plan's profit is
    the same as at the list price;
  - an address that does not exist: the message above, no price;
  - no sideways scroll, no page errors.
- **As a manager**: the page is not in the menu, and its address goes to Work Overview.

## Left as it was found

Nothing was saved from the page. No temporary rows were made. The test login is an admin again.

## Not tested

- Nothing was tried on a real phone.
- The drive is worked out by the same road service the ticket travel times use. When that service
  does not answer, the drive is estimated from the straight-line distance and the page says
  "estimated" beside it. Both runs here came back "by road", so the estimated case was not seen in
  a browser.
- The roof size is typed by hand on this page. Looking it up from the building's outline comes
  with the public form.

## Changed later the same day

The owner asked: "if it cant find the location on a map can you just provide the address and look
it up from there?" An address the map cannot find is now looked up by its street anywhere in the
country, then by its zip code, then by its town. A price from the zip code or the town says it is
an estimate. Record: `docs/qa/roof-care-plans-2026-11-18.md`.
