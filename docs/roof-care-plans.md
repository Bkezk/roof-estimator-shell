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

## Open

1. **The list of services** for the request form. The leave-behind's list is not right and the
   owner is not sure yet. Ask before building the tick boxes.
2. **The sign-up's terms.** What the customer agrees to when they sign.
3. **The web address in the QR codes.** Printed codes are permanent. The owner does not know how
   to set up a forwarding address on flatroofonline.com and needs step-by-step help.
4. **Referral credit.** What "credit" means in practice: a name on the record, a report, a payout.

## Build order

1. The price engine and the Setup page for plans and numbers. **Done.**
2. Plan records, the customer badge, care plan inspections made by the site, push-back, the
   half-and-half invoices.
3. On-site sign-up with credit.
4. The two public pages, the office's match list, the printable sheets with QR codes.
