# Inventory for year-end (Nov 16, 2026)

Owner: "I still don't love the inventory stuff, as far as reporting for EOY stuff, is it as
efficient and good as it could be especially with the reconciliation part" … "How does it handle
a situation where there's stock bought for x amount of dollars then the same material bought
later for more/less money?" … "Go with all 6, also is it exportable?"

## What was missing

Checked in the code and on the live data before anything was built:

- Stock on hand was always "right now". December 31 could only be exported on December 31.
- A count was one item at a time. No sheet for a shelf or a truck, no record of a count.
- Nothing recorded stock coming in at a price. Value was today's Setup cost times what is on
  hand, so a price changed in March changed December's value with it.
- No year summary.

## What was built

| # | Fix                        | Where                                                                |
| - | -------------------------- | -------------------------------------------------------------------- |
| 1 | Year-end count             | Inventory › Count (`inventory-count-tab.tsx`, `inventory-count.functions.ts`) |
| 2 | Stock as of a day          | Export › Stock on hand, "As of the end of" (`inventory-export*.ts`)  |
| 3 | Year summary               | Inventory › Year end (`inventory-year-end-tab.tsx`, `inventory-year-end.ts`) |
| 4 | Receiving                  | Put in inventory › "Bought or delivered" is a Received entry         |
| 5 | Cost kept with each entry  | `inventory-cost.ts`, table `inventory_movement_costs`                |
| 6 | Opening stock              | Count with "This is the opening count" ticked, a cost per line       |

Everything is exportable as a spreadsheet file: stock as of any day, the year summary, each
saved count, and the movements with their costs.

## The cost method

Moving average per item, one average for the whole company (the shop and every vehicle share
it). The owner's example, which the tests and the browser run both reproduce to the cent:

| Step              | Average | On hand | Value  |
| ----------------- | ------- | ------- | ------ |
| Buy 10 at $90     | $90.00  | 10      | $900   |
| Buy 10 at $100    | $95.00  | 20      | $1,900 |
| Use 5 on a ticket | $95.00  | 15      | $1,425 |
| Buy 5 at $110     | $98.75  | 20      | $1,975 |

The database stores one thing: the price paid per stock unit on an entry that brought stock in.
Every other number is worked out by replaying the entries oldest first, so a price corrected
later corrects everything that followed from it.

- A take costs the average on the day it was taken.
- A put-back comes in at what that job's takes cost.
- Stock found in a count comes in at the average.
- A leftover or a receipt with no price typed stands at the average (the Setup cost when there
  is none) and is listed on Year end as needing a price. Its numbers are marked as estimates.
- Stock that comes in while an item is at or below zero starts the average afresh. The value
  that moves because of that is its own line, "Revalued", so the lines still add up.

## Rules

- Dollars are an admin's and a manager's (owner, Oct 15). The price table refuses everyone else
  by its own policy. The Count and Year end tabs show only to admins and managers.
- A count is saved in one database transaction. What inventory expected is read there, never
  taken from the browser.
- A count may be dated before today. It is compared with what inventory held at the end of that
  day and its corrections are dated then, so stock as of that day includes them.
- A purchase order holds one total, not lines. The price on a leftover is typed; the ticket's
  purchase orders are shown beside the box.

## Database

`supabase/migrations/20261116170000_inventory_year_end.sql`, applied to the live database by
hand and checked: three tables (`inventory_movement_costs`, `inventory_counts`,
`inventory_count_lines`), two entry types (`received`, `opening`),
`inventory_movements.count_id`, the function `inventory_save_count`, and `received` added to
what the Put in form may record. No existing row was changed.

Proven on the live database in runs that were rolled back, as a manager, an estimator and a
technician:

- a manager's count saved 4 lines, 3 corrections and 1 price; a line that matched made no entry;
- an estimator saved a count and saw no prices; a count with a price from an estimator was
  refused whole;
- a technician could not count, saw no counts, lines or prices;
- a count dated Dec 31, 2025 expected the Dec 31 quantity and dated its correction
  Dec 31, 11:59:59 PM office time; a future date was refused.

## Tests

| File                                   | Tests | What                                              |
| -------------------------------------- | ----- | ------------------------------------------------- |
| `inventory-cost-nov16.test.ts`         | 30    | the cost rules, every number worked by hand       |
| `inventory-year-end-nov16.test.ts`     | 41    | server functions, exports, counts, access         |
| `inventory-count-tab-nov16.test.ts`    | 59    | the Count screen and its helpers                  |
| `inventory-year-end-tab-nov16.test.ts` | 59    | the Year end screen and its helpers               |

Five older test files were updated with dated notes where they pinned the old behaviour
(Setup-cost values in the exports, three tabs, "Bought or delivered" as a leftover).

Chain: eslint 0 errors, tsc clean, 574 files / 7,785 tests pass, production build succeeds.

## Browser run

On the local build against the live database, signed in as the test login (an admin), on a
temporary truck with temporary entries. Nothing real was counted or changed.

| Check                                               | Expected by hand        | Shown        |
| --------------------------------------------------- | ----------------------- | ------------ |
| Stock as of Dec 31, 2025                            | 15 at $95.00 = $1,425   | the same     |
| 2025 summary                                        | 1,900 in, 475 out, 1,425 | the same    |
| 2026 before a price was typed                       | from jobs $197.50, closing $2,172.50, estimate | the same |
| Price $80 typed on the leftover                     | from jobs $160, closing $2,135, average $97.0455 | the same |
| Count today: 20 of 22                               | −2, −$194.09            | the same     |
| Added item, 1 box + 250 of 1,000, cost $290         | +1.25 boxes, +$362.50   | the same     |
| Count dated Dec 31, 2025: 14 of 15                  | −1, −$95.00             | the same     |
| Received 3 at $120 on the Put in form               | "= $360.00 for 3 gal"   | the same     |
| 2026 after all of that                              | 1,330 + 910 + 160 − 194.29 = 2,205.71 | the same |

Also seen: number boxes start blank; a price that is not a number is refused in plain words; the
export refuses a future day; switching the sheet or leaving the tab with counts typed asks
first; no sideways scroll at phone width; an estimator who is not a manager sees no new tab, no
price box and no dollar sign.

Afterwards the temporary rows were removed and the counts checked against the start: 36
entries, 0 counts, 0 count lines, 0 prices, 5 places, the audit log unchanged, the test login as
it was.

## Left for the owner

- The 36 entries in inventory today are test entries. They are still there: nothing is cleared
  without a yes.
- Opening stock is loaded with an opening count. Loading it from the spreadsheet is a data
  import and waits for a yes too.
- The method is average cost. If the accountant files first in, first out, only the calculation
  in `inventory-cost.ts` changes.
