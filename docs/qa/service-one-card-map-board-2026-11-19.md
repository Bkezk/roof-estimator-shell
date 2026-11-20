# Service: one card at a time, the map opens close by, assigning on a phone (Nov 19, 2026)

Three requests from the owner, each with a picture from his phone. Checked on the current code
with a local server, the test login, and four temporary tickets (#999001 to #999004) on the test
customer's two properties. Every temporary row is gone again (the proof is at the end).

## 1. The ticket workflow shows one card

> "let's keep the numbers and the dropdown that shows you each step but let's only show the card
> we are currently on rather than all steps minimized in the list except for the one your on, this
> changes it from a scroll down workflow to a scroll left to right maximizing the viewing window"

**Before.** Every step was in the page at once: locked steps as one muted line each, done steps
folded to a summary with Edit, the step being worked open. On a phone the page was a long list.

**Now.** The page holds one card: the step being worked. The numbers and the step list (the
arrow beside them) are unchanged and are how to reach another step.

- A tap on a done number (or its line in the list) shows that step whole, with a
  **Back to step N** button. The number wears a ring while its card is on the screen.
- A locked number does nothing, as before. What unlocks it is on the number and in the list.
- **Next step** and the bar's **Finish step N** show the next card.
- The one-line summary a folded step used to show ("2 repairs, 2 Before photos") is now under
  each done step in the step list.
- The step being worked stays in the page, hidden, while a done step is looked at. Anything half
  typed on it is still there on the way back.
- The pinned bar (Complete, Care Plan, Additional Services) is outside the cards and shows on
  every step.

Rules: `src/components/service/one-card.ts`. Screen: `closeout.tsx`.

**Browser, 390 wide and 1300 wide, an inspection and a repair ticket.** One card in the page at
every point. Inspection walked forward: Checklist saved, Next, Additional findings, Nothing to
add, Next, Time. Tapping number 1 showed the Checklist with "Back to step 3" and Time hidden in
the page; picking line 2 of the list showed Additional findings and closed the list; Back
returned to Time; the bar's Finish step, pressed from a picked card, returned to Time. A locked
number changed nothing. No page errors. Page height on the phone went from a long list to one
card (1,312 px with the ten-row checklist open, 844 px on a short step).

### Found on the way: a reopened inspection landed on step 1

An inspection whose checklist was already saved reopened on Checklist, with Time (where the work
had reached) two presses of Next away. With every card in the page that was a short scroll; with
one card it hid the place the technician had reached.

Cause: the read of the checklist answered one drawing before the page learned the server already
held a saved checklist, and the workflow chose its opening step in that drawing.
Fix: the checklist reports "still loading" until it has taken the read in
(`inspection-draft.ts`). Three reopenings in a row then landed on Time.

## 2. "Pick the building" opens close to the address

> "if the location can't be located at a map and you try to attach it to yourself have the map
> try its best to get close to the location when it brings the map up instead of just showing tn
> and Ky in its entirety"

**Before.** An address on none of our maps gave the picker nothing to open on, so it showed both
states.

**Now.**

1. The ticket's read also looks up the middle of the address's zip code, and if that has no
   answer, of its town (the same public lookup the Roof Care price uses). Each lookup gets three
   seconds, because a technician is waiting. A lookup that is down changes nothing: the map opens
   on the state, as before.
2. The map opens over that town, zoomed so the streets read, and drops **no pin**: a pin would
   point at a building that is not the one.
3. The pop-up says so: "The address is not on our maps, so the map opened over Corbin, KY 40701.
   Find the building, or tap the location button if you are standing on it."
4. A **location button** sits under the zoom buttons. A technician picking the building is
   usually standing on it. The phone is asked for its place only when the button is tapped.

The town comes from the address that was looked for (a ticket can carry its own), then from the
property's City, State and Zip boxes.

**Browser, phone width.** A temporary ticket with a made-up street in Corbin, KY 40701: the
answer carried the rough point and "Corbin, KY 40701"; the picker opened over Corbin (scale bar
1,000 ft where it used to show two states), no pin, with the sentence above. The location button,
given a test position, moved the map there (scale bar 50 ft) and showed the blue dot.

**Not covered.** A property with no address, no town and no zip code (the test customer's second
property is one) still opens on both states: there is nothing to look up. The location button is
the way in for those.

## 3. Assigning on the phone Tech Board

> "assigning service to the tech via the tech board on mobile isnt great think of ways to improve
> it to drag and drop assigning better"

**What was wrong, measured.** On a 390 x 844 phone, three of the eight technicians fit between
the day buttons and the Unassigned tray (one of eight on a 360 x 640 phone). A ticket bound for
anyone further down had to be held at the bottom edge of the list until the page crept to them.

**Built: the technicians come to the finger.** While a ticket from the Unassigned tray is held,
every technician is a small target in a block that hangs on the tray's top edge:

- "Drop on a technician · Thu, Nov 19", then every technician, two across (three across when two
  do not fit), each 48 pixels high, with "free", "2 tickets" or "has it now" under the name.
- On a short phone the page scrolls its own heading away as the ticket lifts, to make the room.
- The target lights under the finger. A finger let go between two technicians drops on nothing.
- A drop is the same single write as every other move on the board (same rules, same history,
  same notices). Nothing new writes.
- Everything that worked before still does: the technician rows, the day buttons (rest on one to
  switch day), the tray (drop to unassign), a week earlier or later, the tap for details and its
  Move.

A ticket lifted from a technician's own row does not get the block: it would open under the
finger. That ticket keeps the rows, as before.

**Also fixed: a ticket let go where it lifted goes back.** Lifting a ticket out of the open tray
folds the tray, which uncovered a technician's row under the still finger. Letting go without
moving dropped the ticket on that technician. Now a ticket has to be carried (more than a
thumb's wobble) for the drop to count.

**Browser, a real finger hold and drag, 390 x 844 and 360 x 640.** Every write was stopped inside
the browser, so no ticket moved and nobody was told anything.

| Check                                                 | 390 x 844 | 360 x 640               |
| ----------------------------------------------------- | --------- | ----------------------- |
| Technicians on the screen before the hold             | 3 of 8    | 1 of 8                  |
| Technicians on the screen in the block while held     | 8 of 8    | 8 of 8                  |
| Across                                                | 2         | 2                       |
| Finger travel to the last technician (Tyler Mitchell) | 212 px    | 194 px                  |
| Page scrolled to get there                            | 0         | 105 (once, at the lift) |
| Target lit under the finger                           | yes       | yes                     |
| Between two targets: anything lit, tray lit           | no, no    | no, no                  |
| Let go on the technician: writes the browser tried    | 1         | 1                       |
| Held and let go on the block's own line: writes       | 0         | 0                       |
| A tap still opens the details                         | yes       | yes                     |

The one write it tried was the board's own assign call with the ticket, Tyler Mitchell and the
day on the board. From the open tray: held and let go without moving, 0 writes and no details
pop-up; carried to Mark Barger, 1 write, to Mark Barger. A ticket held in a technician's row: no
block, the week targets as before, let go without moving, 0 writes.

**Other ways considered, not built.**

- An Assign button on each ticket that opens a list of technicians to tap. No dragging at all.
  The details pop-up's Move already does this in more taps; it could be made one tap per
  technician.
- Tap a ticket to pick it up, then tap a technician. Works without holding, but adds a mode the
  screen has to explain.
- The same block for a ticket that already has a technician (a reassign), opened where the
  finger is not.
- A shorter hold before the ticket lifts (it is about a third of a second). Shorter starts to
  fight with scrolling.

## Tests

- `src/components/service/one-card-nov19.test.tsx` (17): the rules, the card and the numbers as
  drawn, the form, the reopened inspection.
- `src/lib/aerial-rough-near-nov19.test.ts` (17): the lookup, the ticket's read, the map's move,
  the picker.
- `src/lib/board-dock-nov19.test.ts` (22): which ticket gets the block, its targets, its size,
  the put-back rule, the unchanged write.
- Older pins updated with a dated note where the rule changed (five files): the done step's Edit
  toggle and the locked line are gone; the strip takes two more props; an ambiguous address now
  also asks the town lookup.

75 test files that touch these screens, 1,478 tests, pass. Lint and the type check are clean.

## Left as found

- Temporary tickets #999001 to #999004, their history rows and the four audit rows their removal
  wrote: removed. No files were stored.
- Tickets 55, notifications 256, the ticket number counter at 6075: all as before.
- The test login is an admin with the technician tick and no extra access, as before.
- Nothing was pressed that creates a ticket or moves one.

Nov 20: the phone board is day cards now, and the technicians come up for any held ticket. See
`docs/qa/tech-board-phone-days-2026-11-20.md`.
