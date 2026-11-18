# Roof Care audit, Nov 18, 2026

The owner asked for an audit of everything built on Nov 18: the price by distance and in general,
what the Owner page reports, how the inspections are generated and kept up, signing up through
the buttons, who gets the credit, and the QR links. He also asked for a box on an opportunity
that shows who referred the customer.

This file records what was **proven correct** and how. The findings that are still open are kept
with the office's other private notes, not here: `office_reference_notes`, key
`roof-care-audit-2026-11-18`. Read them with
`select body from public.office_reference_notes where key = 'roof-care-audit-2026-11-18'`.

## How it was checked

1. An independent reviewer read the code and the database files with no access to the database.
2. The live database was tried inside transactions that were rolled back. To try other days of
   the year, copies of the two live functions were made inside the transaction with only the
   clock replaced. Nothing was left behind.
3. The buttons were pressed in a browser against the live data with every save blocked. What
   would have been sent was read.

## The price

| Check                                                            | Result                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| The live price function against an independent working, 70 cases | The same on every case                                          |
| The admin page's engine against the same 70 cases                | The same on every case                                          |
| A drive at or under the list price's round trip                  | The list price, never less                                      |
| A roof over the custom quote size                                | No price. "Call the office"                                     |
| No roof size, a negative one, a negative drive                   | No price                                                        |
| The two halves                                                   | They always add up to the price. The first takes the odd dollar |
| Four real properties through the Care Plan button                | Each price worked out by hand from the drive shown: the same    |

The 70 cases were seven roof sizes by ten drives: no drive given, under the baseline, at it, a
hundredth of an hour over it, miles over but not hours, hours over but not miles, and four longer
drives.

## The inspections

| Check                                                              | Result                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| The database's dates against the sign-up screen's, 22 sign-up days | The same on every day                                                  |
| Days tried                                                         | Each edge of both windows, Dec 31, Feb 29, and each first-visit choice |
| "Do it now" by a technician                                        | A ticket for today, assigned to them                                   |
| The morning check 15 days before a window opens                    | No ticket                                                              |
| The morning check 14 days before                                   | One ticket                                                             |
| The morning check run again                                        | No second ticket                                                       |
| The morning check with nobody signed in, as the timer runs it      | Works                                                                  |
| A ticket that is done                                              | Not made again                                                         |
| A plan that has ended                                              | No new tickets                                                         |
| A ticket dated after its last day                                  | Refused, in words                                                      |
| The ticket's link to its inspection changed by hand                | Refused                                                                |
| The timer                                                          | Set for 11:40 UTC daily, active. It had not had a first run yet        |

## Push-back, storm, ending a plan

| Check                                          | Result                                |
| ---------------------------------------------- | ------------------------------------- |
| The office pushes 10 days                      | Allowed. The next inspection moves 10 |
| The office pushes past 30 days in all          | Refused: needs a manager              |
| An admin past 30 days with no reason           | Refused: needs a reason               |
| An admin past 30 days with a reason            | Allowed. Reason and name kept         |
| An inspection pushed past the plan year        | The renewal moves with it             |
| A done inspection pushed                       | Refused                               |
| A technician pushes, adds a storm, ends a plan | Refused, each one                     |
| A storm inspection on Roof Watch or Roof Care  | Refused                               |
| A storm inspection on Roof Guard               | Made, billed nothing, with its ticket |
| A second storm inspection by the office        | Refused: a manager can add another    |
| A plan ended by an office user                 | Refused: a manager's                  |
| A new plan on a property whose plan ended      | Allowed                               |

## Credit

| Check                                               | Result                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| A technician signs a customer up                    | The plan carries the technician's name                              |
| An office user signs a customer up                  | The plan carries the office user's name                             |
| The customer's name                                 | Kept as typed, on the plan                                          |
| The seller's name sent by the caller                | Cannot be. The database reads who is signed in                      |
| A request for an additional service by a technician | An opportunity with the technician's name, source "On-site request" |
| A technician at a property they have no ticket at   | Refused, for a plan and for a request                               |
| No name of who agreed, or no terms                  | Refused                                                             |
| A second plan on one property                       | Refused                                                             |

## Access

- No visitor without a sign-in can call any of the plan functions or read any of the tables.
- Nobody writes the plan tables by hand. A technician's direct change was refused.
- A technician reads no row of the cost settings.
- A technician sees the plan of a property they have a ticket at, and no other.

## The Owner page

The Roof Care line was proven on Nov 18 with rows worked out by hand
(`docs/qa/owner-lines-of-business-2026-11-18.md`). None of that code changed after the proof. No
row is counted in two lines.

## The QR links

There are none yet. The two public pages are step 4, held at the owner's word. The site's only
pages without a sign-in are the sign-in page, the password reset and the shared document and
invoice links.

## Added: Referred by on an opportunity

The owner: "add a form on an opp shows who referred the customer". Every opportunity now has a
**Referred by** box beside the lead source. A request taken on site fills it with the person who
took it. The office reads it, types it and corrects it. The list shows it on the opportunity's
line and the search finds it. A save that does not send the box leaves the name as it was.

Tests: `src/lib/opportunity-referred-by-nov18.test.ts` (9). Browser, saves blocked, at 1400 and
390 wide: the box is on a saved and on a new opportunity, and a typed name is in what the save
would send.
