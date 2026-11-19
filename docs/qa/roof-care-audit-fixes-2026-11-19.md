# Roof Care: fixes after the audit, Nov 19, 2026

The owner read the audit's findings and asked for four of them to be fixed ("2. Fix 3. Fix … 5.
Fix … 11. Fix"), and allowed one live test of the automatic invoice ("You can run a test
automatic invoice, that's fine"). The numbers below are his. The live test found a fifth fault,
fixed here too.

The findings not listed here are still with the office's private notes: `office_reference_notes`,
key `roof-care-audit-2026-11-18`.

## What changed

| No.  | What was wrong                                                                   | What happens now                                                                                                    |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2    | One inspection could end up with two live tickets, each billing its half         | One live ticket for an inspection. Restoring a deleted one beside its replacement is refused in words               |
| 3    | The price saved could differ from the price the customer was shown               | The sign-up sends the price shown. A different price now is refused, the prices are read again, and the tick clears |
| 3    | A drive worked out as a straight-line estimate was not said                      | The form says the drive time is an estimate, and the plan is marked as estimated                                    |
| 5    | An ended plan kept its open tickets, and they still billed at Authorized         | Ending a plan takes its untouched tickets off the board, with a note. An ended plan bills nothing by itself         |
| 11   | "X plus Y for the drive" could be a dollar off the price                         | The drive's share is the price less the list price. They always add up                                              |
| 11   | The admin page could show a dollar less than the sign-up in rare half-cent cases | The page rounds a half cent as the database does                                                                    |
| Live | A care plan invoice with time on the ticket was made with a total and no lines   | The lines are saved. A failed save leaves no empty invoice behind                                                   |
| Live | The Needs authorization card said nothing is invoiced                            | It says the draft invoice is made at that press                                                                     |
| Live | A storm inspection got no invoice, so its cost was counted nowhere               | It gets an invoice for nothing that keeps what the trip cost                                                        |

A ticket the crew has started is never taken off the board by ending a plan: one that is en
route, on site, done or invoiced stays, and the office decides.

## The fault the live test found

A temporary plan and its inspection ticket were made for the test customer, with two time
entries, and the ticket was authorized through the site. The invoice was made with its total and
no lines. The server's answer was a refusal of the lines: the plan's own line and the ticket's
lines named different columns, and rows saved in one request must name the same ones. No earlier
check had saved a care plan invoice with time on the ticket into the real database.

`withLineSwitches` (`src/lib/roof-care-invoice.ts`) now puts the three switches on every line,
each as the database would default it, and the first save of any invoice uses it.

## How it was proven

1. **The database, in transactions that were rolled back.** Sign up, delete the ticket, run the
   morning check, restore the deleted one: refused, one live ticket. A second ticket for the same
   inspection made by hand: refused by the index. End a plan with one untouched ticket and one the
   crew is on: the first is taken off with its note, the second stays, and the morning check
   months later makes nothing.
2. **The price, live.** The 70 cases of the audit again, from the live function and from the
   independent working with the new rule: the same on every case, and no case where the list
   price and the drive's share do not add up to the price.
3. **The automatic invoice, live.** The temporary ticket was authorized through the site twice:
   once on the old code, which left the empty invoice, and once on the fixed code.
   - The card before the press: "its draft invoice is made by itself".
   - After the press: stage Authorized, the toast "Inspection … authorized. Its draft invoice is
     on the ticket.", and the card shows the draft with its total.
   - The invoice: the plan's line at the visit's half, listed with its price. The labor and
     travel lines at no charge, hidden from the customer's copy, with their cost kept. No tax.
   - The same invoice made with the ticket's button: the same three lines.
4. **Tests.** `src/lib/roof-care-audit-fixes-nov19.test.ts` and the sign-up's tests in
   `src/lib/roof-care-plan-nov18.test.ts`. Every number in them is made up.

Everything temporary was removed: the plan, its two inspections, the ticket, its time, the
invoices, the notices and the history rows. The ticket numbers were put back.

The two presses of Authorize each sent the real "Authorized" notice to the four admins and
managers. Their rows were removed from the bell; a push already sent to a phone cannot be taken
back.

## The database change

`supabase/migrations/20261119100000_roof_care_audit_fixes.sql`, applied to the live database on
Nov 19 and checked there: the price function's drive share, the morning check's step-over, the
unique index `service_jobs_one_per_care_visit`, the restore rule in
`service_jobs_care_plan_rule`, and `roof_care_end`.
