# Roof Care: a charged return trip takes the minor repairs first (Nov 20)

The owner, of the trip charge after a visit we could not do: "10. it comes out of the allocation
if there is allocation left correct?"

It did not. As built the day before, the plan's minor repairs went toward a billed storm
inspection only, and a return trip was the customer's in full. It does now.

No price, rate or amount of the office's is in this file. The amounts in the tests are made up.

## The rule

A charged return trip is paid from what is left of the plan's minor repairs first. The customer
pays the rest. With made-up numbers, a return trip of 140:

1. 80 of minor repairs is left: the plan pays 80, the customer pays 60, 0 is left.
2. 300 is left: the plan pays 140, the customer pays nothing more, 160 is left.
3. None is left: the customer pays 140.

- A plan with no minor repairs (Roof Watch) pays nothing toward it. The customer pays the trip.
- The first visit in a plan year that we could not do is still free. Nothing is taken for it.
- The amount taken counts as minor repairs used: on the plan's tally, and in a refund.

## Where it is done

| Before                                                          | Now                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| The inspection's invoice took nothing from the minor repairs    | Its minor repairs line goes toward the return trip, and only that  |
| The line on a storm inspection's invoice left a return trip out | It goes toward the inspection and the return trip                  |
| The No access box said "charged" and the amount                 | It also says what the minor repairs pay and what the customer pays |
| Term 7 ended at "charged at our trip rate"                      | It adds that the minor repairs amount is used toward it first      |

- The line is put on by itself, as on a repair's invoice. The customer reads "your minor repairs
  amount used toward the return trip". The office can still press Does not use the plan.
- The database already refuses a line that takes more than the plan has left.
- Before No access is pressed, the office reads what is left today and the split. A technician
  reads the rule with no amount, and that the customer can call the office.
- "Today", because a repair invoiced before the inspection's invoice is made takes its share
  first. The invoice has the last word.

## The agreement

Terms version 2026-11-20.1. Term 7 now ends: "After that, the return trip is charged at our trip
rate, and what is left of the plan's minor repairs amount is used toward it first."

## What was proven

Tests: `src/lib/roof-care-trip-allowance-nov20.test.ts`, 16 tests. They fail on the code before
this change. One test of the day before pinned the old rule ("never a return trip on the same
invoice") and was moved to the new one with a dated note. Five pins of the terms version were
moved.

On the live database, on temporary rows at the test customer's "site 2" that were removed after.
A Roof Care plan, its spring inspection, one free and one charged visit we could not do, and
that inspection's draft invoice with the return trip on it. The site's own invoice step was then
run as the test login, three times:

1. All of the minor repairs left: the line took the whole return trip and the invoice came to
   nothing owed.
2. Part left, after a repair's invoice had used most of it: the line took what was left and the
   invoice billed the rest.
3. None left: no line was put on and the invoice billed the whole return trip.

Also there:

4. One dollar more than the plan had left was refused by the database.
5. The box's answer for the office carried what is left. For a technician with the ticket it
   carried no amount and nothing of what is left, only that the plan includes minor repairs.

In a browser, as the office, on the same temporary rows: the No access box on the ticket said
the return trip is charged, its amount, that nothing was left of the minor repairs, and what the
customer pays. The plan's tally counted the amount as minor repairs used. Nothing was pressed
that records anything. No page errors.

Not proven in a browser: the invoice made by itself when the inspection is authorized, because
that step writes to real people. The step it runs is the one proven above against the live
database.

## The database

`supabase/migrations/20261120200000_roof_care_trip_from_allowance.sql`: one function,
`roof_care_no_access_preview`, applied by hand through the database tool and checked against the
file.
