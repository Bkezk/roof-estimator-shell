# Special instructions for technicians, the proposal's address, and four database rules

Date: Nov 18, 2026

Three things that came out of the owner's answers to the audit of Nov 18.

## 1. Special instructions: where technicians read them, and a box for the office

The owner's words: "can we have the special instructions be at the top of the timeline when techs
are looking at history at this property as well as add a viewable to technicians check box next to
special instructions for the office". Asked which instructions and how the box should behave, the
owner chose: this ticket's instructions above the timeline; the box starts ticked; unticked hides
the instructions from technicians everywhere.

### What changed on the screens

- **History at this property** now opens with a box, "Special instructions for this ticket",
  above the timeline. It is in the fold on the ticket page and in the pop-up that My tickets and
  the close-out open. No box when the ticket has no instructions.
- **The ticket** has a tick box, "Viewable to technicians", beside Special instructions. Only the
  office sees it. It is ticked on every ticket there is and on every new one, so nothing changes
  until someone unticks it.
- **Unticked**, the office reads under the box: "Office only. Technicians do not see these
  instructions." The history box says the same to the office.
- **A technician on such a ticket** is shown no instructions box on the ticket, none above the
  history, and nothing in the Tech Board's pop-up. The line under the details reads "The office
  sets these. The close-out marks the ticket Done."

### How the text is kept from technicians

A row's columns cannot be shown to one reader and hidden from another. So instructions that are
not for technicians are kept in a table of their own, which a technician-only login cannot read:

| Box      | Where the text is                                |
| -------- | ------------------------------------------------ |
| Ticked   | On the ticket, as always                         |
| Unticked | In the office's own table; the ticket's is empty |

No screen, list or pop-up a technician opens can carry the hidden text, because the database does
not give it to them.

- The office's reads put the two back together. That includes the read the ticket page opens on.
- The save moves the text when the box changes. Hiding: the text is kept in the office's table
  first, then taken off the ticket. Showing: the other way round. A failure in between leaves the
  text in both places, never in neither.
- A ticket whose box was ticked all along asks the database nothing more than before.
- A technician's save never changes the box, and leaves hidden instructions alone. The database
  refuses both as well.

### Found while proving it

The first browser run showed the office's box empty on a ticket with office-only instructions,
while the history box had the text. The ticket page opens on a different read from the one first
changed. Left as it was, a save from that page would have removed the text. Fixed, and a test now
names every read and write that hands the ticket page its ticket.

## 2. The proposal prints the typed city, state and zip

The owner asked of the audit's finding: "doesnt a property have to be picked?" It does not: the box
on a trade bid is "Property (if the customer has more than one)", and a customer added on the spot
has none. With no property picked, the proposal printed the street and no city, state or zip. The
three boxes were typed on the bid and never read. The invoice already printed them.

The owner chose "print the typed address". The proposal now takes the job site's City, State and
Zip boxes when no property is picked. A property stays optional. With none of the three typed it
reads the one-line "City, ST 12345" box, then such a line under the street, as before. The same
holds for a roofing bid with no property.

## 3. Four database rules brought in line with the site

The owner chose "Close all four". Each rule already matched what the site does. None was enforced
by the database itself. Nothing changes on any screen.

1. **An inventory entry** from someone without Estimate access is made now, by them, with the
   sign its reason has: stock coming in is above zero, stock going out is below. An estimator's
   entries and a saved count are as they were.
2. **A bid's job number** is given once, by the numbering function, when the bid is first
   invoiced. Nothing else sets or changes it. A bid's price stays the estimator's to set, as it is
   on the bid itself, and every change to a bid is kept in History.
3. **The "nobody is on it" marks** are read by the office, not by a technician-only login.
4. **"Viewable to technicians" on a new Activity entry**: only on a ticket, only on an entry a
   person makes, and only from someone who works tickets. The site now shows the tick box to the
   same people. Someone who reads tickets only through Customers access is no longer asked.

## The database

Applied by hand on the live database and checked, statement by statement. Safe with the older
published site.

| File                                                  | What it does                                         |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `20261118200000_special_instructions_office_only.sql` | The box, the office's table, the technician's limits |
| `20261118210000_access_rules_tightened.sql`           | The four rules                                       |

Tried on the live database in trials that were rolled back:

- A new ticket starts ticked. With the box unticked: the technician reads no instructions on the
  ticket, sees no row of the office's table, cannot write to it, cannot tick the box, and typing
  into the instructions changes nothing while the rest of their save goes through. The office
  reads the text. Ticked again: the technician reads it, and their edit saves as before.
- Inventory, as a technician: used on a job, a leftover, received today, a move between two
  places and a put-back on a job all save. A back-dated entry, a minus "Received", a plus "Used",
  an entry in another person's name and an adjustment are refused. An estimator's dated
  adjustment still saves.
- A bid's job number: an estimator's change is refused; so is an admin's by hand. An ordinary save
  and a price change go through, and History gains a row for each. The numbering function gives
  1001, and 1001 again when asked twice.
- The marks: a technician reads none; the office reads the one there is.
- Activity: a technician's note marked viewable saves; one of the site's own lines marked viewable
  is refused; the close-out summary saves; the office's call saves ticked or not. No login with
  Customers access alone exists to try the last case, so that one rests on the rule's text.

## Proof

- New checks: 31 in three files. `ticket-instructions-nov18.test.ts` (24): the rules; the save in each
  direction and its order; a technician's save; what each reader is given on the ticket, the
  board's pop-up and the history; the database change; the screens.
  `documents/server-pure.test.ts` (2 more): the typed boxes on the proposal.
  `audit-fixes-nov18.test.ts` (5 more): the four rules, and that the site's own writes fit them.
- Four older checks updated where a pinned line changed, each with a dated note.
- Full run: 596 files, 8,551 checks pass. Lint, types and the production build are clean.
- Browser, on a temporary ticket made for the purpose at a property with two earlier tickets,
  with every save blocked, on a desk and a phone size:
  - as an admin with the box unticked: the instructions are in the box, the tick box is unticked,
    the "Office only" line shows and goes when the box is ticked in the page; the history opens
    with the instructions box above the two earlier tickets, with the "Office only" line;
  - as a technician-only login with the box unticked: no instructions box, no tick box, no box
    above the history, the plain line under the details;
  - as the same technician with the box ticked: the instructions on the ticket and above the
    timeline, no tick box;
  - no sideways scroll, no page errors.

## Left as it was found

The temporary ticket and everything made with it were removed. No ticket has its box unticked.
Ticket and trade numbering are untouched. The test login is an admin again.

## Not tested

- The proposal's address was proved by its checks, not by making a document in a browser.
- Nothing was tried on a real phone.

## Added the same day: the instructions where a technician works

A property with no earlier tickets has no history to open, so its instructions had no box on My
tickets. The owner's words: "think of a solution for when there is no history but still special
instructions", then "go on 1".

- The **My tickets card** shows the ticket's Special instructions in a box under the description.
- The **close-out** opens with the same box. There the office is told when technicians do not see
  them.
- The history pop-up keeps its box. All three are one component.
- A technician is never handed instructions the office keeps to itself, so none of the three can
  show them.

Proof: 3 more checks in `ticket-instructions-nov18.test.ts`. Full run: 596 files, 8,555 checks
pass. In a browser at phone size, on a temporary ticket with no property and so no history, with
every save blocked: the box is on the My tickets card and at the top of the close-out, with the
words as typed. The temporary ticket was removed.
