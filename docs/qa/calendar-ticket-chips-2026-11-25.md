# The calendar's ticket chips, Nov 25, 2026

The owner, Nov 25, of the Work Overview calendar: "why does ticket 6058 just show the number but
others show the customers and sometimes they show other things?" He was told why and given one
suggestion, and answered: "go on the calendar question solution".

## Why it looked that way

- A ticket's chip was its number and its description.
- A ticket with an empty description showed only its number.
- The others showed whatever had been typed in the description. Sometimes that is a customer's
  name, sometimes it is the work.
- An opportunity's chip is its title and a bid's chip is its name, which is why those read
  differently again.

## What changed

- **Every ticket's chip leads with the customer.** A ticket with no description is no longer a
  bare number.
- **The number follows when the day is wide enough.** On a normal screen a day is about a hundred
  pixels wide: with the number always there, one or two letters of the customer were left. So
  the customer gets the room, and the number sits beside it only when enough is left for both.
- **Nothing is lost.** Hovering over a chip says the customer, the number and the description.
  The day's own list, beside the calendar, shows each row in full as before.
- A ticket with no customer on it reads as before. Opportunities, bids and tasks are not changed.
- The List view is not changed.
- The rule is `calendarChip` in `src/lib/my-work.ts`.

## How it was proven

- **Tests:** `src/lib/work-calendar-chip-nov25.test.ts`, 9 tests. 8 fail on the code before this
  change. The ninth says the List row is the same as before, which it is.
- One older test pinned the chip's old markup and was updated with a dated note.
- **Full chain:** 687 test files, 10,600 tests, lint, types and build all pass.
- **The screen,** reading this November's real calendar and pressing nothing but the Calendar
  button, at three screen widths:
  - No ticket chip is a bare number, and none has an empty start. Ticket 6058 leads with its
    customer.
  - 1100 and 1440 pixels wide: the customer has the whole chip. The number is in the hover text.
  - 1920 pixels wide: the customer and the number are both shown.
  - No sideways scroll, no page errors.
- A first way of hiding the number, by letting the chip measure itself, made the whole calendar
  shrink on a wide screen. It was seen in the browser run, taken out, and a test now says it must
  not come back.
- Nothing in the database was read or written beyond what the page itself reads.

## Left with the owner

- Publishing. Until then the live calendar is as it was.
- Whether the number should instead always show, at the cost of the customer's letters.
