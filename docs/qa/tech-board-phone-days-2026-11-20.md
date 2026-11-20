# Tech Board on a phone: the week as day cards (Nov 20)

The owner: "on mobile on the tech board can we have the calendar be bigger and remove the list of
technicians so we can see the days better and since once we drag a job up the technician list
appears anyway?"

## What changed

| Before                                                       | Now                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| Seven small day buttons across the top                       | Seven full-width day cards, the day in full on each      |
| The page was a row per technician for one day                | No technician rows. A card lists every ticket of its day |
| With eight technicians, mostly "Nothing this day"            | An empty day is one short card                           |
| A ticket did not say whose it was (its row did)              | Each ticket on a day card carries the technician's name  |
| The technicians came up only for a ticket from Unassigned    | They come up for any held ticket                         |
| To change the day while holding, reach the top of the screen | The seven days are in the same block as the technicians  |

- Tap a day card to choose it. The chosen day is the one a ticket dropped on a technician goes
  to, and the block says it: "Drop on a technician · Sat, Nov 21".
- Hold a ticket that is already on a day of this week and that day is chosen by itself, so a
  drop on another technician keeps the day.
- Rest a held ticket on a day, in the block or on a card, and that day is chosen. Let go on a
  day and only the day changes.
- The + on a day card starts a new ticket on that day.
- The Unassigned tray, the two week targets, the details pop-up and its Move button are as they
  were. The tray now stays solid under a held ticket: before, the page showed through it.
- Every move is the same single write as before, with the same rules and notices.
- The desk grid is not changed.

Why the technicians can come up for every held ticket now: a ticket let go where it lifted is
put back (Nov 19), so the block opening under a still finger drops nothing.

## What was proven

Tests: `src/lib/board-phone-days-nov20.test.ts`, 12 tests. Ten of them fail on the code before
this change. Five older pins that described the rows, the small day buttons and the old one-line
hint were moved, each with a dated note.

In a browser, as the office, on an emulated iPhone 13 and on a 320 by 568 phone. Real tickets
were held and the finger was cancelled each time, never let go on a target. Nothing was written,
and the two tickets held were checked in the database afterwards: unchanged.

1. Seven day cards, no technician rows. Today's card was chosen.
2. A tap on another day chose it.
3. Holding the Unassigned ticket brought up all eight technicians, none cut off, with the seven
   days above them.
4. Carried over a technician, that target lit.
5. Rested on the block's sixth day: that day was chosen and the block's line named it.
6. With the finger cancelled the block went away and the ticket stayed in the tray.
7. Holding a ticket on Monday's card brought the block up with Monday chosen, "has it now" on
   its technician, and the two week targets.
8. No sideways scroll at either width. On the small phone all eight technicians fitted, two
   across. No page errors.

Not proven in a browser: a drop itself. A drop moves a ticket and tells real people. The drop
runs the same rule and the same write as before this change.
Not proven: a real phone in a hand.
