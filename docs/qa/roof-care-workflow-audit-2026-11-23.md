# Roof Care: every workflow walked end to end (Nov 23, 2026)

The owner: "can you audit and ensure all of those workflows work?" and, during the audit, "dont
assume during the audit and prove your work".

No code was changed. Each line below says how it was proven:

- **Database**: on the live database, inside a trial that was rolled back, so nothing was kept.
- **Screen**: on the local test server, signed in as the test admin, on a temporary plan at the
  test customer's property. Every temporary row and its stored PDF were removed afterwards.
- **Earlier today**: proven with screenshots or trials earlier on Nov 23, in the record named.
- **Read**: read in the code only. Not seen working.

Prices are left out of this record on purpose.

## 1. Signing up

| Step                                                                            | Proof    |
| ------------------------------------------------------------------------------- | -------- |
| Prices stay hidden until the roof size is typed                                 | Screen   |
| All eleven terms show, and Sign is disabled until the box is ticked             | Screen   |
| The plan is made as "waiting for payment" with its number                       | Both     |
| A second plan on the same property is refused                                   | Database |
| A property with no street address is refused, with a plain message              | Screen   |
| A technician with no ticket at the property is refused the sign-up              | Database |
| A plan that pays by check gets its invoice at sign-up, with no ticket behind it | Both     |

## 2. The invoice with no ticket

| Step                                                                          | Proof    |
| ----------------------------------------------------------------------------- | -------- |
| The plan's invoice has the plan on it and no ticket and no bid                | Both     |
| It is numbered after the plan (RC and the plan's number)                      | Both     |
| A second live invoice for the same plan is refused                            | Database |
| It opens from the waiting plan, and from the owner's Needs attention row      | Screen   |
| It is in the Invoices list, in the Draft group                                | Screen   |
| Finalise, then Mark paid, work on it as on any invoice, and its PDF is stored | Screen   |
| A part payment does not start the plan                                        | Database |
| Paid in full starts the plan that day, with the year running to the same date | Both     |
| Marking it paid wrote no notice by itself when no inspection was close enough | Screen   |

## 3. Paying by card

Stripe is not set up, so no real card was charged. What was proven is the database's side: the
message the site's server passes on when a card payment arrives.

| Step                                                                                                                                                                                                                                                      | Proof    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A payment that is short does not start the plan and is kept as money to send back                                                                                                                                                                         | Database |
| A payment in full starts the plan                                                                                                                                                                                                                         | Database |
| With the plan's draft invoice in place, that invoice becomes paid, by Card, in full                                                                                                                                                                       | Database |
| The same message arriving twice changes nothing the second time                                                                                                                                                                                           | Database |
| A second, different payment on a plan already paid is kept as money to send back                                                                                                                                                                          | Database |
| Only the site's own server may tell the database a card was paid. The two functions are not open to a signed-in person or to a visitor. This was checked by their permissions, because a trial runs as the database's owner and cannot test it by calling | Database |
| The customer's own payment link page, and the office's Card payment link box                                                                                                                                                                              | Earlier  |

Earlier today: `docs/qa/roof-care-pay-link-2026-11-23.md`.

## 4. Inspections

| Step                                                                                                       | Proof    |
| ---------------------------------------------------------------------------------------------------------- | -------- |
| Two inspections are dated when the plan starts                                                             | Both     |
| An inspection's ticket is made two weeks before its window opens, not before                               | Database |
| That ticket has no scheduled day when its window is a range of days. It waits until someone gives it a day | Database |
| A blank checklist is refused; the cleaning questions are required                                          | Database |
| With every row answered, finishing and authorizing pass                                                    | Database |
| No access: the first is free and the second is charged; twice in a day is refused                          | Database |
| Push back, and a storm inspection                                                                          | Database |
| The technician's inspection screens and the Care plan report                                               | Earlier  |

Earlier today: `docs/qa/plan-inspection-answers-2026-11-23.md` and the Care plan report records.

## 5. Coverage and the repairs credit

| Step                                                                 | Proof    |
| -------------------------------------------------------------------- | -------- |
| The plan covers work from its first day, not before                  | Database |
| The repairs credit applies to a repair invoice inside the plan year  | Database |
| A real field technician sees no money and is refused the refund door | Database |

## 6. Renewing

| Step                                                                            | Proof    |
| ------------------------------------------------------------------------------- | -------- |
| The Renew box shows the renewal day, what is owed from this year, and the offer | Screen   |
| Renewal with either choice makes next year's plan, waiting for payment          | Database |
| Paid, the new year starts on the old renewal date and the old plan is closed    | Database |
| Ending this year's plan while a renewal waits is refused                        | Database |
| The run that expires a plan after twelve months                                 | Database |

## 7. Ending early and the refund

| Step                                                                            | Proof    |
| ------------------------------------------------------------------------------- | -------- |
| End plan asks for a reason and shows the refund before it ends anything         | Screen   |
| The ended plan shows "Refund owed" with Mark the refund sent and Change refund  | Screen   |
| The owner's Needs attention list shows the refund owed                          | Screen   |
| Mark the refund sent, with a check number, turns the line to "Refund of … sent" | Screen   |
| A new plan can be signed on the property after the old one ended                | Database |

## 8. Requests from the QR pages

| Step                                                                        | Proof   |
| --------------------------------------------------------------------------- | ------- |
| A request becomes an opportunity at once, matched to a customer by a person | Earlier |
| The opportunity turns Won the day the plan is paid, by check or by card     | Earlier |

Earlier today: `docs/qa/public-requests-opportunities-2026-11-23.md`.

## What could not be tried

- A real send from `/care` or `/request`. The test server has no server key. It is part of the
  owner's one real try from his phone after a publish.
- A real card payment. Stripe is not set up.
- A real email. Email is not set up. On the test server the plan says the agreement "goes out
  within the half hour"; what the published site says while email is not set up was read in the
  code and not seen.
- Remaking a voided plan invoice from the plan. Read in the code and not seen.

## Clean-up, checked on the live database

Plans 0, plan inspections 0, invoices 1 (the one that was there before), temporary tickets 0,
notices 314 (unchanged), documents 45 (unchanged), card payment rows 0, stored PDF of the
temporary invoice gone, its four history rows gone. The Roof Care settings are unchanged (last
saved Nov 19; same fingerprint). The plan number counter is back at its next free number. The
test login is an admin again with nothing else changed.

## Findings

The findings were put to the owner as a numbered list with a solution under each, and nothing was
built. They are kept in the office's private note with the other open Roof Care points.
