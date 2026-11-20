# Roof Care: no access, and a further storm inspection (Nov 19, late)

The owner, on the numbered list of issues: "10. Go." and "11. Second inspection billed at
inspection price and their repair allocation contributes to the price if they have any left."

No price, rate or amount of the office's is in this file. The amounts in the tests are made up.

## 10. A visit we could not do

| Before                                                    | Now                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The site kept no record of a visit with no access         | No access on the inspection's ticket records what happened, who and when       |
| Term 7: "A missed visit is rescheduled once at no charge" | The first in a plan year is free. Each one after it is charged the return trip |
| A renewal could treat such an inspection as ours          | The inspection is marked as kept off by the customer                           |

The rule, with made-up numbers: a plan's round trip is 2 hours and the travel rates add up to 70
an hour for the crew. The first time we cannot get on the roof, nothing is charged. The second
time, 140 is charged. The third time, another 140.

- How many are free is one named number in the database (`c_free`, now 1). At 0 every one is
  charged.
- The trip rate is not typed anywhere in the code. It is the plan's own round trip in hours, at
  the standard travel rate of the technician plus that of each helper of the crew: the way a
  service invoice prices travel. When a rate is blank or the plan has no drive, no amount is
  worked out, the screen says so in words, and the office adds the charge by hand. It is never
  charged as nothing.
- Before it is pressed, the box says whether this one is free or charged. The office reads the
  amount. A technician reads "charged at our trip rate" and that the customer can call the
  office for the amount.
- Who may record one: the office, or a technician with a ticket at the property. The same ticket
  takes one a day. Not once the inspection is done.
- The admins and managers get one notice, so the inspection gets a new day. The ticket is not
  moved, and a note is written on its Activity.
- How a charge is billed: as a line of its own on that inspection's invoice, which is made by
  itself when the inspection is authorized. This path was chosen because that invoice is already
  made for every plan inspection and already goes through the office's hands. An invoice tied
  to the plan alone would have counted toward what was paid for the plan year. The database lets a
  return trip be on one invoice only.
- Where it shows: the plan lists each record, whether it was charged, and "not invoiced yet" or
  its invoice. "Used this plan year" counts them. Needs attention lists a charge that is on no
  invoice once its inspection is signed off.
- A manager can take a record off, unless its charge is on an invoice.

## 11. A storm inspection beyond the one the plan includes

| Before                                                          | Now                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| A manager could add a further storm inspection, and it was free | A further one is billed at the price of one inspection          |
| Only a manager could add it                                     | Anyone in the office can: it is paid for                        |
| Storm inspection added a ticket the moment it was pressed       | It opens a box that says first whether it is included or billed |

The owner's rule, with made-up numbers. The price of one inspection is 600.

1. 400 of minor repairs is left: the plan pays 400, the customer pays 200, 0 is left.
2. 1,000 is left: the plan pays 600, the customer pays nothing more, 400 is left.
3. None is left: the customer pays 600.

- The price of one inspection is half of Roof Watch for that roof and drive: the same amount a
  renewal takes off for an inspection we did not get to. The database works it out.
- A billed one is added only from the box, after it has said the price, what the plan pays and
  what the customer pays. The older site, which has no box, is refused with words that say why.
- The price is kept on the inspection. Its invoice is made when the inspection is authorized,
  with the inspection at that price. The minor repairs line then takes what is left of the
  allowance off that line only, never off a return trip on the same invoice. (Changed Nov 20
  at the owner's word: a charged return trip takes what is left too. See
  `docs/qa/roof-care-trip-allowance-2026-11-20.md`.)
- "Used this plan year" tells the included one from a billed one: "1 of 1 used, and 1 more
  billed". The minor repairs count what went toward it.
- A refund counts a storm inspection as an inspection done only when the plan included it.

## The agreement

Terms version 2026-11-19.4. Term 7 and term 8 say the two rules. Nothing else changed. (Since Nov 20 the
set in use is 2026-11-20.1.)

## What was proven

Tests: `src/lib/roof-care-no-access-storm-nov19.test.ts`, 29 tests. They fail on the code before
this change (the files and rules they read did not exist). Four older tests that pinned the
terms version were moved to the new version, each with a dated note.

On the live database, in one trial that was rolled back, at the test customer's property
"bowling green hardees":

1. The first no access is free, with no amount. The inspection is marked as kept off by the
   customer, and the ticket's Activity says what happened.
2. A blank note is refused. A second one on the same ticket the same day is refused.
3. The second in the plan year is charged, and the amount equals the hours of the plan's drive
   times the two travel rates on the Service rates page.
4. A technician with no ticket at the property is refused. With the ticket, they can record,
   they get no amount back, and they read only their own record.
5. Nobody can write the table directly. An office user cannot take a record off. A manager can,
   unless its return trip is on an invoice.
6. A return trip on a second invoice is refused. One that takes money off is refused.
7. An inspection that is done takes no more.
8. The storm inspection the plan includes is added at no charge.
9. The next one is refused without the confirmation, and is added with it by an office user who
   is not a manager, at half of Roof Watch for that roof.
10. The three allowance cases answer as the rule says: all of it covered, part of it, none.
11. A technician can neither read the offer nor add one.
12. A refund counts the included storm inspection as done and not the billed one.
13. The minor repairs line on the storm inspection's invoice is taken up to what is left, and
    one dollar more is refused.

In a browser, on temporary rows that were removed after:

- As a technician on a phone: the box is in the workflow and fits the screen. The first time it
  says no charge. Pressed with no note it asks for one. Pressed with a note it records, says so,
  and lists the record. A second press the same day says it is already recorded. With one on
  file the box says the next is charged, and shows no dollar amount.
- As the office: the plan lists both records, one "No charge" and one charged and "not invoiced
  yet". The tally counts them. Storm inspection opens the box, which says this one is billed,
  its price, what the plan pays and what the customer pays. Cancel adds nothing. The ticket's
  box reads the amount of the next charge.

Not pressed in a browser, because each makes a ticket or writes to real people: adding a storm
inspection, the office's own press of Record no access, and making the inspection's invoice.
Those are covered by the tests and the trial above.

## The database

`supabase/migrations/20261119990000_roof_care_no_access_paid_storm.sql`, applied by hand through
the database tool and checked function by function against the file.
