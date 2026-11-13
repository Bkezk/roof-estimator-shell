# Tech Board: Urgent and Emergency tickets stand out and go first (Nov 13, 2026)

Owner: "can we have the labor rate reflected on the tech board tiles like if a service is urgent
or emergancy it has some sort of indicator on that tile and its sorted by most urgent to least
urgent and subsorted by date".

## Before

- The rate was a plain word in the middle of a tile's third line ("Repair · Urgent · Morning 8–10").
- A technician's day was ordered by ticket number.
- The Unassigned list was ordered by day alone, so an Emergency for next week sat under a
  Standard ticket due today.

## Now

- An Emergency ticket wears a red **EMERGENCY** badge with a siren icon and a red stripe down the
  tile's left edge. An Urgent ticket wears a yellow **URGENT** badge with a warning triangle and a
  yellow stripe. Standard tickets look as they did. Red and yellow are used by no stage colour.
- The tile's third line no longer repeats the rate. The hover text still spells it out.
- A technician's day: Emergency, then Urgent, then the rest. Ticket number within each.
- The Unassigned list: Emergency, then Urgent, then the rest. Within each, by day as before:
  overdue, today, the coming days, undated last, oldest opened first within a day.
- A line under the colour legend shows both badges and says "go first, then by day."
- "Finished, no technician" keeps its own order, the longest waiting first. That work is done, so
  the rate no longer says who to send first. Its tiles still wear the badge.
- A blank or unknown rate counts as Standard, so an odd row never jumps the queue.

No database change. The rate is the one a manager already picks on the ticket ("Labor rate").

## Files

- `src/lib/rate-urgency.ts` (new): `urgentRate`, `rateRank`, `sortCell`.
- `src/lib/service-schedule.ts`: `sortUnassigned` puts the rate ahead of the day.
- `src/lib/board-chip.ts`: `chipBadge`; `chipFacts(j, { rate: false })` for the tile.
- `src/lib/stage-colors.ts`: `RATE_TONES` (badge and stripe).
- `src/components/service/board-page.tsx`: the badge, the stripe, the legend line, the cell order.

## Proof

- `src/lib/tech-board-urgency-nov13i.test.ts`: 14 tests. With the four wiring files put back to
  the old code, 7 fail (the badge, the facts line, the rail order, the page wiring).
- Older pins updated for the new facts call: `board-chip.test.ts`, `arrival-window.test.ts`.
- Full chain: prettier, eslint (0 errors, the 16 known warnings), types, 546 files / 7,136 tests,
  build.
- Browser, signed in as the test login, on eight temporary tickets made by SQL with numbers
  999901 to 999908 so the ticket counter was not used:
  - One technician's Friday held Standard #999901, Urgent #999902 and Emergency #999903. The cell
    read 999903, 999902, 999901.
  - The Unassigned list read: Emergency due today, Emergency with no date, Urgent due next week,
    then Standard overdue, then the office's own Standard tickets in their old day order.
  - Eight badges on screen: six tiles (three Emergency, three Urgent, one of them an en-route
    Urgent tile on Thursday) and the two in the legend.
  - Light and dark looked right. At a 1100 px window the badge stayed inside its 118 px cell. At
    phone width the page did not scroll sideways.
- Cleanup: the eight tickets, their stage events and their history lines were removed. The ticket
  counter still reads 6073, the highest real ticket. Nothing named "ZZ" is left.

## Left alone

- My tickets (the technician's phone list) and the Tickets list are unchanged. They do not show
  the rate today.

## Later the same day: every second technician row is shaded

Owner: "on the tech board can you have every other technician row be slightly darker to
diffrientiate them a bit more".

- The second, fourth, sixth technician's row is one shade off the page: the name cell and all
  seven day cells. The first row is plain. The "Others" group alternates from its own first row.
- Today's column keeps its tint on both kinds of row, a step darker on a shaded one.
- The cell a ticket is dragged over still shows its blue ring over everything.
- The name cell stays a solid fill, because tickets scroll under it on a narrow screen.

Files: `src/lib/board-rows.ts` (new: `shadedRow`, `rowHeaderTone`, `cellTone`),
`src/components/service/board-page.tsx`.

Proof: `src/lib/board-row-shading-nov13k.test.ts`, 7 tests, 2 fail with the page put back to the
old code. Full chain clean: 548 files / 7,153 tests, build. Browser, read only: the seven
technician rows read plain, shaded, plain, shaded, plain, shaded, plain, in light and in dark.
