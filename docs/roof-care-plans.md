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

## Still to build

**Do not forget step 4.** The owner, Nov 18: "we'll work on 3 later but dont forget".

1. **The two public pages** opened by QR codes, with no sign-in: "request service" and "Roof
   Care plans". The plans page hides prices until the address is typed. A possible match with an
   existing customer is held for the office. A "who referred you" box fills `referred_by`. A
   several-buildings choice says to call for discounted pricing.
2. **The printable sheets** with the QR codes and no prices.
3. **The office's list of sign-ups waiting to be matched** to a customer.
4. **Renewal.** A plan is one plan year. Nothing yet starts the next year or re-prices it. The
   first plan cannot reach its renewal before Nov 18, 2027.
5. **The terms** on the sign-up, once the owner has settled them.
6. **The tick boxes of services** on the request, once the owner has settled the list.
7. **The roof's size from the building's outline**, where the site has it. It is typed for now.
8. **An "Opened" notice** for a ticket the morning check makes. Today it shows as unassigned work
   and the "Nobody is on it" reminder covers it.

## A draft of the terms, for the owner to change

Put to the owner on Nov 18 after "idk what should the customer agree to?". Nothing here is agreed.

1. What the plan includes, by its name, as on the flyer.
2. The yearly price, billed half at each of the two inspections.
3. The plan runs twelve months from the day it is signed.
4. The price is an estimate until the roof is measured, and may be corrected once.
5. Minor repairs are valued at standard rates. An unused amount does not carry over.
6. Repairs beyond what the plan includes are quoted first and billed separately.
7. The customer gives roof access on the agreed day. A missed visit is rescheduled once at no
   charge.
8. A storm inspection is asked for by the customer after the storm.
9. Either side can end the plan in writing. What has been done is billed. Nothing is refunded
   for a visit already made.
10. The plan is not a warranty and does not cover the roof's replacement.

## Open

1. **The list of services** for the request form. On hold at the owner's word (Nov 18). The
   leave-behind's list is not right. Ask before building the tick boxes.
2. **The sign-up's terms.** What the customer agrees to when they sign. A draft is with the owner.
3. **The web address in the QR codes.** Printed codes are permanent. The owner does not know how
   to set up a forwarding address on flatroofonline.com and needs step-by-step help.

## Build order

1. The price engine and the Setup page for plans and numbers. **Done.**
2. Plan records, the customer badge, care plan inspections made by the site, push-back, the
   half-and-half invoices. **Done.**
3. On-site sign-up with credit. **Done.**
4. The two public pages, the office's match list, the printable sheets with QR codes. **Next,
   when the owner says.**
