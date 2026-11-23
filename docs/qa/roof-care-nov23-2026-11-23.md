# Roof Care, Nov 23: three go-aheads

The owner, Nov 23, on the new issues reported after the Nov 21 work: "for new issues go on 1,
2(credit only applies to work done after plans starts) ... 5 30 days is good".

Every date and dollar figure in this record is made up. No plan price, allowance or cost is in
it.

## 1. Every ended plan with a refund owed has its own refund line

**Before.** The property's plan card showed the refund line of the property's current plan
only. A property keeps its older plans. Once a new plan was signed there, a refund still owed
on an older ended plan could be seen under Needs attention but had no line to mark it sent.

**Now.** Under the current plan's own line, the card shows one refund line for each ended plan
of that property whose refund is owed and not yet marked sent, oldest first. Each is named:

> Roof Care plan RC-1004, Mar 10, 2026 to Mar 10, 2027, ended Jun 2, 2026

Each line has the same two buttons as before, acting on the plan it names: "Mark the refund
sent", and "Change refund" for a manager or an admin. The rights are the database's, unchanged.

**What is not listed.** A refund already marked sent, and one a manager changed to nothing. The
line is for money still to send. The current plan's own line still shows a sent refund, as it
did.

**Needs attention.** The row for a refund owed opens the property's page
(`/properties/<property>`), which is where the plan card and now the older plan's line are.

**Code.** `otherRefundsOwed()` and `refundPlanWords()` in `src/lib/roof-care-plan.ts`; the card
in `src/components/roof-care/plan-card.tsx` draws the same `RefundOwed` part once per plan.

**Trial on the live database, rolled back.** One temporary property with three plans: an ended
one with a made-up $210 owed, a second ended one with a made-up $95.50 owed, and a third in
force.

| Step                                                             | Answer                       |
| ---------------------------------------------------------------- | ---------------------------- |
| Ended plans with a refund owed and not sent                      | 2                            |
| Mark the refund sent on the oldest plan, a newer plan in force   | Accepted                     |
| Mark the refund sent on the middle plan                          | Accepted                     |
| Left owed and not sent after both                                | 0                            |
| The plan in force                                                | Untouched                    |
| Change the older plan's refund to 0 with a reason (a second run) | Accepted, the change is kept |
| Still listed as owed after the change to 0                       | No                           |

The database always took these calls for any plan. What was missing was a line on the screen
to make them from.

## 2. A plan pays only toward work done from the day it starts

**The rule.** A plan gives its minor repairs credit, and Roof Guard its leak call with no
travel charge, only to work whose day is on or after the first day of the plan's year and on or
before its last day, in force or ended. The work's day is the day the ticket was completed,
else the day on site, else the day it is scheduled for, else today (Eastern). The first day is
the plan's start, or for an older plan with none on record the day it was signed.

**Before.** A plan in force also paid toward work dated before it started.

**The owner's case.** A repair is done Mar 3. The plan starts Mar 10. The invoice is made
Mar 12. The work's day is Mar 3, before the plan's first day: no credit, and the normal trip
charge. The day the invoice is made does not matter.

**A renewal paid early.** Last year ran Dec 20, 2026 to Dec 20, 2027. The renewal is paid
Nov 20, 2027: the old plan ends that day as "Renewed", and the new year is dated Dec 20, 2027
to Dec 20, 2028. A repair done Dec 5, 2027 is in neither by the dates alone. It is the OLD
year's: a plan that ended because it was renewed runs to its year's last day. The credit comes
from what the old year has left. A repair on Dec 20, 2027 or after is the new year's. A plan
that ended for any other reason still stops the day it ended.

**The plan's own inspections.** A plan inspection's own ticket is that plan's work, also when
it was done a few days ahead of the year. A charged return trip on it, and a billed storm
inspection, still use the plan's minor repairs first.

**Drafts.** A draft invoice that carries credit for work now outside the rule loses it the next
time it is opened, saved, rebuilt or made final. The office reads:

> The Roof Care plan no longer takes anything off this invoice for minor repairs. It took
> $310.00 before. This ticket's work is dated outside the plan's year, before its first day or
> after its last. A plan pays only toward work done from the day it starts to its last day. The
> invoice total is now $760.00. It was $450.00.

A leak call's travel that was taken off comes back the same way ("The travel on this invoice,
$60.00, is charged again."). An invoice already final is not touched.

**One rule, two places.**

- The database: `roof_care_plan_covers()` and the invoice line rule
  `invoice_lines_care_rule()`,
  `supabase/migrations/20261123100000_roof_care_credit_from_the_first_day.sql`. A line that
  takes plan money off for work before the first day is refused: "This ticket's work is dated
  Mar 3, 2027, before the Roof Care plan started (Mar 10, 2027). A plan pays only toward work
  done from the day it starts. Nothing of the plan can come off this invoice."
- The screens: `planCoversDay()`, `planLastDay()`, `planForWork()` and `ownInspectionDay()` in
  `src/lib/roof-care-allowance.ts`; `planOfWork()` and `planLineOutside()` in
  `src/lib/roof-care-allowance.functions.ts`. The leak call's travel
  (`src/lib/roof-care-travel.functions.ts`) asks the same `planOfWork()`.

**Applied by hand on Nov 23**, each function checked against the file by its fingerprint
(md5 of the function's body):

| Function                  | Before      | After                              |
| ------------------------- | ----------- | ---------------------------------- |
| `invoice_lines_care_rule` | `add6d51c…` | `69f4ffe192bcad05d2fadb0dce32b4c1` |
| `roof_care_plan_covers`   | `9bef0b02…` | `4d5cf56a0f49169a50e677a0ac447ce4` |

Both keep their rights: no signed-in person can call either; the database's own roles only.

**Trial on the live database, the same script before and after, rolled back.** Temporary
property A: a plan in force that started 5 days before the trial. Temporary property B: last
year's plan, ended as "Renewed" 3 days before with 25 days of its year left, and the renewal in
force with its year starting in 25 days. Each case puts a made-up $120 of plan credit on a $300
repair invoice.

| Case                                                             | Old rule | New rule                         |
| ---------------------------------------------------------------- | -------- | -------------------------------- |
| A: work 10 days ago, before the plan started                     | Accepted | Refused: before the plan started |
| A: work on the plan's first day                                  | Accepted | Accepted                         |
| A: work 2 days ago                                               | Accepted | Accepted                         |
| B: work yesterday, in the gap, credit of the OLD plan            | Refused  | Accepted                         |
| B: work yesterday, in the gap, credit of the NEW plan            | Accepted | Refused: before the plan started |
| B: work 10 days ago, credit of the OLD plan                      | Accepted | Accepted                         |
| B: work 400 days ago, credit of the OLD plan                     | Refused  | Refused: before the plan started |
| The NEW plan's own inspection, done before its year: return trip | Accepted | Accepted                         |

What `roof_care_plan_covers()` answered, old then new: A the day before its start, true then
false; A its first day, true and true; OLD in the gap, false then true; OLD its last day, false
then true; OLD the day after, false and false; NEW in the gap, true then false; NEW its first
day, true and true.

## 3. Renewing by itself: told at least 30 days before

The owner: "30 days is good". A plan that renews by itself may charge a new, higher price only
when the customer was told it at least 30 days before the renewal day. Told later than that,
the price they last agreed to is charged, as if they had not been told.

Example, renewal day Nov 20, 2027, a made-up $2,040 agreed and $2,310 new:

| Told on      | Days before | Charged |
| ------------ | ----------- | ------- |
| Oct 21, 2027 | 30          | $2,310  |
| Oct 22, 2027 | 29          | $2,040  |
| Nov 20, 2027 | 0           | $2,040  |
| Never        |             | $2,040  |

`AUTO_RENEW_NOTICE_DAYS`, `autoRenewToldInTime()` and `autoRenewTellBy()` (the last day to tell
them: Oct 21 for that renewal) beside `autoRenewCharge()` in `src/lib/roof-care-plan.ts`.
Renewing by itself is not built: it waits on Stripe. The rule is there for that work to call.

## Tests

- New: `src/lib/roof-care-nov23.test.ts`, 34 tests. Run against the code as it was, with the
  new database file in place, 22 fail; with the database file taken away the whole file fails.
  The 12 that pass either way hold what must not change (the last day, the day after it, a
  plan waiting for payment, the Needs attention link) or read the new database file.
- Added to `src/lib/roof-care-draft-credit-nov20.test.ts`: three tests of a draft whose work is
  dated before the plan started. Two fail on the old rule; the third (work on the first day
  keeps its credit) holds what must not change.
- Older tests moved by the rule, each with a dated note:
  - `src/lib/roof-care-plan-year-nov20.test.ts`: the line that said a plan in force covers
    work dated before it started now says it does not.
  - Four test files built their plan with no signed day, which no real plan is without:
    `roof-care-draft-credit-nov20`, `roof-care-leak-calls-nov19`,
    `roof-care-trip-allowance-nov20`, `roof-care-no-access-storm-nov19`. Each plan now has one.
- The Roof Care, invoice and database-file tests that read these files pass.

## Not proven

- The refund lines were not looked at in a browser. The naming, the list and the card's markup
  are held by tests, and the two buttons' calls by the trial above.
- Renewing by itself does not exist yet, so the 30 day rule has only its own tests.

## Left behind

Nothing. Every trial was rolled back: no temporary property, plan, ticket, invoice or notice
was kept, and no real ticket, bid, invoice or setting was changed.
