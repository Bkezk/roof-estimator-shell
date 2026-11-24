# A Roof Care plan that is signed and not paid, Nov 24, 2026

The owner: "will they get an notification when there is a sign up but no payement? they should
and then it should remind after 2 days if no movement."

## What changed

1. **At the sign-up.** When a plan is signed and waits for its payment, every admin and every
   manager gets a notice at once: "Roof Care plan signed, not paid: (property)". It says who
   signed it up and whether they pay by check or by card. The same goes for a renewal that waits
   for its payment.
2. **The reminder.** While the plan still waits, the same people are told again every two days:
   "Roof Care plan still not paid: (property)", with the day it was signed.
   - It goes at 8:00 on a working day, as every reminder does. Two days that end on a weekend
     are told on Monday.
   - Sending the payment link again counts as movement: the two days start over.
   - It stops by itself when the plan is paid or ended.
3. **The tick.** It is under My account › Opportunity notices › Roof Care plan, with the card
   payment and the expired plan notices.
4. **No price** is in the notice.

A plan paid by card on site still sends the first notice, because the plan is signed a moment
before the card is charged. The "paid by card" notice follows it.

## Where it lives

- Words: `src/lib/roof-care-pay-notice.ts`. Sending: `dispatchPlanPayNotices` in
  `src/lib/roof-care-notify.server.ts`.
- Called from the sign-up and the renewal (`src/lib/roof-care-plan.functions.ts`), and from the
  two scheduled runs (`src/routes/api.cron.reminders.ts`, `src/lib/followups.functions.ts`).
- Database: `supabase/migrations/20261124960000_roof_care_pay_notice.sql`: the column
  `roof_care_plans.pay_notified_at` and two functions the site's server alone may call. Applied
  on the live database; both functions match the file by fingerprint.
- The two days are `PLAN_PAY_REMIND_DAYS`. It is not a setting on a screen yet.

## Proof

- Tests: `src/lib/roof-care-pay-notice-nov24.test.ts`, 18 tests. The ones about the sending
  fail on the code of that morning: there was no such notice.
- Checks: lint 0 errors (16 warnings, as before), types clean, 677 test files and 10,374 tests
  pass, the build completes.
- On the live database, in one trial that was rolled back, with a made-up plan at the test
  customer's property: told at the sign-up; not told a second time; not told 47 hours later;
  told after 3 days, as a reminder, with the days counted; not told when the payment link went
  out the day before; told again 2 days and an hour after the link; a failed send puts it back
  and the next run picks it up; a paid plan and an ended plan are never told; a signed-in admin
  cannot call the function.

## Not proven

A real notice from a real sign-up. No plan waits for payment today, and the test server cannot
call the database function. The first real sign-up after the publish is the proof.

## The same evening: the new opportunity notice, proven with a fake opportunity

The owner: "you can make a fake opp to test thats fine". One opportunity was made through the
Opportunities page's own form on the test server, for the test customer. Within the minute the
database held one "Opened: …" notice of the new kind for each of the five admins and managers,
and for nobody else. The opportunity, its notices and its history rows were then removed. The
test server sends no phone notice and no email, so those were not part of this proof.

A technician's Additional Services form makes its opportunity when Send is pressed, not when the
form is opened: read in the code (`ServiceRequestDialog` in
`src/components/roof-care/plan-card.tsx`).
