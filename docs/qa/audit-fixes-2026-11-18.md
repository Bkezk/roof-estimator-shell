# Fixes from the audit of Nov 18

Date: Nov 18, 2026

The audit's findings went to the owner as a numbered list. The answers: "1. this is fine since if
someone is moving a ticket to today they have eyes on it already 2. can you fix those? 3. fix
please. 4. doesnt a property have to be picked? 5. fix this plz 6. fix please. 7. fix please. 8.
fix please. 9. fix please 10. fix please. 11. can we have the special instructions be at the top of
the timeline ... 12. fix please 13. fix please 14. fix please."

This record covers 2, 3, 5 to 10 and 12 to 14. Item 1 stays as it is. Items 4 and 11 are questions
that went back to the owner.

## What changed

### 2. Every reminder goes at 8 AM on a working day

- Work with no date of its own was reminded "now plus N days", at the time of day it was assigned.
  A ticket given out on a Friday afternoon was reminded on Saturday afternoon. Its first reminder
  is now N working days on, at 8:00. An opportunity with no expected close keeps its calendar days
  and is moved to Monday when they end on a weekend.
- The first "Done, waiting" reminder follows the same rule.
- A reminder that came due overnight, or was held over a weekend, went on the day's first run at 7. The run now reads no reminders before 8:00.
- Three timers still carried a clock time from the older rule. They were moved to 8:00 on their own
  day.

### 3. A trade bid with a line missing a number goes no further

A line with no cost priced at $0, so the bid's price was short. Only the bid screen said so.

- It is not marked Submitted or Won. The message names the line: "Not marked Won: a line on this
  bid is missing a number (Primer: type the cost), so its price is not complete. Open the bid, fill
  it in and save."
- No invoice and no proposal is made from it.
- A bid that is already Submitted or Won is not saved with a line missing. A draft still saves.

### 5. A trade bid's notices open Trade Bids

The "due", "past due" and "Remind me on" notices of a trade bid linked to the roofing estimator and
said "Open the estimator". They now open the trade bid and say "Open the bid".

### 6. A won bid with an invoice stays Won

A bid with an invoice that is not void cannot be set back to Draft, Submitted or Lost. The database
says: "This bid has an invoice (T-1001). Void the invoice before changing the bid from Won."

### 7. The trade bid page fits a phone

A long property line made the page 692 wide on a 390 screen. The line is now cut with "…" inside
its box.

### 8. A count dated to an earlier day

A December 31 count typed in on January 3 is compared with what inventory held on December 31. A
use that happened in December and was typed in late was then taken off twice: once by the count,
once by the late entry.

- The sheet of an earlier day now lists, under each item, what was typed in since that day.
- Each entry has a tick box: "Tick if it happened on or before Dec 31". A ticked entry is counted
  as before the count, and Expected changes on the spot.
- On save the database moves the ticked entries into the count day and adds to their note when
  they were really typed.
- Today's sheet is unchanged.

One limit remains by design: an entry typed in after the count is saved, for something that
happened before it, is not known to the count.

### 9. A material priced by the box

A service material linked to an Estimate Pricing row that is priced by the box took the box price
and multiplied it by the pieces in the box. Its cost on an invoice and its Setup value in inventory
are now the box price. A row priced by the piece is still multiplied.

### 10. A purchase order is billed once (taken back the same day)

This was built and then undone. The fix left a purchase order off a second invoice when another
invoice of the ticket already carried it. Asked whether time and materials should follow, the
owner chose the opposite for all three: "id rather it have everything and they can just take it
off as needed". A second invoice now starts with the ticket's whole time, materials and purchase
orders, as it always had. The office removes the lines it does not want.

### 12. Entries not ticked "Viewable to technicians"

A technician-only login could still read every Activity entry on a ticket they are assigned to.
The database now gives a technician only the entries that are ticked, their own entries, and the
lines the site writes itself. The office reads everything, as before.

### 13. A repair ticket made from an inspection sends "Opened"

It told nobody until someone scheduled it. It now sends the same "Opened" notice as a ticket made
by hand, to the people on the tickets' Each step line.

### 14. "No action needed" on an inspection

- Only a manager or an admin can choose it. An office user sees: "“No action needed” is a manager’s
  to choose."
- A manager or an admin can take it back with "Take back" beside the recorded answer. The timeline
  keeps a line.
- When an inspection is reopened, the answer is cleared, so the redone inspection is looked at
  again. A repair ticket or a bid that came of the inspection keeps its link.

## The database

Five changes, applied by hand on the live database and checked statement by statement. All are
safe with the older published site.

| File                                                           | What it does                                        |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `20261118150000_reminders_at_8_on_working_days.sql`            | Undated work's first reminder; the three old timers |
| `20261118160000_won_bid_with_invoice_stays_won.sql`            | The Won guard                                       |
| `20261118170000_no_action_needed_cleared_on_reopen.sql`        | Clears "No action needed" on a reopen               |
| `20261118180000_unticked_activity_hidden_from_technicians.sql` | The technician's read rule on Activity              |
| `20261118190000_count_takes_entries_typed_since.sql`           | The count takes ticked entries typed in since       |

Tried on the live database in trials that were rolled back:

- A ticket with no date, started on Wednesday Nov 18: due Thursday 8:00. An opportunity: due 30
  days on, a Friday, first reminder 7 working days on at 8:00. The review timer: Thursday 8:00.
  No open timer is left at an odd clock time.
- A won bid with no invoice goes back to Draft. With a draft invoice it is refused for Draft and
  for Lost, with the message above. After the invoice is voided it is allowed again.
- A Done inspection marked "No action needed": an edit keeps the answer, Authorized keeps it, a
  reopen clears it. A "bid" answer survives a reopen.
- On a temporary ticket with four entries, a technician read all four before the change. After
  it: the ticked one, the site's date line and the close-out summary, not the unticked office
  entry. Their own new entry saves and reads back. An office user reads all five.
- The count: 10 received, 2 used typed in late, a count of 8 dated two days back with the late
  entry ticked. Expected 8, counted 8, no correction, ledger 8. It was 6 against a shelf of 8. The
  entry now sits in the count day with "Typed in Nov 18. It happened by Nov 16 and is in that day's
  count" on its note.
- The count refuses an entry of another place, an entry from before the count day, any entry on
  today's count, and a direct call to the move itself. The ledger still cannot be changed by hand.
- The older site's five-argument call to the count still saves. A technician is still refused.

## Proof

- A test for every fix: 44 new checks. Run against the code as it was, 22 checks fail in the
  changed test files and two more files do not load, because the functions they call did not
  exist.
  - `standard-alerts-nov18.test.ts`: the 8:00 gate on the real reminder pass, undated due days,
    trade bid notices.
  - `trade-bids-server-nov16.test.ts`, `trade-invoices-server-nov17.test.ts`: the missing number
    on status, save, invoice and proposal; the Won guard; the phone width.
  - `inventory-year-end-nov16.test.ts`: the earlier-dated count, sheet, rules, save and database.
  - `inspection-flow.test.ts`: the Opened notice, who may choose "No action needed", Take back.
  - `audit-fixes-nov18.test.ts`: the box price, the purchase order billed once, the technician's
    read rule.
- Six older checks were updated where the rule changed on purpose, each with a dated note.
- Full run: 595 files, 8,518 checks pass. Lint, types and the production build are clean.
- Browser, with every save blocked:
  - the trade bid page at 390 px is 390 wide, the property box 323;
  - the Count tab for an earlier day shows the banner and the entry under its item, on a desk and
    a phone size; ticking changes the entry's line and Expected; today's sheet has no banner;
  - an authorized inspection marked "No action needed" shows "Take back" to an admin; an office
    user sees neither button and reads the manager's note;
  - Reminders, Work Overview, Invoices, Service tickets and Owner open with no errors.

## Left as it was found

No temporary rows remain. Ticket, trade and invoice numbering is untouched. The reminder settings
were not saved. The test login is an admin again.

## Not tested

- Nothing was tried on a real phone.
- No real email went out.
- No ticket was created or moved through the site, so nobody was sent a test notice.
