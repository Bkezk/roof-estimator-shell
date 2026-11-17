# The Tech Board on a phone

Date: Nov 17, 2026

The owner's words: "specifcally the tech board and service tickets need to be optimized for
mobile, it needs to be easy to drag and move tickets onto the tech board and click tickets to see
their details".

## What a phone showed before

- The desk's week grid, squeezed in. A day and a half fit on the screen; the rest scrolled
  sideways.
- Dragging did nothing. The grid's drag and drop is the mouse's, and a finger that moves on a
  touch screen scrolls the page.
- A tap on a ticket left the board and loaded the whole ticket page.
- The Unassigned list sat above the grid, so a ticket to hand out and the technician to hand it
  to were never on the screen together.

## What the owner chose

Asked with two drawings each:

1. Layout: **one day at a time** (not the whole week made smaller).
2. A tap on a ticket: **a details pop-up** (not the ticket page).
3. The ticket page and the Tickets list: **board only for now**.

## What a phone shows now

- **Seven day buttons** across the top, each with its ticket count. Today is marked. They stay at
  the top of the screen while the list scrolls.
- **Every technician is a full-width row** for the chosen day, with a + for a new ticket.
- **The Unassigned tray** stays at the bottom of the screen. Folded, its tickets sit side by side.
  "Show all" opens it with the search, the colour key and the "Finished, no technician" group.
- **Hold a ticket and it lifts.** Then drag it:
  - onto a technician: that technician, the day on the screen;
  - onto a day button: that day, the same technician. Rest on the button for a moment and the
    board switches to that day, so the ticket can go on to a technician there without letting go;
  - onto the tray: unassigned, the day kept;
  - onto "A week earlier" or "A week later", which show under the day buttons while a ticket
    that has a technician and a day is held.
- **A swipe still scrolls.** A finger that moves before the hold time is a scroll, as everywhere
  else. Held near the top or bottom of the list, the page scrolls so a technician further down
  can be reached.
- **A tap opens the ticket's details over the board**: customer, stage, type, property and
  address, technician and day, description, Special instructions, and who to call. Four buttons:
  Open ticket, Move, Call, Directions. Move picks a technician and a day without dragging. Close
  leaves the board where it was.
- After a move is saved a line says what happened ("Ticket #N: name, day."), because the ticket
  may have left the screen.
- Everything a thumb presses is at least 44 pixels. The boxes a person types in are 16 px, the
  size below which an iPhone zooms the page.

Who gets it: any screen narrower than a tablet, and a touch screen up to a tablet held upright. A
desk, and a tablet on its side, keep the week grid exactly as it was.

## What did not change

- Every move is the same single write the desk grid makes, so the same rules apply: only Open and
  Scheduled tickets move, only a manager or the office moves them, the ticket's history records
  it, and the same notices go out.
- A technician-only login still goes to My tickets, not the board.
- The ticket page and the Tickets list, by the owner's choice.
- No database change.

## Limits

- On a narrow desk window (a mouse, under tablet width) the phone board shows, and a mouse cannot
  hold-and-drag there. Move in the details pop-up does the same job.
- The gestures were run in a desktop browser set up as an iPhone, with real touch events. They
  were not run on a real iPhone or Android phone from here.

## Proof

- New checks: `src/lib/board-phone-nov17.test.ts` (39): what each drop does, what is refused, when
  a held finger is a drag and when it is a scroll, the edge scrolling and its wait, the day
  counts, the words, the pop-up's address, Call and Directions rules, and that the screen is
  wired to them.
- Two older checks updated: the Prev / Next button's class, and the text-size list (two new sizes
  registered in `src/styles.css`).
- Browser, as an iPhone (390 × 664), every save blocked so no real ticket moved and nobody was
  notified:
  - the phone board shows, the week grid does not, no sideways scroll, nothing a thumb presses is
    under 44 px;
  - a tap opens the details; the address bar does not change; Open ticket, Move, Call and
    Directions are there; Move's Save is off until something changes;
  - a finger held 150 ms lifts nothing, held 500 ms lifts the ticket;
  - dragged onto another technician, the row lights and the save names that technician and day;
  - a swipe on a ticket scrolls the page, lifts nothing, saves nothing, opens nothing;
  - resting on Wednesday switches the board to Wednesday with the ticket still held, and the
    drop there saves Wednesday with that technician;
  - a drop on Thursday's button saves Thursday with the same technician;
  - a drop on the tray saves "no technician"; lifted out of the open tray, the tray folds and the
    drop on a technician saves that technician;
  - "A week later" saves the same weekday a week on;
  - held near the bottom of the list, the page scrolls; a cancelled touch saves nothing;
  - after each blocked save the ticket went back where it was, with a plain message.
- Desk (1500 px) and a tablet on its side: the week grid, unchanged. A tablet held upright: the
  phone board, clear of the menu.
- The ticket used was read back from the database afterwards, unchanged.
