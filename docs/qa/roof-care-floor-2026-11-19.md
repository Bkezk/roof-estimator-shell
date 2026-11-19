# Roof Care: a floor under the price

The owner, Nov 19:

> lets make it to where the minimum roof size pricing is always priced at … sq feet so its never
> not profitable, thats the floor similarly to where drive time is minimum of 2 hrs no matter what

No amount of the office's is in this file. The floor itself is a number of the price setup, in
the database.

## What changed

| Before                                                                                | Now                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A small roof paid for its own size. The fixed work of two inspections could cost more | A roof under the floor pays the price of the floor size, on all three plans   |
| The price setup had no smallest size                                                  | A box, "Smallest roof the price is worked for (sq ft)". Blank means no floor  |
| A save of the price setup replaced it whole                                           | A save from a page that does not know the floor keeps the floor already there |

What does not change:

- A roof at the floor or over it is priced as before.
- A long drive is still added on top, and the customer still sees one price.
- A roof over the custom-quote size still gets a custom quote.
- The plan keeps the roof's own size.
- The cost and profit shown to admins on the Setup page are the real roof's. The floor's whole
  difference in price is profit.

## Why the save rule

The published site and a tab left open across a publish run the price setup page as it was. That
page saves the setup whole, without the floor. Without the rule, one press of Save there would
have removed the floor with no word said. The current page always sends the floor, as a number or
as blank, so it is still changed and removed on the Setup page.

## How it was proven

**The live database.**

| Check                                                                         | Result                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| Ten roof sizes by two drives, three plans each: the database against the page | The same on all 60 prices                |
| Every size at or under the floor                                              | One price per plan, the floor size's     |
| One square foot over the floor, and larger roofs                              | Their own size's price, as before        |
| One square foot over the custom-quote size                                    | A custom quote                           |
| A far property at the floor                                                   | The floor price plus the drive           |
| An older page saves the setup without the floor (rolled back)                 | The floor kept, every other number saved |
| The current page types another floor (rolled back)                            | Changed                                  |
| The current page blanks the floor (rolled back)                               | No floor: a small roof pays its own size |
| Who may ask for a price                                                       | Unchanged: signed-in people only         |

**A browser on the current code**, as an admin, with every save blocked: the Setup page shows the
box, after "Custom quote for roofs over", holding the office's floor. Save was not pressed.

**Tests.** `src/lib/roof-care-floor-nov19.test.ts`, with made-up numbers. Eleven of them fail on
the code as it was.

## The database change

`supabase/migrations/20261119400000_roof_care_price_floor.sql`, applied to the live database on
Nov 19 and checked there: one line of `roof_care_price`, and the rule
`roof_care_settings_keep_floor`. The floor was typed into the price setup at the owner's word.
