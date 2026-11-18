# Work Overview: Claim removed where the dropdown does the same job

Date: Nov 18, 2026

The owner's words: "go ahead and get rid of the claim button since the dropdown establishes the
same thing. also is the reminders page accurate i know we updated some notifications recently".

## 1. Claim

An Unassigned row on Work Overview showed "Assign to…" and Claim side by side. Picking yourself in
the dropdown puts you on the work exactly as Claim did: you become the technician, the date is
kept, the ticket stays Scheduled, and it is refused if someone took it a moment earlier.

Now:

- **A ticket never shows Claim.** Everyone who could claim one has the dropdown.
- **An admin or a manager never sees Claim**, on any kind of row. They have the dropdown on all.
- **Claim stays in one case.** A task or an opportunity nobody is on, for an office person ticked
  Technician who is not a manager. Only an admin or a manager can assign those, so that person has
  no dropdown there, and Claim is their one way to take it. Two people are in that position today.
- **A drop on a calendar day still takes it for yourself**, as before.
- The Calendar pane's line no longer offers Claim where there is none.

Nothing on the server changed. No one gained or lost the ability to take work.

Proof:

- New checks: `src/lib/claim-button-nov18.test.ts` (9): no row has both, no claimable row is left
  with neither, and nobody who could not claim before can now.
- One older check updated (the pane's line).
- Whole suite: 593 files, 8,400 tests pass. Lint, types and the build pass.
- Browser, 1500 px and 390 px, as an admin ticked Technician: both Unassigned rows show
  "Assign to…" and no Claim button; the dropdown lists the signed-in person; the Calendar pane
  reads "Drag one onto a day to take it and put it there, or use Assign to." Nothing was picked.

## 2. Is the Reminders page accurate?

Read against the code and the live settings. Reported to the owner; nothing on the page was
changed.

What it says is right:

- Opportunities, tickets and bids: who is reminded, the due date, the first reminder, the repeat,
  working days for tickets, 8 AM Eastern. The numbers on the page are the ones in use.
- Untouched work: the limits, and "Every admin and manager" being told.
- The scheduled run: every half hour from 7 AM to 6:30 PM Eastern, last run on time.

What it leaves out:

1. **The Nov 17 ticket step notices.** Every admin and manager is told once for each ticket step
   (opened, scheduled, reassigned, date moved, authorized, invoiced, closed, deleted). The page
   does not mention them. They are not reminders and have no number to set; each person turns them
   off with the Service notices switch on My account. The "Needs assignment" line "Nobody is
   reminded while a ticket has no person on it" is true of reminders, but an admin or a manager is
   now told once when a ticket is opened with nobody on it or loses its technician.
2. **The authorize reminder.** When a ticket is marked Done, the person who authorizes it gets an
   "Authorize ticket" timer and is reminded at the ticket's "After that" number until it is
   authorized. The Tickets section stops at "until the ticket is Done".
3. **Flagged overdue.** The page says an unassigned item is flagged after N days "after it is
   entered". That is what happens: the count starts when the ticket was opened, not when it lost
   its technician. It is also flagged as soon as its date has passed, which the page does not say.
