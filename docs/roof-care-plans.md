# Roof Care plans and the QR forms: what was decided, what is open

Started Nov 18, 2026. This is the working file for a feature that is being built in steps. Read it
before touching anything about Roof Care plans, the public QR forms or referral credit.

## Where the owner's papers are

The owner gave three PDFs on Nov 18. Their prices and costing numbers are the office's own, so
they are **not in this repository**.

| Paper                               | Kept as                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Roof Care Plans flyer (correct)     | Text: `office_reference_notes`, key `roof-care-plans-flyer`. File: documents bucket, `reference/roof-care/JBK_Roof_Care_Plans.pdf` |
| Profit calculator (internal)        | Text and every number and formula: key `roof-care-profit-calculator`. No file kept                                                 |
| Services leave-behind (not correct) | Text: key `services-leave-behind`. File: `reference/roof-care/JBK_Services_Leave_Behind.pdf`                                       |

`office_reference_notes` is a table on the live database that only an admin reads
(`20261118220000_office_reference_notes.sql`). Read it with the database tool:
`select key, title, body from public.office_reference_notes`.

No plan price, cost or margin number goes into code, tests, migrations or docs. They live in the
database and are typed on a Setup page.

## The three plans

Roof Watch, Roof Care and Roof Guard. Two inspections a year, spring and fall, with a photo report
after each. What each includes is on the flyer.

## Decided by the owner (Nov 18)

**The forms**

- Two public pages, opened by QR codes on printed leave-behinds, with no sign-in: "request
  service" and "Roof Care plans".
- The QR codes cannot be tied to a technician. Each form has a box to type who referred them.
  It is usually a technician, not always.
- The request form has everything needed to make an opportunity, and tick boxes for the services
  wanted, more than one allowed.
- The plans form takes everything needed to make a customer profile.
- **A possible match with an existing customer is held for the office to confirm.** The match is
  broad on purpose, so nothing is missed.
- A signed-in technician or salesperson can sign a customer up on site, for a plan **or** for an
  additional service, and gets the credit.

**The price**

- The print form shows no prices, only the QR code.
- The on-screen form hides the prices until the address is typed.
- The list price assumes a 2 hour round trip. A building further from the office costs more: "the
  prices [need] to adjust to the travel distance x paying the crew to get there and back".
- The calculator's numbers are the ones to use.
- Roof size: looked up from the building's footprint where the site has it, else a size range the
  visitor picks. The price is an estimate until the roof is measured.
- Several buildings is an option on the form. It tells them to call for discounted pricing.

**The plan itself**

- Billed half at the first visit and half at the second, each on an invoice.
- The customer page shows whether they have a plan and which one.
- The visits are tracked against what the plan promises.
- The inspection tickets are made by the site. Each says it is a care plan inspection.
- A care plan inspection can be pushed back, and the next one moves back with it.
- The owner wants to see how many visits were done this year: 1, 2, or 3 where the third is the
  storm inspection.

**Not part of this**

- A second invoice on a ticket keeps bringing everything from the ticket, purchase orders
  included. The office takes off what it does not want.

## Decided later on Nov 18

**The travel rule.** At cost. The list price covers a 2 hour, 100 mile round trip. For a building
further from the office, each trip of the plan year adds the hours over 2 at the crew's pay and the
miles over 100 at the vehicle's cost per mile. A closer building pays the list price, never less.
Trips a year: Roof Watch 2, Roof Care 2, Roof Guard 4 (the two visits, one leak call, one storm
inspection).

**The first visit.** The person signing the customer up is often already on site for a service
call, so sign-up offers three choices: do the inspection now, push it back a number of days, or
wait for the next window. The windows are mid March to mid May, and mid October to the end of
December.

**The plan year.** Twelve months from the plan's own sign-up, not the calendar year. With half
billed at each visit, that is why nothing needs pro-rating (owner: "pay per visit kind of fixes
that").

**Pushed back.** Anyone in the office can push a care plan inspection up to 30 days. More than
that needs a manager and a reason. The next inspection moves back with it. If the second visit
would land after the plan year ends, the renewal date moves with it and the Owner page lists the
plan as running late.

## Decided on the evening of Nov 18

- **Referral credit is just a name.** The record keeps who signed the customer up, or the name
  typed in "who referred you". No payout, no report beyond that. Nov 23: the owner asked for a
  commission plan for reps, based on the minimum roof size and drive. Choices were put to him
  and nothing is built or decided; the working is in the office's private note. Both names show
  on the Customers page's Care plans tab (`docs/qa/care-plans-tab-2026-11-23.md`).
- **The list of services is on hold.** The owner will come back to it. Until then a request for an
  additional service is typed in words.
- **The terms.** The owner asked what the customer should agree to. A draft went back to him for
  his say. Nothing is settled.
- **An address the map cannot find** is looked up by its street anywhere in the country, then by
  its zip code, then by its town. A price from the zip code or the town is marked as an estimate.
- **The Owner page's Business charts** show trade bids and Roof Care plans beside the regular
  work, each on its own or compared.
- **Go on steps 2 and 3. Step 4, the two public QR pages and the printable sheets, comes after and
  must not be forgotten.**

## Built so far

**Step 1, Nov 18: the price engine and its page.** Record:
`docs/qa/roof-care-pricing-2026-11-18.md`.

- The rule is `src/lib/roof-care-price.ts` (`roofCareQuote`). It holds no numbers.
- The numbers are one row on the live database, `roof_care_settings`, which only an admin reads
  and writes. The owner's costing sheet was typed into it. They are changed on Admin, Settings,
  Roof Care plans.
- With those numbers the engine gives every figure on the owner's sheet, to the dollar. The sheet
  prints the drains hours of its 75,000 sq ft row rounded to two places and works with three. The
  database holds the three-place figure.
- The drive from the office is `roofCareDrive` in `src/lib/roof-care.functions.ts`. It is for an
  admin only so far.
- **For the later steps:** a technician, a salesperson and a visitor with no sign-in cannot read
  `roof_care_settings`. Giving them a price needs a read made for the purpose, on the server, that
  hands out the price and never the costs or the profit.

**Steps 2 and 3, Nov 18: plans, inspections, sign-up on site.** Record:
`docs/qa/roof-care-plans-2026-11-18.md`.

- Tables `roof_care_plans` and `roof_care_visits`, and `service_jobs.roof_care_visit_id`
  (`20261118240000_roof_care_plans.sql`). Nobody writes them by hand. Each change is a database
  function: `roof_care_sign_up`, `roof_care_make_tickets`, `roof_care_push_back`,
  `roof_care_add_storm`, `roof_care_end`.
- **The price for everyone but an admin** is `roof_care_price(sqft, hours, miles)` in the
  database. It reads the admin's numbers itself and hands back prices, never a cost. It is the
  same sum as `roofCareQuote`. Change one, change the other.
- The screen's twin of the rules is `src/lib/roof-care-plan.ts`. The server functions are
  `src/lib/roof-care-plan.functions.ts`. The card is `src/components/roof-care/plan-card.tsx`.
- The morning check that makes tickets is a database timer, `roof-care-tickets`, at 11:40 UTC.
- A care plan inspection's invoice: `src/lib/roof-care-invoice.ts`, made at Authorized
  (`ensureCarePlanInvoice`).
- An additional service asked for on site: `request_additional_service`
  (`20261118250000_additional_service_request.sql`). The credit is
  `crm_opportunities.referred_by` and `roof_care_plans.sold_by_name`.
- The Owner page counts Roof Care as its own line of business:
  `docs/qa/owner-lines-of-business-2026-11-18.md`.

**Later on Nov 18: the two buttons, the terms, technicians.** Record:
`docs/qa/care-plan-buttons-and-technicians-2026-11-18.md`.

- The buttons are **Care Plan** and **Additional Services** (`RoofCareButtons`): pinned at the
  bottom of the ticket workflow, under Open ticket and the stage on a ticket, under New ticket on
  a property. The owner chose the names and the places.
- A technician-only login works a ticket in the workflow and nowhere else. The ticket page is
  the office's.

**The audit, Nov 18.** What was proven: `docs/qa/roof-care-audit-2026-11-18.md`. What it found
and is still open: `office_reference_notes`, key `roof-care-audit-2026-11-18`. Read that before
changing prices, invoices or the inspection dates.

**The fixes, Nov 19.** `docs/qa/roof-care-audit-fixes-2026-11-19.md`: one live ticket for an
inspection, the saved price is the shown price, ending a plan takes its untouched tickets off
the board, the drive's share adds up, and a care plan invoice saves its lines. The automatic
invoice was tried live.

## Decided on Nov 19

Record: `docs/qa/roof-care-followups-2026-11-19.md`.

- **The price is one number.** "They shouldn't know they're paying more for distance neither the
  customer or tech." The sign-up shows each plan's price and its two halves. The drive, the list
  price and what the distance adds stay on the server. The Setup page still shows them to admins.
- **The minor repairs a plan includes each year** are kept on the plan and shown under its status
  on the property page. A repair invoice at that property uses the plan by itself while any is
  left ("can we have the tick auto ticked if there is still any allowance left?"). The office
  unticks it on the invoice when the repair is not a minor one, or types a smaller amount.
  Leak calls are not part of this: only minor repairs are included.
- **No skips.** Two inspections are owed a year. A care plan ticket that is deleted is made
  again by the morning check, and that stands.
- **The roof size on a plan is not changed after sign-up.** "That's fine since it's invoiced at
  time of service": the office changes the plan's line on the invoice when it needs to.
- **An inspection's share of the plan goes on one invoice.** A second invoice on the ticket is
  for work beyond the plan and is built from the ticket's time and materials.
- **The second inspection's window is at least two weeks.** Under two weeks left of a window,
  the next window is used.
- **Push back.** The office's 30 days count from each inspection's own first date. Reasons are
  kept, each with its day and who gave it.

- **A floor under the price.** "The minimum roof size pricing is always priced at … sq feet so
  its never not profitable, thats the floor similarly to where drive time is minimum of 2 hrs no
  matter what." A roof smaller than the floor pays the price of the floor size, on all three
  plans. The floor is a box on the Setup page ("Smallest roof the price is worked for"); blank
  means no floor. The plan still keeps the roof's own size, and the cost shown to admins is the
  real roof's. Record: `docs/qa/roof-care-floor-2026-11-19.md`.

## Paying up front: step 1 built on Nov 19

The owner, the same evening: "they can pay up front by check". Record:
`docs/qa/roof-care-pay-first-2026-11-19.md`.

- **A signed plan waits for its payment.** Status `awaiting_payment`. No inspection and no
  ticket is made for it.
- **One invoice for the year belongs to the plan** (`invoices.roof_care_plan_id`), numbered after
  it: plan 1001 is invoice RC-1001. It is a draft with one line. Someone who makes invoices gets
  it made at the sign-up; after a technician's sign-up the office makes it from the plan.
- **The day that invoice is marked paid in full, the plan starts.** The database does it
  (`invoices_plan_paid`, `roof_care_start`): the plan year runs from the payment, the two
  inspections are dated from the day it is recorded, their tickets are made and announced.
- **An inspection of such a plan bills nothing.** Its invoice is still made at Authorized, at no
  charge, so the Owner page knows what the visit cost.
- **Needs attention** lists a plan signed and not paid, with what the office does next.
- **The Owner page** counts the plan's invoice as Roof Care.
- **The terms** are a new set (2026-11-19): paid in full first, the year runs from the payment,
  and the refund rule.
- A plan signed by a page published before this (`roof_care_sign_up`) still works the old way:
  in force at once, half billed at each inspection. Remove that function once the site is
  published and nobody has an old page open.

**Built later on Nov 19**, at the owner's "go with the first 3 not built yet and ill work on
stripe later". Record: `docs/qa/roof-care-refund-and-leak-calls-2026-11-19.md`.

- **How they pay is said at the sign-up**: "the payment needs to be by check or card either one
  during sign up". The sign-up asks Check or Card, with a box for a check's number. The plan
  keeps it, and it shows on the waiting plan and in Needs attention. A card cannot be charged
  from the site until Stripe: the office takes it and marks the invoice paid.
- **The refund when a plan ends early.** The End plan box shows the sum, worked by the database:
  the share of what was paid for the inspections not done, less the minor repairs the plan
  already covered, never below nothing. The manager confirms it or types another amount, never
  more than was paid. It stays on the property and in Needs attention until it is marked sent.
- **Roof Guard's leak calls.** In the owner's words: "two leak calls with the credit subtracting
  until it reaches 0 and on those two leak calls travel is not charged? then after that it is",
  and "travel does come out of the later ones if theyve had 2 calls but havent used all their
  repair allotment". The flyer gives this to Roof Guard only, and the owner said so again: "roof
  care shouldnt get it". A plan keeps its calls a year from the price setup at sign-up. A repair
  invoice at the property carries one line that takes its travel off while a call is left; the
  office presses "Charge the travel: not a leak call" when it was not one. The minor repairs
  credit then covers what the invoice still charges. The price setup now counts two leak calls
  with no labor (typed at the owner's word).
- **The terms of 2026-11-19 are agreed**: "go with the agreement terms update".
- **The discount for renewing by itself is said in dollars**, not a percent: "go on the dollar
  amount savings that is better". It is worked as 5% of the plan price with the drive left out.
  It comes with Stripe.

**Renewal, built Nov 19** (the third of "the first 3 not built yet"). Record:
`docs/qa/roof-care-renewal-2026-11-19.md`.

- **A plan is renewed in the last 60 days of its year.** The property shows "Renews Dec 19,
  2026, in 30 days" and a "Renew for another year" button, for the office. The renewal is next
  year's plan: priced again today from the roof size and the drive the plan was sold on, waiting
  for its payment, with its own invoice and its own number. This year's plan stays in force
  beside it.
- **An inspection still owed** when the renewal is made is the office's call, in the Renew box,
  with the push-back reasons shown. The owner's two answers:
  - "We did not get there": half of the renewal is taken off for each inspection owed, as a
    second line on the renewal's invoice. The inspection is dropped when the renewal is paid.
  - "The customer kept us off the roof": the renewal is charged in full. The inspection comes
    into the new year for 60 days, shown as "Inspection owed from last plan year". After that
    the morning run marks it lost and takes its ticket off the board. It cannot be pushed back.
- **Which answer is picked first.** Push back has a new tick, "The customer asked for this".
  With no push-back of the owed inspection ticked that way, half off is picked; with one, charged
  in full is. The person renewing can change it.
- **When the new year starts.** The day the renewal's invoice is paid in full, the old year
  ends as "Renewed" and the new one starts: on the old renewal date when it is paid ahead, on
  the payment when it is paid late. The two inspections of the new year are dated from there.
- **Needs attention** lists a plan from 60 days before its renewal until the renewal is made,
  with what is still owed; a renewal that is not paid; and an inspection carried into the new
  year, with the day it is lost.
- **Cancelling a renewal.** A manager cancels a renewal that is not paid; its unpaid invoice
  goes with it and the plan can be renewed again. This year's plan cannot be ended while its
  renewal waits.
- **Neither inspection done, and ours:** both halves come off, so the renewal is at no charge.
  Only a manager makes it, and the new year starts at once with no invoice. This follows from
  the half off rule; the owner has not been asked about it in so many words.

**The owner's answers, Nov 19, evening.**

- **The agreement line on renewal:** "go". It is held for one more answer: the numbers he
  asked for showed that taking half off a renewal costs more than the inspection is worth on
  one plan, so the amount in that line waits for his word. The numbers are in the private notes.
- **A plan is one year of coverage:** "the agreement is for one year of coverage from sign up
  date, and the benefits dont roll over, if we push it back we can follow the owed inspection
  rule". Built the same evening, below. The year still runs from the payment, as the terms say.
- **Neither inspection done, and ours, makes the renewal free, a manager's:** "yes".
- **Renewing by itself or by hand.** The customer picks one of the two. "we need to be notified
  when an auto renew happens (this also needs to auto happen through stripe) or when a plan
  expires so we can reach out to renew". The expiry notice is built. Renewing by itself comes
  with Stripe.
- **Changing plans.** "the customer should have the ability to upgrade or downgrade the plan but
  if they downgrade it will just downgrade the next billing cycle where if they upgrade they
  will have to pay the difference to get the benefits, this should be setup through stripe and
  kept track of through the JBK bid site". Comes with Stripe.
- **Refunds:** "the refund should take if off of roof cares income". Built, below.
- **Stripe:** "ill get to stripe later".

**Expiry, built Nov 19, evening.** Record: `docs/qa/roof-care-expiry-2026-11-19.md`.

- **The plan year is twelve months and no longer.** Pushing an inspection back no longer moves
  the renewal date. An inspection past the year is still owed, and the renewal's rule decides
  it.
- **The morning run ends a plan whose year is over as "Expired".** Its minor repairs and leak
  calls stop. Its inspection tickets stay: what was not done is still owed.
- **The office is told once**, the admins and the managers, at 8:00 on a working day, with a
  link to the property. Needs attention lists the plan for 60 days, with what is still owed.
- **An expired plan can still be renewed** from the property, as long as the property has no
  newer plan. The new year starts the day the renewal is paid.
- **The Renew box no longer leans to half off for an inspection that is not late yet.** A
  renewal is made up to 60 days ahead, when the second inspection is often still inside its own
  window. It now leans to charging in full, and says "it is not late yet".
- **A refund comes off Roof Care's income.** The income report has a row for each refund, on the
  day the plan was ended, with its amount below nothing. It is Roof Care's line of business.

**Three rules agreed and built Nov 19, night.** Record:
`docs/qa/roof-care-credit-2026-11-19.md`. The owner had asked for the numbers on every case and
then said: "we need some rules so the worst case on roof guard … doesnt happen".

- **The price of one inspection comes off a renewal, not half the plan** ("go for 1"). One
  inspection is half of what Roof Watch costs for that roof and drive: Roof Watch is two
  inspections and nothing else. It is the same amount whatever the plan. For Roof Watch itself
  nothing changes. Only on Roof Watch can a renewal still come to no charge, a manager's.
- **A refund also takes off the leak call travel that was not charged, and a storm inspection
  counts as an inspection done** ("2. go for this. Just ensure it makes it into the service
  agreement").
- **The agreement says both.** Terms version 2026-11-19.2, eleven terms. Term 9 names the leak
  call travel and the storm inspection. Term 10 is new: the plan ends after its twelve months
  unless renewed, the price of one inspection comes off the renewal for one we could not get
  to, and one we were not given access for can be done in the first 60 days of the new year.
- **An expired plan that is not renewed keeps its owed inspection** ("3. yes"), and nothing is
  refunded by itself.
- **Closing out.** He asked: "do we ever have the ability to dismiss that? say its owed and been
  6 months and they just dont seem interested in wanting it, how do we get it off the reminders
  list?" A manager now closes out an expired plan with a reason: what was still owed is dropped,
  its tickets come off the board, and the plan leaves the Needs attention list. It can still be
  renewed later. Without that the plan leaves the list by itself after 60 days, but an owed
  inspection's ticket stays on the board.
- **Upgrades paying the difference:** "as long as its profitable … is fine". With Stripe.

**Not built yet, all with Stripe:**

1. A pay link or QR code at the sign-up.
2. Renewing by itself, its notice to the office, and its discount in dollars. **A rule it has
   to keep (the owner, Nov 20):** "we should probably ensure if someone ticks auto renew we dont
   charge them more if prices change and they auto renew w/o knowing". A plan that renews by
   itself never charges more than the yearly price the customer last agreed to, unless they
   were told the new price before the renewal day and the telling is on record; told a price,
   never more than that price; a price that went down is charged as it is. The rule is written
   and tested as `autoRenewCharge()` in `src/lib/roof-care-plan.ts`, for the Stripe work to
   call. When the old price is charged because nobody told them, the office has to hear it.
   **How early they have to be told (the owner, Nov 23): "30 days is good".** The telling
   counts only when it was at least 30 days before the renewal day
   (`AUTO_RENEW_NOTICE_DAYS`, `autoRenewToldInTime()`, and `autoRenewTellBy()` for the last
   day to tell them). Told 29 days before, the old price is charged.
3. Changing plans: an upgrade pays the difference and takes effect at once; a downgrade takes
   effect at the next plan year.

## Paying up front: what was looked into first

The owner: "i think we are going to do payment up front rather than at time of service via
something like stripe so we dont have to fight apathy." He asked what that changes. This is what
was found before anything was built.

**What was checked.** Every piece that knows the plan is billed in two halves, in the code and on
the live database:

- The price function hands back the two halves, and sign-up saves one on each inspection
  (`roof_care_visits.amount`).
- An inspection ticket makes its own draft invoice at Authorized, with that half as its one
  charged line (`ensureCarePlanInvoice`, `carePlanInvoiceLines`).
- The sign-up screen, the plan card, the Needs authorization card, the "Not invoiced" flag, the
  Needs attention row and terms 2, 4 and 9 all say or assume "billed at each inspection".
- The margin report counts Roof Care as the invoices of care plan inspection tickets.
- An invoice must belong to a ticket or a trade bid (`invoices_one_parent`). There is no invoice
  for a plan itself.
- A plan is `active` or `ended`. There is no "signed, not paid yet".
- Inspection tickets are made for every active plan, 14 days before the inspection is due, and at
  once for "do it today".
- Nothing renews a plan. Ending a plan refunds nothing and has no rule for it.
- The public invoice link shows the PDF. It has no way to pay.
- On the live database there were no plans, and no final or paid invoice.

**What paying up front would change.**

1. Sign-up makes the plan "awaiting payment" and one invoice for the whole year, belonging to the
   plan. No inspection tickets yet.
2. The customer pays through a Stripe page (a link or a QR code on the spot), or the office marks
   a check as received. Stripe tells the site, and the plan becomes active.
3. From there the inspections are made as they are today. Each bills nothing; its invoice, or the
   ticket itself, only carries what the visit cost.
4. The halves, the automatic half invoice, "Not invoiced" and its Needs attention row go. In
   their place: "signed, not paid" on the plan and on Needs attention.
5. The Owner page counts the plan's invoice as Roof Care's income.
6. Renewal has to be built: a yearly charge by Stripe, or a renewal invoice with a pay link.
7. The terms change (a new version): paid in full at sign-up, what happens if the roof's size
   turns out different, and what is refunded when a plan ends.
8. The minor repairs allowance, storm inspections, push back, the windows and the price itself
   stay as they are.

**The owner's answers (Nov 19).**

- A check is still taken, marked received by the office.
- The plan year starts at payment, not at sign-up.
- "Do the first inspection today" waits for payment too.
- Ending a plan refunds a share for the inspections not done: one done, half back.
- Renewing by itself is offered as a choice at sign-up, with a discount for choosing it. He
  named 5% and asked whether the numbers still work. The worked answer, with the office's own
  costs, is in the private notes, not here.
- The roof size only has to be relatively close. He asked whether the map can give it.
- He has no Stripe account yet.

**More answers the same day.**

- **Repairs come off a refund.** "I like the repairs coming off a refund rule, we may need to
  note that on the agreement." What the plan already covered in minor repairs is taken off the
  refund, never below zero. It goes in the new terms.
- **A year that closes with one inspection done.** Two parts are decided. Sixty days before the
  renewal, Needs attention lists a plan with an inspection still owed. If it is still owed at
  renewal because we did not get there, the renewal is charged with half taken off. Decided the
  same day ("3. go on this"): when the customer kept us off the roof, the renewal is charged in
  full and the inspection stays owed for 60 days into the new year, then it is lost. The office
  makes the call at renewal with the push-back reasons shown, and half off is picked unless a
  reason says the customer asked.
- **Roof Guard, in his words:** "3 free inspections (one is by request after storms) … of minor
  repairs and no trip charge on two leak calls." The flyer says the same. The price setup counts
  the leak calls another way; the numbers are in the private notes and wait on his answer.

**Open then, settled since.** The discount for renewing by itself is said in dollars, worked as
5% of the plan price with the drive left out, and comes with Stripe. A year that closes with an
inspection the customer kept us from is charged in full, with 60 days to do it. The minor
repairs a plan includes cover labor, materials and travel, except Roof Guard's first two leak
calls a year, whose travel is not charged at all.

**The roof size from the map (checked Nov 19).** The building outlines already in the database
(`buildings`, Kentucky and Tennessee only) carry a roof size. Of the 34 properties that have a
point on the map, 33 have an outline at that point. But a property often has several buildings
close by, and the nearest outline is not always the one meant, so it cannot be picked by itself:
the person signing up would pick the building, or buildings, on the map. No bid is linked to an
outline, so the outlines could not be held against a roof the company has measured.

**The map's size on the sign-up (built Nov 19).** The owner: "go with looking up the
properties". The sign-up now asks our map for the building at the property's address and says
its size beside the roof size box, with a "Use this size" button. The box still starts blank.
After a trial of fifty he said "go", and every property was looked up once: a map point and,
where our map has an outline, a size are now kept on the property. The sign-up says the kept
size at once and looks up a property that has none. The counts are in
`docs/qa/roof-care-map-size-2026-11-19.md`.

**Cards.** "They should probably be able to pay by check or card."

**Setting it up.** A Stripe account in the company's name. Its keys go in Lovable Cloud › Secrets
by the owner's hand, never in the repository or the chat. Stripe's test mode first: with a live
key a payment made from the preview is a real one.

## The sign-up the customer reads, and the emails (Nov 19, late)

The owner: "the care plan menu … will likely be customer facing so we need it to be visually
appealing, explain the plans, and the verbiage should be as if a customer is reading it", "if
they click care plan it pops up the plan they are currently on and its benefits", and "the
terms need to be emailed to the customer at signup as well as a receipt ideally".

- The sign-up is written to the customer, in five numbered parts, with a card for each plan:
  its one line, its price, what it includes (`src/lib/roof-care-benefits.ts`).
- The numbers in a plan's description come from the plan settings through
  `roof_care_benefits()`, never from the code.
- Care Plan on a property that has a plan opens that plan: what it includes, and "Used this
  plan year" (inspections, minor repairs, leak calls with no trip charge, storm inspection).
- The plan keeps the customer's email (`customer_email`). The agreement goes at sign-up and the
  receipt when the payment is received (`src/lib/roof-care-email.ts`,
  `src/lib/roof-care-email.server.ts`, and the scheduled run). Email is not set up on the site
  yet: it needs `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL`.
- Card still means the office takes the card. With Stripe, signing with Card goes to Stripe's
  checkout.
- Record: `docs/qa/roof-care-customer-facing-2026-11-19.md`.

Was the plan offered (owner, Nov 19, night: "track the care plan button click on the ticket to
ensure it's being offered"): pressing Care Plan on a ticket is kept in `roof_care_offers`, the
office sees who opened it on the ticket, and the Owner page's Business tab counts it for each
technician against the tickets they finished (`src/lib/care-plan-offers.ts`). Record:
`docs/qa/roof-care-offered-2026-11-19.md`.

Built the same night, at the owner's "go" (`docs/qa/roof-care-go-aheads-2026-11-19.md`):

- Paying by card online, the site's side: `src/lib/roof-care-checkout.ts`, its `.server.ts` and
  `.functions.ts`, and `src/routes/api.stripe.webhook.ts`. Off until Stripe's two secrets and
  its webhook endpoint are set up (`AGENTS.md`).
- **The customer's own card payment link** (Nov 23, the owner: "1. A go"). A customer who signs
  up through the QR page is not at the office's screen, so each plan has a link of its own:
  the site's address, `/pay/`, and a long random token that belongs to that plan. The page it
  opens needs no sign-in. It shows the plan's name, the property's name, the amount and one
  button, which opens the card payment page; the payment starts the plan as any card payment
  does. A link that is over, or made up, says to call. Since Nov 24 the link is not in the
  agreement email (the owner: "the office needs to review and then send the payment request
  after theyre sure of the roof size"): the office copies it or emails it from the plan (Card
  payment link), and the box says "not emailed yet" until somebody has. A plan signed from a
  public request with Card does not open the card page on the office's screen. Since the
  same night no payment is asked for while a plan's roof size is not confirmed: no link, no
  email of it and no card page, except on a ticket, where the technician can measure the roof
  (`docs/qa/roof-care-size-before-payment-2026-11-24.md`). Off until Stripe is set up; emailing it also needs Email set up.
  Record: `docs/qa/roof-care-pay-link-2026-11-23.md`.
- The cleaning at each inspection and the budget forecast: `src/lib/roof-care-cleaning.ts`.
  The questions are required (the owner, Nov 20: "those questions should be required"): no
  path moves a plan's inspection to Done or later with one open. The database refuses it
  (`service_jobs_cleaning_rule`, migration `20261120100000_roof_care_cleaning_required.sql`),
  and the two server functions check first. Record:
  `docs/qa/roof-care-cleaning-required-2026-11-20.md`.
- Every checklist row is answered on a plan's inspection (the owner, Nov 23: "3 go"). An
  ordinary inspection keeps the Oct 26 rule, a row left blank reads as OK. On a Roof Care
  plan's own inspection each row needs OK, Issue or N/A before the ticket is finished, because
  the customer's Care plan report prints "Not checked" for a blank row. The Checklist step
  marks the rows still to answer, says how many are left and goes to the first one; Complete
  lists them and offers no "Complete anyway"; the two server functions refuse before a clock
  is touched (`src/lib/inspection-answers.ts`). The database rule that binds every path is
  written and tried (`service_jobs_checklist_rule`, migration
  `20261124100000_roof_care_checklist_answers.sql`). Record:
  `docs/qa/plan-inspection-answers-2026-11-23.md`.
- An expired plan's Care Plan button opens its renewal.
- A refund of a year paid by card is less the card fee (term 9, version 2026-11-19.3). The
  fee's rate is on the plan setup page.

Decided, not to be built (owner, Nov 19, late): technicians do not see how much of the minor
repairs is used. "The tech doesn't need to see that, they can tell them to call the office as
they don't have that info."

## No access, and a further storm inspection (Nov 19, late)

Record: `docs/qa/roof-care-no-access-storm-2026-11-19.md`. Migration
`20261119990000_roof_care_no_access_paid_storm.sql`, applied by hand.

**No access (the owner: "10. Go.").** The crew arrives for one of the plan's inspections and
cannot get on the roof.

- The first time in a plan year, the return trip is free. Each time after that, it is charged at
  the trip rate. Term 7 says so.
- What is left of the plan's minor repairs goes toward a charged return trip first, and the
  customer pays the rest (the owner, Nov 20: "it comes out of the allocation if there is
  allocation left"). The minor repairs line on the inspection's invoice does it, toward the
  return trip only (`invoiceAllowanceOf` in `src/lib/roof-care-allowance.functions.ts`). Term 7
  says so from terms version 2026-11-20.1. Record: `docs/qa/roof-care-trip-allowance-2026-11-20.md`.
- The trip rate is the plan's own when the owner types one (Nov 20, "go"): two boxes on the
  Roof Care price page, per hour of the round trip for the whole crew and per mile. Both blank,
  the Service rates page's travel rates are used. `roof_care_trip_charge()` decides. Record:
  `docs/qa/roof-care-trip-rate-2026-11-20.md`.
- A return trip is never charged less than it costs us (the owner, Nov 20: "why is it charging
  less than it cost?"): the charge is the higher of what the rates come to and the trip's cost
  by the price page's own crew and vehicle numbers. Nothing has to be typed for that.
- How many are free is one named number in the database, `c_free` in
  `roof_care_no_access_state()`. Set it to 0 and every one is charged.
- No access is a button on the inspection's ticket: in the technician's workflow and on the
  office's ticket page (`src/components/roof-care/no-access.tsx`). It asks what happened, says
  before it is pressed whether this one is free or charged, and records it in
  `roof_care_no_access` through `roof_care_no_access()`. The office reads the amount. A
  technician is told it is charged and that the customer can call the office for the amount.
- The inspection is marked as kept off by the customer (`roof_care_visits.customer_asked`), so a
  renewal treats it as theirs, not ours. The admins and managers get one notice, so the
  inspection gets a new day. The ticket itself is not moved.
- The trip rate is worked as travel is on a service invoice: the hours of the plan's own round
  trip (`roof_care_plans.drive_hours`), and never less than the round trip the list price covers
  (Nov 20, evening: see "Go-aheads of Nov 20, evening"), at the
  standard travel rate of the technician plus that of each helper of the crew (the Service rates
  page, and the crew size on the plan setup page). No rate is in the code. When a rate is blank
  the amount is not worked out, the screen says so, and the office adds the charge by hand.
- A charge is billed on that inspection's own invoice, as a line of its own
  (`roof-care-trip:<record>`), when the invoice is made at Authorized. The database lets a
  return trip be on one invoice only. The plan lists each record with "not invoiced yet" or its
  invoice, and Needs attention lists a charge that is on no invoice once its inspection is
  signed off.
- A manager can take a record off (a mistake, or a charge that is let go), unless its charge is
  on an invoice.

**A further storm inspection (the owner: "Second inspection billed at inspection price and
their repair allocation contributes to the price if they have any left").**

- The storm inspections the plan includes stay free.
- A further one in the same plan year is billed at the price of one inspection: half of Roof
  Watch for that roof and drive, the same amount a renewal takes off for an inspection we did not
  get to. Term 8 says so.
- Anyone in the office can add it. Storm inspection opens a box that says whether this one is
  included or billed, what it costs, how much of the minor repairs goes toward it and what the
  customer pays (`roof_care_storm_offer()`, `src/lib/roof-care-storm.ts`). A billed one is added
  only from that box (`roof_care_add_storm(plan, p_billed_ok)`).
- The price is kept on the inspection (`roof_care_visits.amount`). Its invoice is made at
  Authorized with the plan's own line at that price. The minor repairs line that every repair
  invoice uses then takes what is left of the allowance off that line and nothing else, so the
  plan's tally and a refund count it as minor repairs used.
- A refund counts a storm inspection as an inspection done only when it was one the plan
  included.

## Break test fixes of Nov 20: the plan screens and the inspections

The owner's words after the break test: "fix 1, 4 (what happens if it cant be found on the
map?), 7, 8, 9, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30". Eight of them are
here. The trials and the browser run are in `docs/qa/roof-care-break-fixes-plan-2026-11-20.md`.

- **4. The typed roof size is checked against the map.** When the property has a roof size from
  the map (`crm_sites.map_roof_sqft`, 500 sq ft or more) and the typed size is more than 20%
  smaller, the plan is not signed: a technician and the office are told both sizes. A manager or
  an admin may go on after ticking "The typed size is right", and their name and the day are
  kept on the plan. A larger typed size is always taken: a property can have more roofs than the
  one the map found. When the map has no size (the address was not found, or there is none), the
  typed size is taken as before and the plan is marked "roof size typed by hand, not checked
  against the map" (`roof_care_plans.size_unchecked`) until a manager or an admin presses
  "Confirm the roof size" on the plan. The check is the server's and the database's
  (`roof_care_sign_up_await_payment`, `roof_care_confirm_size`). A renewal keeps its plan's size
  and its mark.
- **7. One storm inspection a day.** A second one the same day has to be ticked in the Storm
  inspection box, which says who added the first and when. A manager or an admin takes off one
  added by mistake ("Take off" beside it) while its ticket is not started and nothing of it is
  invoiced: the inspection and its ticket go and the plan's count goes back. When the one taken
  off was included and a billed one is still to do and on no invoice, that one becomes the
  included one (`roof_care_add_storm`, `roof_care_remove_storm`).
- **8. Taking a "no access" record off works the rest again.** The records left for that plan
  year are gone through in date order: the first is free, each after it is charged at the plan's
  trip rate. One whose charge is already on an invoice stays as billed, and the office is told
  so; the free one then goes to the next record that is not billed. What the next visit would be
  is counted from the free ones used, so one return trip a plan year is free whatever was taken
  off (`roof_care_no_access_take_off`, `roof_care_no_access_state`).
- **9. A renewal's answer against the rule is a manager's.** With an inspection still owed, an
  office user gets the rule's own answer (half off only for an inspection that is late with no
  push-back saying the customer asked) and is told who can change it. A manager or an admin may
  pick the other one. A plan that ended more than 60 days ago is renewed at the full price, with
  no credit for an inspection not done and nothing carried, whoever asks (`roof_care_renew`,
  `roof_care_renewal_offer`).
- **20. Skip this inspection.** A manager or an admin skips an inspection we will not do, with a
  reason: its ticket comes off the board and the morning run does not make it again. It still
  counts as an inspection owed, so a renewal takes its price off or carries it and a refund
  counts it as not done; one carried into the renewed year gets its ticket again. Putting the
  ticket back from Deleted undoes the skip. Deleting the ticket of a plan's inspection any other
  way is refused, in words that point to Skip (`roof_care_skip_visit`, the rule
  `service_jobs_care_plan_delete_rule`). The site's own removals pass: a plan that ended, was
  renewed or closed out, an inspection that is lost or skipped, the morning run.
- **21 and 27. A technician's plan.** The plan tables no longer answer a technician. Their
  screens get the plan from the database's own functions, with the money left out: the plan, its
  state and dates, what it includes, each inspection with the stage of its ticket whoever that
  ticket is with, the cleaning answers, and the "no access" records they made, without the
  amount (`roof_care_field_plans`, `roof_care_field_no_access`, `roof_care_field_cleaning`). So
  the Care Plan pop-up counts "2 of 2 done" from every ticket, and names a ticket that is with
  somebody else without linking to it. What a plan includes (the minor repairs a year, the leak
  calls) is not money: it is what the technician tells the customer, and stays. The office reads
  as before.
- **29. The sign-up's words.** Under "Agree and sign up", a line says what is still missing
  while the button cannot be pressed. A roof too large to be real gets the custom-quote line. A
  size of 0 or below and a drive below zero have their own words. Two presses in the same
  instant are one sign-up and one message.

## Go-aheads of Nov 20, evening

The owner: "go with 2, 11, 25, 31 ( we should probably ensure if someone ticks auto renew we
dont charge them more if prices change and they auto renew w/o knowing)", "go with 4" (the 8:00
notice), and "why does it say billed at each visit?". Record:
`docs/qa/roof-care-go-aheads-2026-11-20-evening.md`. Number 2 (a draft invoice's credit) is in
its own record.

- **11. The smallest return trip.** A return trip after a visit we could not do is worked on the
  property's own round trip, and never less than the round trip the list price covers (the two
  baseline boxes on the price page): the larger hours, and the larger miles, each on its own.
  Then as before: the higher of what the rates come to and what the trip costs us. A property
  next door is charged the baseline trip; one further away its own. `roof_care_trip_charge()`
  decides; `returnTripDrive()` in `src/lib/roof-care-price.ts` is the same rule for the page's
  note.
- **25. The database refuses nonsense itself.** `roof_care_price()` refuses a roof size or a
  drive that is not a real number, a round trip over 24 hours or 2,000 miles, and a roof over
  100,000,000 sq ft. The sign-up (`roof_care_sign_up_await_payment`) refuses the same drive, any
  terms text that is not a terms version, a sign-up with no check or card picked, and, with the
  price the screen showed (`p_shown_price`, which the site's server sends), a plan at any other
  price. None of it could be reached from the screens, which check first.
- **31. Settings changed during a plan's year.**
  - The storm inspections a plan includes are kept on the plan when it is signed or renewed
    (`roof_care_plans.storm_included`), as the minor repairs amount and the leak calls already
    were. A change of the setting reaches new plans and renewals only. Plans from before were
    filled in once from the setting of that day.
  - What a return trip is charged and what a further storm inspection is billed keep following
    today's settings: they are prices of work not yet done.
  - The free visit we could not do starts again each plan year. Unchanged.
  - A renewal paid before the old year is over: the new plan is in force at once, the old one
    ends as "Renewed" that day, and the new year is dated from the old year's last day to one
    year after it (`roof_care_start`). No day is lost and none is given twice. What the new
    year includes can be used from the payment. The receipt says "Your new plan year starts …"
    and the plan says "Paid. The plan year starts …". A renewal paid on or after the old year's
    last day is dated from the payment.
  - Refunds stay by inspections done. Return trips and a billed storm inspection keep using the
    minor repairs amount first. Unchanged.
- **Renewing by itself:** the price rule above, under "Not built yet, all with Stripe".
- **The 8:00 notice does not repeat.** Who was told about which site-made ticket is kept
  (`roof_care_ticket_told`), written right after each notice. When one group's notice fails and
  the tickets are told again on the next run, the people who already heard are left out.
- **"Billed at each visit" is gone** from Try a building on the price page. It was left from
  before a plan was paid for the year up front (Nov 19). The yearly price is what is charged.

Later the same evening the owner added: "go with ... 14, new issue 1, new issue 2".

- **14. A first inspection pushed too far.** The second inspection is at least four months
  after the first, in a window with two weeks left. A number of days whose second inspection
  would start after the plan's last day is refused: a red line under the days box says "The
  second inspection would fall after the plan ends. Choose N days or fewer, or pick the
  inspection window.", with the largest number that works that day, and the button stays off.
  The database refuses the same (`roof_care_second_fits`, `roof_care_max_first_days`,
  the sign-up function); `maxFirstDays()` and `firstDaysProblem()` in
  `src/lib/roof-care-plan.ts` are the same rule, tested on the same days. The days are counted
  from the payment, which can come after the signing. If the number no longer fits then, the
  payment is not refused: `roof_care_start` brings the first inspection forward to the last day
  that fits and the plan keeps that number. "Today", "in the inspection window" and a renewal
  always fit.
- **A manager can change a refund that is owed (new issue 2).** On the property page, on the
  plan's card of an ended plan, beside "Mark the refund sent": "Change refund", for a manager or
  an admin. The new amount is 0 or more and never more than was paid for the plan year; a
  reason is required; a refund marked sent cannot be changed. Every change is kept on the plan
  and shown ("Changed from … to … by … on …: reason"; `roof_care_plans.refund_changes`,
  `roof_care_change_refund`). The owner's example: the plan ended early, an amount to send back
  was worked out, then the customer's own check bounced: the manager sets it to 0 with the
  reason "check bounced". What follows by itself: the Needs attention row goes at 0, the Roof
  Care income on the Owner page takes off the new amount (nothing at 0), and the payment on the
  plan's invoice, which is held "while that refund stands", can come off at 0.
- **Card money to send back can be marked sent back (new issue 1).** A card payment that has to
  go back (a plan already paid, a plan that had ended, a payment that did not cover what was
  owed, the part over what was owed) is on the Owner page's Needs attention list, red from the
  first day, until a manager or an admin marks it on the plan's card: "Mark sent back", with
  the day and a reference. Who marked it is kept (`roof_care_card_sent_back`,
  `roof_care_card_payments.sent_back_by_name`). It matters once Stripe is on.

**The owner's other answers of Nov 20, for the record.**

- A technician keeps seeing the minor repairs amount a plan includes, not what is used: "keep,
  they can see that".
- Roof Guard's "no trip charge" goes to the first two repair invoices of the plan year, whatever
  the call was: "yes this is correct".
- An inspection pushed past the plan's last day, and the trips a plan's price is built on: no
  change asked for.
- The Google Routes key is in and proven: Try a building on the price page says "by road, from
  Google".

## Decided on Nov 23

The owner, on the six new issues reported after the Nov 21 work: "for new issues go on 1,
2(credit only applies to work done after plans starts), 3 (i think this is a non issue), 4 it
opened when i took a picture a moment ago, 5 30 days is good, 6 this isnt an bid issue".
Record: `docs/qa/roof-care-nov23-2026-11-23.md`.

- **1. Every ended plan with a refund owed has its own refund line.** A property keeps its
  older plans. On the property's plan card, under the current plan, each ended plan of that
  property whose refund is owed and not yet marked sent has a line of its own, named with the
  plan, its number, its year and the day it ended ("Roof Care plan RC-1004, Mar 10, 2026 to
  Mar 10, 2027, ended Jun 2, 2026"), oldest first, with the same two buttons and the same
  rights: "Mark the refund sent", and "Change refund" for a manager or an admin. Before, only
  the current plan's refund could be reached, so a refund owed on a plan from before a new
  sign-up could not be marked. A refund already marked sent, or changed to nothing, is not
  listed: the line is for money still to send. The Needs attention row for a refund owed
  opens the property's page, where the line is. (`otherRefundsOwed()` and `refundPlanWords()`
  in `src/lib/roof-care-plan.ts`.)
- **2. A plan pays only toward work done from the day it starts: "credit only applies to work
  done after plans starts".** A plan gives its minor repairs credit, and Roof Guard its leak
  call with no travel charge, only to work whose day is on or after the first day of the
  plan's year and on or before its last, whether the plan is in force or has ended. The
  work's day is the day it was completed, else the day on site, else the day it is scheduled
  for, else today. The day the invoice is made does not matter. Example: a repair done Mar 3,
  the plan starts Mar 10, the invoice is made Mar 12: no credit and the normal trip charge.
  Before, a plan in force also paid toward work dated before it started.
  - **A renewal paid early.** The new year is dated from the old year's last day, so there are
    days between the payment and the new year. Work done on those days is the OLD year's: a
    plan that ended because it was renewed runs to its year's last day, and takes the credit
    from what the old year has left. The new year pays from its first day. A plan that ended
    for any other reason stops the day it ended, as before.
  - **The plan's own inspections.** A plan inspection done a few days ahead of its year is
    still that plan's work: a charged return trip on it, or a billed storm inspection, uses
    the plan's minor repairs first as before.
  - **A draft invoice** that carries credit for work now outside the rule loses it the next
    time it is opened, saved, rebuilt or made final, and the office reads why: "This ticket's
    work is dated outside the plan's year, before its first day or after its last. A plan
    pays only toward work done from the day it starts to its last day." An invoice already
    final is left as it is.
  - One rule in two places that are tested against each other: `roof_care_plan_covers()` and
    the invoice line rule in the database
    (`supabase/migrations/20261123100000_roof_care_credit_from_the_first_day.sql`, applied by
    hand on Nov 23), and `planCoversDay()` / `planForWork()` in
    `src/lib/roof-care-allowance.ts` for the screens.
- **5. Renewing by itself: "30 days is good".** A new price counts only when the customer was
  told it at least 30 days before the renewal day. The rule and its words are under "Not built
  yet, all with Stripe", number 2. Renewing by itself is still not built.
- **The Care plan report.** The owner, Nov 23: "we should also be able to add pictures to
  checked marked good items since we can then use that to generate the care plan reports", and
  then, offered a second report that starts with every row and its pictures: "1. add a care
  plan report". Built the same day: an inspection ticket's Documents box has a second button,
  "Care plan report", beside "Inspection report", for the same people. One press makes the
  report and opens it in the editor, where the office can still change anything. It starts with
  the property, the customer, the inspection's day, who did it and the grade when there is one,
  and on a plan's inspection the plan and which inspection of the year it was ("Roof Care plan,
  inspection 1 of 2") with the cleaning answers. Then every row of the checklist in its order,
  each with its result, its note and its pictures, the rows found OK included. Then the issues
  again as a short list. No price, cost or credit anywhere. Nothing is made, sent or attached
  without the press, and the Inspection report is as it was. Record:
  `docs/qa/care-plan-report-2026-11-23.md`.
  Two more the same evening, at the owner's "go with issue 1, issue 2". A row nobody answered
  prints "Not checked" on this report, and its Summary counts those rows apart ("1 issue · 2 OK
  · 1 N/A · 6 not checked"). Everywhere else such a row still reads as OK, the Oct 26 rule. And
  the ticket's pictures that are on no row go on the last page under "Other pictures from this
  visit"; with none there is no heading. That heading is the Photo Grid's own (the owner, Nov
  23: "4 go"), so it prints only when a picture is under it: with Photos switched off, or the
  pictures taken out of the grid, it is not printed, in the PDF or in the editor.

**The owner's other answers of Nov 23, for the record. Nothing was built for these.**

- New issue 3, a finger resting on a Tech Board ticket and then swiping can pick the ticket up:
  "i think this is a non issue".
- New issue 4, a fresh camera picture opening in the mark-up editor: "it opened when i took a
  picture a moment ago". It works on his phone.
- New issue 6, a technician with no name on file showing as an email address on the board: not
  an issue to him ("this isnt an bid issue").

**The go-aheads on the workflow audit, Nov 23, night** (`docs/qa/roof-care-audit-go-aheads-2026-11-23.md`).

- **A renewal's plan year starts the day after the old year's last day** (the owner: "start the
  new year the day after"). The old year covers its last day, so no day is covered by both. Paid
  ahead, the new year ends one year on from the old year's last day, so the renewal date stays
  the same date every year. Paid late, it starts on the payment as before
  (`roof_care_start`, migration `20261124200000`).
- **A plan inspection's ticket with no day** is on the owner's Needs attention list from the day
  the ticket is made (the owner: "1 go with A"). The database still makes that ticket with no
  day when the inspection's window is a range of days: the office sets it.
- **A set number of days is not a promise** (the owner: "we will accommodate the best we can but
  we cannot guarantee that date"). The sign-up says so under that choice at all times, picked
  or not, and the agreement says so when it was picked. The
  terms were not changed.
- **A plan's invoice** has its own words at Mark paid and when it is final or void, a Roof Care
  badge in the Invoices list, and a Roof Care chip that shows the plans' invoices alone.
  Invoicing a plan with no ticket stays as it is (the owner: "that is fine").
- A property needs a street address to be signed up (the owner: "no change needed here they
  need an address").

## Still to build

Step 4 was built on Nov 21: see "Step 4, built Nov 21" below. What is left of it:

1. ~~The two public pages.~~ Built, Nov 21: `/care` and `/request`.
2. ~~The printable sheets.~~ Built, Nov 21: Setup › QR pages.
3. ~~The office's list of sign-ups waiting to be matched.~~ Built, Nov 21, as a list of its
   own. Replaced on Nov 23: every request becomes an opportunity at once and is answered there.
4. ~~Renewal.~~ Done, Nov 19: see "Renewal, built Nov 19" under paying up front.
5. ~~The terms on the sign-up.~~ Done, Nov 18.
6. ~~The tick boxes of services.~~ Built, Nov 21, from a list the office edits on Setup › QR
   pages. The list it starts with is a guess: see Open 1.
7. ~~The roof's size from the building's outline.~~ Done, Nov 19: offered on the sign-up.
8. ~~An "Opened" notice for a ticket the morning check makes.~~ Done, Nov 20: the 8:00 run
   announces them (`src/lib/roof-care-ticket-announce.server.ts`).

## The terms: agreed

The owner, Nov 18: "i like all 10 you came up with". Terms 2, 3 and 9 were rewritten on Nov 19
for paying the year first (version 2026-11-19), and he agreed them the same day. They are
`ROOF_CARE_TERMS` in
`src/lib/roof-care-plan.ts`, dated by `ROOF_CARE_TERMS_VERSION`. The sign-up shows them with a
tick, and the plan keeps the date of the set that was agreed (`roof_care_plans.terms_version`).
Change a line: change the date too.

Every set of terms that was ever in use is kept on file under its version
(`src/lib/roof-care-terms-history.ts`; the owner, Nov 23: "2 go"), so a plan signed under older
terms is still emailed the words it agreed to. To change the terms, file the set in use there
first, then give the new set a new version.

The set now in use is version 2026-11-23.1 (Nov 23, at the owner's "make sure number 6 is included
in the terms"): term 3 adds that what the plan includes applies to work done in its twelve months,
and that work done before the plan starts is not covered. Version 2026-11-20.1 (Nov 20) had term 7
add that what is left of the plan's minor repairs amount goes toward a charged return trip first. Version 2026-11-19.4 (Nov 19,
late) had term 7 charge the return trip after the first visit of a plan year we could not do for
want of access, and term 8 bill a storm inspection beyond the one the plan includes.

Version 2026-11-24.1 (Nov 24) changed the last term: an inspection is a visual check on the day,
and we are not responsible for a leak or a condition we did not find
(`docs/qa/roof-care-disclaimer-2026-11-24.md`). The set now in use is version 2026-11-24.2 (Nov
24, late): term 4 no longer says the price is corrected "once", because a size can be corrected
more than once and each correction is recorded (`docs/qa/roof-care-correct-size-2026-11-24.md`).

## Correcting a roof size (Nov 24)

The owner: "1. yes but then build the rest. 2. send it but can it be combined with the new price
payment? 3. more than once but recorded and remove that line".

- A manager or an admin presses **Correct the roof size** beside the size on a plan. The window
  shows the new price before anything is saved. The rule is the database function
  `roof_care_correct_size`.
- A plan that waits for its payment takes the new size and the new price. Its unpaid invoice is
  made again. A payment already on that invoice stops the correction.
- One email, "We measured your roof", tells the customer the new price. For a card plan it holds
  the Pay by card button, so the new price and the payment request are one email.
- Every correction is kept on the plan (`size_changes`) and listed under the size.
- A plan already paid takes the new price too. A bigger roof is billed the difference on a
  draft invoice of its own (`invoices.plan_part = 'size'`). A smaller roof is owed the
  difference back, and the office records the refund once it is sent. The refund worked when a
  plan ends counts both.
- The record is `docs/qa/roof-care-correct-size-2026-11-24.md`.

## Open

1. **The list of services** for the request form. The owner has not settled it (Nov 18: the
   leave-behind's list is not right). The tick boxes were built on Nov 21 over a starter list of
   eight that anyone who manages Setup can change on Setup › QR pages, with no new code. Ask him
   to read the list there before the sheets are printed.
2. ~~The sign-up's terms.~~ Agreed on Nov 18: see "The terms: agreed".
3. **The web address in the QR codes.** Printed codes are permanent. The owner does not have the
   login for the company's domain (Nov 20: "i dont have the godaddy login") and may buy a new
   one. Until an address is saved on Setup › QR pages the codes hold the site's own address,
   and the page warns not to print them: that address is borrowed and can change. Once he
   has a domain: point it at the site, save `https://` and the name on that page, scan each
   code with a phone, then print.

## Build order

1. The price engine and the Setup page for plans and numbers. **Done.**
2. Plan records, the customer badge, care plan inspections made by the site, push-back, the
   half-and-half invoices. **Done.**
3. On-site sign-up with credit. **Done.**
4. The two public pages, the office's match list, the printable sheets with QR codes. **Built,
   Nov 21.** It is live for visitors once it is published and the address is settled (Open 3).

## Step 4, built Nov 21

The pages a visitor sees are in `docs/qa/roof-care-flyer-look-and-public-pages-2026-11-21.md`.
What is behind them is in `docs/qa/public-forms-2026-11-21.md`. In short:

- **Two pages with no sign-in**: `/care` (Roof Care plans) and `/request` (Request service).
  They are the only pages a stranger can open besides the sign-in screens.
- **Nothing in the database is open to a stranger.** The pages ask the site's own server, and
  the server asks the database with its own key. The rule of Nov 14 (no database call without a
  sign-in) stands, and its test still fails on any grant to the anonymous role.
- **Prices** come from the same price function the sign-up uses. The answer holds the three
  yearly prices and what each plan includes, and nothing else: no cost, no profit, no drive, and
  nothing about who is already a customer. The price shown is kept, and the request must match
  it.
- **A size range shows a range of prices** (Nov 23, the owner: "go with B and C"). A visitor
  who picks a size range and types no size sees each plan from its price at the small end of
  the range to its price at the large end, and the page says which size the prices are for and
  how to get one price. The office reads the same two prices on the request, and the sign-up it
  opens starts with a blank roof size. `docs/qa/public-quote-size-range-2026-11-23.md`.
- **A roof with no price** (over the custom quote size, the largest size range, several
  buildings, or an address the map cannot place) is sent as a request to be called with a
  custom quote. Nothing is signed, and the office never opens a sign-up from it.
- **Limits.** A connection: 20 price questions and 5 requests an hour. Everyone together: 400
  price questions and 60 requests a day. Over a limit the page says to wait or call.
- **The office's side** (Nov 23, the owner: "i like option A"): every request becomes an
  opportunity the moment it is sent, in the normal Opportunities list. There is no separate
  list of requests any more; its two old addresses send people on to Opportunities. The
  opportunity has the plan or the services in its title, the source "QR page", who referred
  them, the price the page showed as its value, tomorrow as its date, no customer and nobody
  assigned, so the "nobody on it" alert covers it. On the opportunity a strip shows what the
  customer sent and the customers who may be the sender (same phone, same email, a name alike,
  or the same street address: broad on purpose). A person says which, or "New customer". The
  site never picks by itself. A request that is not real is answered by deleting its
  opportunity. A Roof Care request then shows "Open the sign-up", which opens the normal
  sign-up on the property with what the visitor picked. The opportunity is set to Won
  the day the plan is paid and starts (the owner, Nov 23: "2 go"; the database does it, for a
  check and for a card alike), not the day it is signed. No payment is taken on the public page: the plan starts when the
  office receives the payment, as for any plan. An unanswered request is on the owner's Needs
  attention list, and the admins and managers get one notice that opens the opportunity.
  Record: `docs/qa/public-requests-opportunities-2026-11-23.md`.
- **Setup › QR pages** (a tab of Setup since Nov 23): the two printable sheets with the codes (made by the site, no prices),
  the web address inside the codes, the list of services, and the limit on Google drive lookups
  a day (200 to start; over it the free router answers and the drive tool says so).
- **The database**: `supabase/migrations/20261121100000_public_forms.sql`, applied by hand on
  Nov 21.

Not proven until it is published: a real request from a phone through to the office's list, the
notice, and a printed code scanned off paper.
