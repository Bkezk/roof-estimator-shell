# Tech Board on a phone: moving a ticket by taps (Nov 20, 2026)

Owner, Nov 20: "im still not thrilled with the tech board on mobile it seems difficult to
reassign or move tickets when theyre already on the board, i really need that to be a user
friendly as possible."

## What made it hard

Measured on the real page with a phone-sized touch screen (390 by 664), signed in as a person
who may move tickets, on ten temporary tickets that were removed afterwards. Eight technicians
were on the roster.

1. **Hold and drag takes aim.** A ticket lifts after a third of a second. The block of
   technicians then covers the lower two thirds of the screen (from 217 of 664 down), and only
   two day cards stay in view above it. The technician targets are 48 high and the day targets
   in the block are 49 by 44, under the finger that is choosing them.
2. **The finger hid what it was choosing.** The lifted ticket's label sat on top of the name of
   the target above the finger, and said only the ticket's number and customer.
3. **The other way was five or six presses.** Tap the ticket, press Move, open a drop-down list
   of nine names, pick one, close the list, press Save move. A day in another week went through
   the phone's own calendar.
4. **Nothing said what Save move would do.** The button read "Save move" whatever was picked.

## What it is now

A tap on a ticket opens it with **Move or reassign** at the top, already open.

- **Day**: the week's seven days as buttons, the ticket's own day marked. An arrow at each end
  goes a week back or forward. The date box between the arrows takes any date, and brings that
  week to the buttons.
- **Technician**: every technician as a button, and Nobody. The one who has the ticket says "has
  it now". The others say how many tickets they have that day ("free", "2 tickets").
- **The bar at the bottom** never scrolls away. With nothing picked it holds Open ticket, Call
  and Directions. Once something is picked it is one button that says what it will do, and Put
  back beside it:

  | Picked                         | The button says                                    |
  | ------------------------------ | -------------------------------------------------- |
  | Another technician             | Give to Brian Folden / Same day: Fri, Nov 20       |
  | Another day                    | Move to Wed, Nov 18 / Stays with Claude            |
  | Both                           | Give to Brian Folden / Moves to Wed, Nov 18        |
  | Nobody                         | Take it off Claude / Unassigned, still Fri, Nov 20 |
  | A day, on a ticket with nobody | Move to Thu, Nov 19 / Nobody assigned yet          |

- The address, the description, the special instructions and the contact follow under it.
- A ticket that is Done or later has no choices and says it stays where it is. A person who may
  not move tickets gets the details and the three actions, and no choices.
- The save is the same single write as before, with the same notices and the same line once it
  is saved ("Ticket #6071: Garry Peters, Tue, Nov 17.").

Hold and drag is kept. The lifted ticket now says what letting go will do, in the same words as
the button ("Give to Brian Folden / Same day: Fri, Nov 20"), or "Let go to put it back" where
letting go changes nothing. Its label stays on the screen at either edge.

## Presses, before and after

| The job                          | Before                                                         | After                                     |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Give it to another technician    | 5 or 6: ticket, Move, the list, the name, (Done), Save move    | 3: ticket, the technician, the button     |
| Move it to another day this week | 4: ticket, Move, the day, Save move                            | 3: ticket, the day, the button            |
| Move it to next week             | 6 or more: ticket, Move, the date box, the calendar, Save move | 4: ticket, the arrow, the day, the button |

## Proof

- Tests: `src/lib/board-phone-move-nov20.test.ts` (25). On the code before this change 24 of them
  fail; the one that holds on both says the hold time was left alone. Five older checks were
  brought up to date with a dated note (`board-phone-nov17`, `board-dock-nov19`,
  `board-phone-days-nov20`).
- On the page, phone size 390 by 664:

  | Check                                                     | Result                                                                              |
  | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
  | Tap a ticket                                              | Choices open; no Move button, no drop-down list                                     |
  | Days on the screen without scrolling                      | 7 of 7, each 50 by 48                                                               |
  | Technicians on the screen without scrolling               | 9 of 9 (eight and Nobody), each 182 by 46                                           |
  | The ticket's own day and technician                       | Marked                                                                              |
  | Tap a technician                                          | Button: "Give to Brian Folden / Same day: Fri, Nov 20"                              |
  | Tap the button                                            | Sent: the ticket, that technician, Nov 20                                           |
  | Tap a day, tap the button                                 | Sent: the ticket, the same technician, Nov 18; the ticket shows on Wednesday's card |
  | The arrow, a day of next week, the button                 | Sent: Nov 24                                                                        |
  | Dec 17 typed in the date box                              | The buttons show Dec 14 to 20, Thursday pressed                                     |
  | Put back                                                  | The bar returns to Open ticket, Call, Directions                                    |
  | A Done ticket                                             | No choices; "stays where it is"                                                     |
  | A ticket from the Unassigned tray                         | The same three taps                                                                 |
  | Hold and drag over a technician, a day, the tray, nothing | The label says each in words, inside the screen                                     |

- At 320 by 568: no sideways scroll, nothing past the edge, nothing under 44 high, all seven days
  and six of the nine technician buttons in view before scrolling, the button's words not cut.
- No move was sent to the database in any of this. Each save was caught in the browser and its
  contents read, because a real move tells the office. The write itself is the one the board has
  always made and has its own tests.

Not tried: a real phone in the hand.
