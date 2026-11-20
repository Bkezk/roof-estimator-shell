# Roof Care: a trip rate of its own for a return trip (Nov 20)

The owner, of the issue that a charged return trip came out under what the trip costs: "2. go".

No price, rate or amount of the office's is in this file. The amounts in the tests are made up.

## What changed

| Before                                                                 | Now                                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A return trip was charged the hours at the Service rates' travel rates | The Roof Care price page has two boxes for it: per hour, and per mile   |
| No miles were counted                                                  | With either box typed, the charge is the plan's own round trip at them  |
| Nothing said what the trip costs us                                    | A line under the boxes says what the trip costs us and what they charge |

- Both boxes start blank. While both are blank nothing changes: the travel rates are used.
- The per hour box is for the whole crew, for each hour of the round trip. The per mile box is
  for each mile of it. One box alone is enough.
- A 0 is read as a blank, never as a charge of nothing. A charge that cannot be worked out is
  still said so on the screen, as before.
- The line under the boxes is worked for the round trip the list price covers, from the crew
  and vehicle costs typed on the same page. When the boxes charge less than the trip costs us,
  it says by how much.
- Which rate is used is decided in the database (`roof_care_trip_charge`), so the No access box,
  the plan and the inspection's invoice all follow it.

## What was proven

Tests: `src/lib/roof-care-trip-rate-nov20.test.ts`, 8 tests. They fail on the code before this
change.

On the live database, in one trial that was rolled back, on a plan with a round trip of 1 hour
and 50 miles at the test customer's "site 2". The price setup was changed inside the trial only
and is as it was:

1. Both blank: the charge was the hour at the travel rates, as before.
2. Both typed: the hour at the one rate plus the miles at the other.
3. The per mile box alone: the miles only.
4. The per hour box alone: the hour only.
5. Zeros: read as blank, the travel rates again.
6. With both typed, the No access box before a second visit we could not do read that amount.

In a browser, as an admin, on the Roof Care price page: the two boxes were there and blank, with
the line saying what the list price's round trip costs us. Typing into them changed the line,
and a low rate added how far under the cost it is. The boxes were put back blank. Save was never
pressed and nothing was sent. No sideways scroll at phone width. No page errors.

## The database

`supabase/migrations/20261120300000_roof_care_trip_rate.sql`: one function,
`roof_care_trip_charge`, applied by hand through the database tool and checked against the file.
