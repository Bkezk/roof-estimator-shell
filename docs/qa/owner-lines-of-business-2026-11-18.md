# Owner page: regular business, trade bids and Roof Care plans, side by side

Date: Nov 18, 2026

The owner's words: "can you also include trade bids profitablility on the owner business charts as
well as the roof care plans and have the ability to compare trade bids, roof care, to just our
regular buisness as well as filter to just see roof care, trade bids, or our regular view. ensure
the numbers are correct dont assume double check".

## What changed

Owner, Business, under Margin.

- **Three lines of business.** Every row of the margin report is in exactly one.
  - **Roof Care plans**: the invoice of a plan inspection. Revenue is that visit's share of the
    plan. Cost is what the visit took: time, materials, purchase orders.
  - **Trade bids**: a won trade bid.
  - **Regular business**: everything else, as before. Service invoices and won roofing bids.
- **A Business picker** beside Include: All business, Regular business only, Trade bids only,
  Roof Care plans only. The table, the tiles and the older charts follow it.
- **Two new charts and a table**, always showing all three lines whatever is picked, so one line
  can be looked at alone and still compared:
  - By line of business: revenue, cost and margin of each line.
  - Revenue by month, by line.
  - The table: count, revenue, cost, margin and margin % of each line. With Compare on, the
    earlier period's margin beside it.
- A line under the table says how many Roof Care plans are in force today and what they bill a
  year.

Trade bids were already counted in the totals. They were not shown on their own.

## The numbers, checked twice

### By hand first, then on the page

Temporary rows were made, dated January 2020 so they sat outside the default range: a won roofing
bid, a won trade bid, a final service invoice on a plain ticket, and a final invoice on a Roof
Care plan inspection with the plan's line and the visit's labor at no charge. Each row's revenue,
cost and margin were worked out by hand before the page was opened.

| Checked                                               | Result                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| Each line's count, revenue, cost, margin and margin % | as worked out by hand, to the cent                              |
| The three lines added together                        | the Totals row, to the cent                                     |
| Regular business only                                 | the roofing bid and the plain invoice, and nothing else         |
| Trade bids only                                       | the trade bid alone                                             |
| Roof Care plans only                                  | the plan inspection's invoice alone, its cost the visit's labor |
| The three-line table while one line is picked         | unchanged: still all three                                      |
| Plans in force                                        | the one temporary plan and its yearly price                     |

### The live numbers

The live database held one won bid and no final invoice. The page showed it under Regular
business, with nothing under the other two. Its revenue and cost were summed independently in
the database and matched the page to the cent, including the sales tax paid on materials, which
counts on both sides.

## Proof

- `margin-lines-nov18.test.ts`, 20 checks with made-up amounts: which line a row is in; each
  line's totals; that the three add up to the whole; the filter; the months; the server read
  with each choice of Business, with bids left out, with a comparison period, and the plans in
  force; the screen.
- One older check updated where a pinned line changed, with a dated note.
- The three colours were run through a colour-blind separation check, light and dark. One is
  under the contrast line on a light page, which is why the table carries every figure.
- Browser, as an admin, at a desk and a phone size, with every save blocked: the two charts, the
  table, each choice of the picker, no sideways scroll, no page errors.

## Left as it was found

Every temporary row was removed. One won bid is live, as before.

## Not tested

- A real Roof Care invoice does not exist yet. The Roof Care line was proved on a temporary one.
- Nothing was tried on a real phone.
