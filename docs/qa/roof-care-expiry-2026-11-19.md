# Roof Care: a plan expires after its year

The owner, Nov 19, evening, answering what renewal left open:

> so the agreement is for one year of coverage from sign up date, and the benefits dont roll
> over, if we push it back we can follow the owed inspection rule

> we need to be notified … when a plan expires so we can reach out to renew

> the refund should take if off of roof cares income

No amount of the office's is in this file. The numbers he asked for the same evening are in the
private notes, not here.

## What changed

| Before                                                              | Now                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A plan stayed in force past its renewal date until renewed or ended | The morning run ends it as "Expired" on that date                   |
| Its minor repairs and leak calls kept working after the year        | They stop with the plan                                             |
| Pushing an inspection past the plan year moved the renewal date     | The year is twelve months. The inspection is owed at renewal        |
| Nobody was told when a plan year ran out                            | The admins and managers are told once, and Needs attention lists it |
| Only a plan in force could be renewed                               | An expired plan can be, while the property has no newer plan        |
| The Renew box leaned to half off for any inspection not done        | Not for one that is not late yet: it leans to charging in full      |
| A refund was nowhere in the income report                           | It is a row of the report, below nothing, under Roof Care           |

## How it works

- **Expiry.** A plan whose renewal date has come is ended as "Expired". Its inspections and
  their tickets are left alone. A storm inspection asked for stays.
- **On the property** the badge says "(expired)" and the card says "Expired Nov 19, 2026. What
  the plan included has stopped. It can be renewed: the new plan year starts the day the renewal
  is paid." The inspections not done are listed under it, and the office has the Renew button.
- **Renewing an expired plan** works as renewing one in force. The same two answers are offered
  for what is owed. The renewal waiting on it is shown as a renewal, not as a new sign-up.
- **The notice**: "Roof Guard plan expired: Unit 2 (Customer). Its plan year ended Sat, Dec 18.
  The minor repairs and leak calls it included have stopped. Reach out to renew it: open the
  property and press Renew for another year." Once for each plan. Not before 8:00 in the
  office, and not on a weekend: a plan that runs out on a Saturday is told on Monday. A send
  that fails is tried again on the next pass.
- **Needs attention** lists an expired plan for 60 days with what is still owed, unless the
  property has a plan in force or a renewal waiting.
- **The refund row** reads "RC-1002 refund", with a Refund mark, on the day the plan was ended.
  Its revenue is the refund below nothing. It opens the property, where the refund is marked
  sent. It shows as Final until then and as Paid after.

## How it was proven

**The live database, in a transaction that was rolled back**, after the change was applied:

| Check                                                  | Result                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| A new plan year                                        | Twelve months to the day, both inspections inside it                                                              |
| An inspection pushed back 200 days                     | The renewal date did not move; the inspection is past it                                                          |
| The morning run inside the year                        | The plan stays in force                                                                                           |
| The morning run on the renewal date                    | Ended as "Expired"; inspections and ticket kept; not yet told                                                     |
| Ending an expired plan, or pushing its inspection back | Refused, both                                                                                                     |
| The Renew box on an expired plan                       | Answers, with both inspections owed                                                                               |
| Renewed after expiry, charged in full, and paid        | New year starts on the payment, twelve months; both inspections carried for 60 days; the old year reads "Renewed" |
| A new sign-up at a property whose plan expired         | Allowed                                                                                                           |
| Renewing the expired plan after that                   | Refused: the property has a newer plan                                                                            |
| A signed-in person calling the expiry itself           | Not allowed                                                                                                       |

**A browser on the current code**, as an admin, on temporary rows at the test customer:

1. The property: "Roof Care (expired)", the expired words, both inspections listed as late, the
   Renew button, no Push back button. Needs attention: "The plan year ended Thu, Nov 19 and the
   plan was not renewed … Both inspections were not done and are still owed."
2. The Renew box: both owed, each marked late, half off picked "because it is late and no
   push-back says the customer asked". Charged in full picked by hand and renewed.
3. The property: the renewal waiting, shown as a renewal. Needs attention: the renewal not paid.
4. The income report: "RC-1002 refund · Refund · bell county", revenue below nothing.

**Two things the browser run changed.** A refund row printed 100% as its margin; it is blank
now. And the refund's temporary row was first put on a property that is not the test
customer's, by my mistake. It was moved to the test customer within minutes and then removed.
It was on the Needs attention list for that time. No notice was sent: the count was the same
before and after.

**Not proven in a browser:** the notice itself. The local server cannot send notices. It is
proven by tests against a stand-in database: once, to the right people, held before 8:00 and
on a weekend, and put back when a send fails.

Every temporary row was removed, and the ticket and plan numbers put back.

**Tests.** `src/lib/roof-care-expiry-nov19.test.ts` (19), and one added to
`src/lib/roof-care-renewal-nov19.test.ts` for the inspection that is not late yet. Five older
tests pinned what changed and were updated with a dated note.

## The database change

`supabase/migrations/20261119900000_roof_care_expiry.sql`, applied to the live database on
Nov 19 and checked there.

- `roof_care_plans.expiry_notified_at`: when the office was told.
- `roof_care_expire`: new; the morning run calls it. People cannot.
- `roof_care_push_back` and `roof_care_start`: the renewal date no longer moves.
- `roof_care_start`: an expired plan is renewed as one in force.
- `roof_care_renew`, `roof_care_renewal_offer`: an expired plan can be renewed; the box's lean.

The first four are changed where they stand, and the change stops with an error if a function
is not as the file expects.
