# Margin report and Business tab: numbers check, Nov 16 2026

The owner asked two things about the Margin report: what "Other" in the cost mix holds and
what "Avg / item" means, then "add a hover note for both please. also do a check and ensure the
numbers on those pages are correct as thats essential that they are".

## The hover notes

| Where | Note |
|---|---|
| "Other" in the cost mix legend and the table heading | Costs that are not material, labor and travel, or a purchase order. On a won bid: warranty, shipping, per diem and commission. On an invoice: the cost of the lines whose type is Other. |
| "Avg / item" heading | Revenue before tax, divided by the number of invoices and won bids in the row. An item is one invoice or one won bid. |

The average note follows the Include picker ("Avg / invoice", "Avg / bid"). A dotted underline
marks a heading that has a note. Tests: `margin-notes-nov16.test.ts`, which also checks the
notes against the rules they describe.

## The check

### Live numbers

The database held one won bid and no finalised invoice. Every figure the report showed for it
matched an independent sum from the database to the cent: revenue, material, labor, other,
cost, margin, margin %, hours and the average.

The bid was then opened in the estimator, read only, and its own summary compared line by line:

| Report | Bid's own summary | Match |
|---|---|---|
| Material | membrane + accessories − discounts | yes |
| Labor & travel | Labor | yes |
| Other | Shipping | yes |
| Margin | Markup value | yes, to the cent |
| Revenue | Bid total − sales tax | yes |

Nothing was saved: the bid's last-changed stamp was the same before and after, and no lock
was left.

The Business tab's tiles were checked against the database the same way: Authorized not
invoiced and its oldest age, Pipeline, closing this month, Won / Lost this month, and the
follow-ups on hold. All matched.

### The invoice path, on test invoices

With no real invoice to check, six temporary invoices were made on two temporary tickets,
dated December 2019 to February 2020 so they sat outside the report's default range. Their
numbers were worked out by hand first:

- two paid invoices on one ticket, with labor, travel, material and Other lines
- one purchase order billed as a line on the second invoice, one billed nowhere
- a draft and a void invoice, which must count nowhere
- one paid invoice on a ticket with nobody assigned, in the next month
- one invoice a day before the range

| Checked | Result |
|---|---|
| By month, by customer, by technician | every cell as worked out by hand, after the fix below |
| Totals row | matches the sum of its rows in each grouping |
| Draft and void invoices | counted nowhere |
| Invoice outside the range | left out; counted when the range was widened |
| Service only, Bids only | right rows; "No won bids in this range" |
| CSV export | same figures as the table |
| Cost mix tooltip | January and February as worked out by hand |
| Compare, February against January | revenue, cost, margin and margin points all correct |

### One figure was wrong, and is fixed

A purchase order added after a ticket's first invoice and billed as a line on its second was
counted twice: in the second invoice's material cost and again in the first invoice's purchase
orders. On the test invoices January read $105 of purchase orders where $80 was true, and a
margin of $385 where $410 was true. The invoice page's "Internal — cost and margin" fold had
the same double count.

Now a purchase order billed as a line on any live invoice of the ticket is counted there,
once. A void invoice's lines do not count; a draft's do. After the fix the report read $80,
$545 of cost, $410 of margin and 42.9%, and the first invoice's fold read $80.

Tests: `po-counted-once-nov16.test.ts`, built from the invoices that found it. Ten of the 14
new tests fail on the old code.

## Two things left as they are, for the owner to decide

- **A bid's margin %.** The report divides by revenue before tax. A bid priced at a gross
  profit % that includes material sales tax in its total reads slightly higher in the report
  than on the bid. The dollars of margin are the same.
- **The invoice page's fold.** It takes margin off the invoice total including sales tax; the
  report takes it off the subtotal before tax. On a taxed invoice the fold reads higher by the
  tax collected.

## Checks

prettier, eslint (0 errors, the same 16 warnings), tsc and build clean. vitest: 569 files,
7,583 tests, all pass. Every temporary row was removed and the counts match the start.
