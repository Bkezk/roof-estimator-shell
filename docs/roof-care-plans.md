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

- A second invoice on a ticket keeps bringing everything from the ticket. The office takes off
  what it does not want. (Purchase orders already billed are left off, since Nov 18.)

## Open

1. **The exact travel rule.** Proposed: for a round trip over 2 hours, each trip of the plan year
   adds the extra crew time and the extra miles, at cost. Not confirmed.
2. **When the first visit happens** after sign-up, and whether visits follow the seasons or the
   sign-up date.
3. **Pushed back too far.** What happens when a pushed visit would land outside the plan year.
4. **The list of services** for the request form. The leave-behind's list is not right and the
   owner is not sure yet. Ask before building the tick boxes.
5. **The sign-up's terms.** What the customer agrees to when they sign.
6. **The web address in the QR codes.** Printed codes are permanent. The owner does not know how
   to set up a forwarding address on flatroofonline.com and needs step-by-step help.
7. **Referral credit.** What "credit" means in practice: a name on the record, a report, a payout.

## Build order

1. The price engine and the Setup page for plans and numbers.
2. Plan records, the customer badge, care plan inspections made by the site, push-back, the
   half-and-half invoices.
3. On-site sign-up with credit.
4. The two public pages, the office's match list, the printable sheets with QR codes.
