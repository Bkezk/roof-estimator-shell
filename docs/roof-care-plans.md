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
  typed in "who referred you". No payout, no report beyond that.
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

**For the owner to decide:**

1. **The terms say nothing of renewal.** The half off, and the 60 days for an inspection the
   customer kept us from, are the office's rules and are not on the agreement. A new line, and
   a new terms version, need his word first.
2. **A plan past its renewal date stays in force** until it is renewed or a manager ends it:
   the minor repairs left and the leak calls still work. Needs attention says "Was due to renew".
   Whether it should stop by itself after so many days is his call.
3. **The plan at renewal is the same plan.** Moving a customer from one plan to another at
   renewal is done today by ending the plan and signing the new one.

**Not built yet:**

1. **Stripe**: a pay link or QR code at the sign-up, automatic renewal and its discount. The
   owner: "ill work on stripe later".
2. The Owner page does not take a refund off Roof Care's income.

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

## Still to build

**Do not forget step 4.** The owner, Nov 18: "we'll work on 3 later but dont forget".

1. **The two public pages** opened by QR codes, with no sign-in: "request service" and "Roof
   Care plans". The plans page hides prices until the address is typed. A possible match with an
   existing customer is held for the office. A "who referred you" box fills `referred_by`. A
   several-buildings choice says to call for discounted pricing.
2. **The printable sheets** with the QR codes and no prices.
3. **The office's list of sign-ups waiting to be matched** to a customer.
4. ~~Renewal.~~ Done, Nov 19: see "Renewal, built Nov 19" under paying up front.
5. ~~The terms on the sign-up.~~ Done, Nov 18.
6. **The tick boxes of services** on the request, once the owner has settled the list.
7. ~~The roof's size from the building's outline.~~ Done, Nov 19: offered on the sign-up.
8. **An "Opened" notice** for a ticket the morning check makes. Today it shows as unassigned work
   and the "Nobody is on it" reminder covers it.

## The terms: agreed

The owner, Nov 18: "i like all 10 you came up with". Terms 2, 3 and 9 were rewritten on Nov 19
for paying the year first (version 2026-11-19), and he agreed them the same day. They are
`ROOF_CARE_TERMS` in
`src/lib/roof-care-plan.ts`, dated by `ROOF_CARE_TERMS_VERSION`. The sign-up shows them with a
tick, and the plan keeps the date of the set that was agreed (`roof_care_plans.terms_version`).
Change a line: change the date too.

## Open

1. **The list of services** for the request form. On hold at the owner's word (Nov 18). The
   leave-behind's list is not right. Ask before building the tick boxes.
2. ~~The sign-up's terms.~~ Agreed on Nov 18: see "The terms: agreed".
3. **The web address in the QR codes.** Printed codes are permanent. The owner does not know how
   to set up a forwarding address on flatroofonline.com and needs step-by-step help.

## Build order

1. The price engine and the Setup page for plans and numbers. **Done.**
2. Plan records, the customer badge, care plan inspections made by the site, push-back, the
   half-and-half invoices. **Done.**
3. On-site sign-up with credit. **Done.**
4. The two public pages, the office's match list, the printable sheets with QR codes. **Next,
   when the owner says.**
