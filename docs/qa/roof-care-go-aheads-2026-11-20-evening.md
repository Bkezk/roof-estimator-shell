# Roof Care: the owner's go-aheads of Nov 20, evening

The owner, after the break test's fixes: "go with 2, 11, 25, 31 ( we should probably ensure if
someone ticks auto renew we dont charge them more if prices change and they auto renew w/o
knowing)", "go with 4" (the 8:00 notice), "why does it say billed at each visit?", and later
"go with ... 14, new issue 1, new issue 2". Number 2 (a draft invoice's credit) has its own
record. Dollar figures here are made up; the office's own prices and costs are not in this file.

## The rules, each with an example

**11. The smallest return trip.** A return trip after a visit we could not do is worked on the
property's own round trip, and never less than the round trip the list price covers: the larger
hours and the larger miles, each on its own. Then as before: the higher of what the rates come
to and what the trip costs us.

- A property a quarter of an hour away is charged what a property at the baseline drive is
  charged. Before, it was charged a few dollars.
- A plan priced on a drive of 0 now has an amount. Before, it had none.
- A property two and a half times the baseline drive away is charged its own drive, as before.

**25. The database refuses nonsense itself.** The screens always checked. A signed-in person
calling the database directly could still save a plan from a drive that was "not a number", from
500 hours, with any text as its terms, with no way of paying, or at a price nobody was shown. Now
each is refused in the screens' own words:

- "The drive to this property did not come out as a real round trip (at most 24 hours and 2,000
  miles), so there is no price."
- "The plan's terms could not be read, so nothing was signed."
- "Pick how they are paying: by check or by card"
- "The price changed: this plan is now $…, not the $… shown."

**31. Settings changed during a plan's year.**

- The storm inspections a plan includes are kept on the plan when it is signed or renewed.
  Example: a Roof Guard plan signed when the setting was 1 still includes 1 after the setting is
  raised to 3; a plan signed after the change includes 3; lowered to 0, the first plan still
  includes its 1.
- What a return trip is charged and what a further storm inspection is billed follow today's
  settings. Unchanged, and pinned by a test.
- A renewal paid before the old year is over loses no day. Example: the old year runs Dec 20,
  2025 to Dec 20, 2026. The renewal is paid on Nov 20, 2026. The old plan ends as "Renewed" that
  day and the new one is in force at once; its year is dated Dec 20, 2026 to Dec 20, 2027; its
  inspections are due Mar 15 to May 15, 2027 and Oct 15 to Dec 20, 2027. The receipt says "Your
  new plan year starts Dec 20, 2026, the day your current plan year ends … You are covered
  without a break." A renewal paid ten days after the old year ran out is dated from the payment.
  The dating itself was already in the database; what changed is the receipt's words (it said
  "Your plan started Dec 20, 2026" a month early) and the tests that hold it.
- **Renewing by itself** (not built; it comes with Stripe). The rule it has to keep: never more
  than the yearly price last agreed to, unless the customer was told the new price before the
  renewal day and the telling is on record. Example: agreed at $2,000, the price is now $2,300
  and nobody told them: $2,000 is charged and the office hears it. Told $2,300 a month before:
  $2,300. A price that went down to $1,900: $1,900. Written and tested as `autoRenewCharge()`.

**The 8:00 notice does not repeat (new issue 4).** People with the same tickets share one
notice. Example: tickets #7001 and #7002 are made in the morning; #7002 is the manager's own.
The admin's notice names both and goes out; the manager's, which names #7001, fails. The next
run tells the manager about #7001 and nobody else. Before, the admin heard #7001 a second time.

**"Billed at each visit" is gone** from Try a building on the price page. A plan is paid for the
year before it starts, so the yearly price is the one amount.

**14. A first inspection pushed too far.** The second inspection is at least four months after
the first, in an inspection window with two weeks left. Example, signing on Nov 20, 2026: 245
days puts the first inspection on Jul 23, 2027 and the second on the plan's last day, Nov 20, 2027. 246 days would put the second in March 2028, after the plan ends, so it is refused: "The
second inspection would fall after the plan ends. Choose 245 days or fewer, or pick the
inspection window." The line is red under the days box and the button stays off. The office
does nothing else. A plan paid later than it was signed, whose number no longer fits on the
payment day, is not refused: the first inspection is brought forward to the last day that fits.

**A manager can change a refund that is owed (new issue 2).** On the property page, the plan's
card of an ended plan: "Change refund", for a manager or an admin. Example: the plan ended early
and $612.00 was worked out to send back. Then the customer's own check bounced. The manager
types 0 and "check bounced". The card says "No refund is owed. Changed from $612.00 to $0.00 by
Mo Manager on Nov 20, 2026: check bounced". The Needs attention row goes, the Roof Care income
takes nothing off, and the bounced payment can now come off the plan's invoice. An amount above
what was paid for the year, one below zero, no reason, and a refund already marked sent are each
refused.

**Card money to send back can be marked sent back (new issue 1).** Example: a card payment of
$840.00 comes in for a plan that was already paid by check. The Owner page lists it in red: "A
card payment has to go back to the customer. The plan was already paid when this card payment
came in. Reference pi_9. …". On the plan's card a manager or an admin types the day and a
reference and presses "Mark sent back". The row goes and the card says "Sent back $840.00 on Nov
21, 2026 (re_3) by Mo Manager."

## Where it is

| What                                  | Where                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The smallest return trip              | `20261120810000`; `returnTripDrive`, `tripChargeNote` in `src/lib/roof-care-price.ts`                                  |
| The storm count kept on the plan      | `20261120820000`; `ownStormCount` in `src/lib/roof-care-plan.ts`; `roof-care-plan.functions.ts`                        |
| Nonsense refused                      | `20261120830000`; the server sends `p_shown_price`                                                                     |
| Who was told about a site-made ticket | `20261120840000`; `roof-care-ticket-announce.ts` and `.server.ts`                                                      |
| A first inspection pushed too far     | `20261120842000`; `maxFirstDays`, `firstDaysProblem` in `src/lib/roof-care-plan.ts`; the sign-up in `plan-card.tsx`    |
| Change refund                         | `20261120844000`; `RefundOwed` in `plan-card.tsx`; `changeRoofCareRefund`                                              |
| Card money sent back                  | `20261120846000`; `CardBackLine` in `plan-card.tsx`; `care_plan_card_back` in `owner-attention.ts`; `careCardBackOwed` |
| The receipt for a renewal paid early  | `receiptEmail` in `src/lib/roof-care-email.ts`                                                                         |
| The auto renew price rule             | `autoRenewCharge` in `src/lib/roof-care-plan.ts`; `docs/roof-care-plans.md`                                            |
| "Billed at each visit" removed        | `src/components/roof-care-settings.tsx`; `PlanPrice` in `src/lib/roof-care-price.ts`                                   |

## Proof

**Tests.** `src/lib/roof-care-go-aheads-nov20-evening.test.ts`, 48 tests. With the changed
source files put back to the commit before (the new migrations left in place), 33 fail; the 15
that still pass read the new migration files, which the old code does not have, or pin a rule
that was already true and must stay. Older pins moved by these changes carry a dated note
(`roof-care-nov18`, `roof-care-floor-nov19`, `roof-care-audit-fixes-nov19`,
`roof-care-trip-rate-nov20`, `roof-care-plan-nov18`, `roof-care-customer-facing-nov19`,
`roof-care-leak-calls-nov19`, `roof-care-break-tickets-nov20`).

**Database.** The seven migrations were applied by hand. All 13 functions they define have the
same fingerprint on the live database as in their files, each exists once, and the rights are
as before (the trip charge, the storm state, the plan start and the ticket functions are the
server's alone).

**Rolled-back trials on the live database**, on temporary properties of the test customer,
signed in as an admin, an office user and a technician:

| Tried                                                                         | Result                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Price from a drive that is not a number, without end, 500 hours, 2,000.5 mi   | Refused, each                                                      |
| Price at 24 hours and 2,000 miles; with no drive; a 9,000,000 sq ft roof      | Answered; answered; custom quote                                   |
| Sign-up with any terms text, pay "bitcoin", no pay method, a shown price of 7 | Refused, each, in plain words                                      |
| The real sign-up with the shown price, and as the published site calls it     | Saved, at the price shown                                          |
| Return trip of a plan a quarter of an hour away, and of one at drive 0        | The same as a plan at the baseline drive                           |
| Return trip at 2.5 times the baseline; twice the hours and 5 miles            | 2.5 times the baseline charge; its own hours, the baseline miles   |
| Storm inspections after the setting is raised, lowered, and for a new plan    | The signed plan keeps its number; the new plan takes the new one   |
| A renewal paid 30 days early, and one paid 10 days late                       | Dated from the old year's last day; from the payment               |
| The new year right after an early renewal                                     | In force, not expired by the morning run, renewal not open yet     |
| Largest days that fit, for ten sign-up days                                   | The same numbers the screen's rule gives (in the test)             |
| Sign-up at 250 days, at the largest plus one, at the largest                  | Refused; refused; saved                                            |
| A plan paid with 300 days on it                                               | Started; first inspection brought forward to the largest that fits |
| Take the payment off while a refund stands; after the refund is 0             | Refused; done                                                      |
| Change a refund as an office user, as a technician                            | Refused, each                                                      |
| Refund above what was paid, below zero, not a number, no reason, the same     | Refused, each                                                      |
| Refund to 0 with "check bounced"; changed again; then marked sent             | Kept with who and when; two changes kept; no more changes          |
| Card payment for an ended plan, for a plan paid by check, 37 over             | Send back; send back; started with 37 over: three to send back     |
| Mark sent back as an office user; a day to come; a day before it came in      | Refused, each                                                      |
| Mark sent back; twice; a payment with nothing over                            | Kept with who; refused; refused                                    |
| Who reads the card payments                                                   | An admin all three; a technician none                              |
| Who was told: marked, marked again, listed, the ticket removed                | 2, 0, 2, 0                                                         |

**Browser** (the test login, an admin, on the local site):

- Setup, Roof Care: the columns of Try a building are Plan, List price, Added for the drive,
  Price a year, Cost, Profit. The trip note ends with the smallest-return-trip line. Save was
  not pressed.
- The sign-up at the test property: 30 days shows no red line; 300 days shows "… Choose 245
  days or fewer, or pick the inspection window." and the button is off. The sign-up was not
  pressed.
- On a temporary ended plan at the test property: "Refund owed: $612.00." with Change refund;
  amount 0 with no reason keeps Save off; an amount above what was paid is refused in words; 0
  with "check bounced" gives "No refund is owed. Changed from $612.00 to $0.00 by Claude on Nov
  20, 2026: check bounced" and "Mark the refund sent" is gone. A temporary card payment shows
  "Card money to send back: $77.00. The plan had ended when this card payment came in. …" and,
  after Mark sent back, "Sent back $77.00 on Nov 20, 2026 (re_zz) by Claude."

The temporary plan and its card payment were removed afterwards, the plan counter was put back,
and the office's settings were not changed (their fingerprint is the same as before).

## Not proven

- A real card payment, a real email and a real 8:00 run: none was sent. The rules are proven by
  the trials and by the tests' stand-in database.
- The Owner page's row for card money was proven by its rule and its server read in tests, not
  on the page: no card payment exists.
