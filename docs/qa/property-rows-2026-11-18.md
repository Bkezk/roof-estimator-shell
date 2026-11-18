# More detail on a property's page

Nov 18, 2026. The owner sent a picture of a property's page and asked: "can you include more
detail on the tickets and bids and opps here on the property?" He was shown three layouts and
chose **a second line on each row**. For tickets he picked "type, technician, dates" and "what
was found and done". He did not pick invoices and money, or photo counts and links.

## What each row shows now

The first line of every row is as it was. Under it:

| List          | Second line                                                                                       | Third line, when there is something to say              |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Tickets       | Type · technician · the day it was done                                                           | Found · Outcome · Repairs · Notes, stopped at two lines |
| Opportunities | Value · where it came from · who follows it up                                                    | Expected close · last contact · who brought it in       |
| Bids          | Project bid or Trade bid with its number · due day · whose it is · the day it went out or was won | None                                                    |

- **Found** is what an inspection flagged, or "no issues".
- **Outcome** is what the office chose after the inspection.
- **Repairs** is what was done on each repair, or the repair's name when nothing was typed.
- **Notes** is the first line of the closing notes.
- The whole of the third line shows when the mouse rests on it.
- A ticket with nobody on it says "Nobody assigned". An opportunity never contacted says "not
  contacted yet".
- **No money is added to a ticket's row.** Technicians read these rows too.
- The customer's page is unchanged. Its rows stay one line.

## Where

- The words: `src/lib/property-rows.ts`.
- The read: `getProperty` in `src/lib/crm.functions.ts`. It hands the page each ticket's
  technician by name and its repairs (`job_extras`), and a few more columns of each opportunity
  and bid. Two more reads for the whole page, whatever the number of tickets. They run under the
  reader's own sign-in, so the database decides what each person may see.
- The rows: `src/components/crm/ticket-rows.tsx` (`extras`), the Opportunities section in
  `src/components/customers-page.tsx` (`detail`), the Bids list in
  `src/components/property-page.tsx`.

## Proof

Tests: `src/lib/property-rows-nov18.test.tsx` (26). One older pin updated with a dated note in
`property-page.test.ts`.

Browser, local build against the live database, every write blocked, as an admin. Temporary rows
at the test customer's property: three tickets, two opportunities, two bids.

| Row                                   | What the page showed                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A closed repair with two repairs      | "Repair · Claude · done Oct 30", then "Repairs: … ; … · Notes: …"                                                      |
| A done inspection with two flags      | "Inspection · Claude · done Nov 13", then "Found: Membrane condition, Perimeter flashings · Outcome: No action needed" |
| An open ticket with nothing           | "Repair · Nobody assigned", no third line                                                                              |
| An opportunity with everything        | "$18,000 · Referral · Claude", then "expected close Dec 5 · last contact Nov 12 · brought in by …"                     |
| A bare opportunity                    | "Unassigned", then "not contacted yet"                                                                                 |
| A bid with a due day and an estimator | "Project bid · due Nov 30 · by …"                                                                                      |
| A bare bid                            | "Project bid"                                                                                                          |

Checked at 1500 and 390 wide. No sideways scroll. No dollar amount on any ticket row. No page
errors.

Removed after: the tickets with their repairs, the opportunities, the bids, and their events and
history rows. Ticket numbers are back at 6075 and trade numbers at 1001. No notices were written.
