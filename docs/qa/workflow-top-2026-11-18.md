# A shorter top for the ticket workflow

Nov 18, 2026. The owner sent a picture of the top of the workflow on ticket #6070 and asked:
"this is a bit busy any way to make it cleaner? especially if there is a lot of special
instructions or activities?" He was shown three layouts and chose **Short, tap for more**.

## What changed

Top to bottom, the workflow now opens with:

| Part                    | Before                                        | Now                                                  |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Description             | Whole, however long                           | Two lines, then **Show all**                         |
| Special instructions    | Whole, however long                           | Three lines, then **Show all**. Still in view        |
| History                 | A sentence of two lines above the description | One row: "History · 2 earlier tickets · last Nov 25" |
| Activity on this ticket | A box listing every ticked entry              | One row: "Activity · 3 · Braden: gate code is 4471"  |

- A text that fits is shown whole, with no button. **Show all** opens the rest in place and
  **Show less** closes it.
- The History row opens the same pop-up as before. The pop-up shows the whole instructions,
  every ticked entry of this ticket and the earlier tickets.
- The Activity row opens its list under itself. More than six entries scroll inside the list's
  own box.
- The order changed: the instructions come before the two rows, so they are read first.
- The My tickets card is unchanged. Its history line keeps the full sentence.

## Two faults found on the way, both fixed

1. **Scroll arrows beside a single Activity entry.** They are in the owner's picture. A list of
   one entry was a fraction of a pixel taller than its box at the larger text size. A short list
   is now given no scroll box at all.
2. **The step bar on a phone.** Seven dots fill a phone's row. "Step 1 of 7 · Who is here" was
   squeezed to one letter, "S", and the chevron dropped to a line of its own. On a narrow phone
   the last dot ran off the edge. The words and the chevron now take the line above the dots, and
   the dots share the row. From a small tablet up it is one line, as before.

## Where

- `src/components/service/clamped-text.tsx`: `ClampedText` and `PeekRow`.
- `src/components/service/special-instructions.tsx`: `clampLines`.
- `src/components/service/ticket-shared-notes.tsx`: `compact`.
- `src/components/service/site-history.tsx`: `HistoryLink compact`.
- `src/lib/service-history.ts`: `historyShort`. `src/lib/tech-visible.ts`: `activityPeek`.
- `src/components/service/closeout.tsx`: the header and the step bar.

## Proof

Tests: `src/components/service/closeout-top-nov18.test.tsx` (19). Older pins updated with a
dated note in six files.

Browser, local build against the live database, every write blocked, as a technician-only login.
Three temporary tickets at the test customer: one with a long description, eight lines of
instructions, eight ticked entries and one unticked; one with a short everything; one earlier
ticket for the history.

| Check                                             | 390 wide                                        | 745 wide                |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------- |
| Long ticket: description and instructions cut     | Yes, each with Show all                         | Yes, each with Show all |
| Show all, then Show less, on the instructions     | 8 lines, back to 3                              | 8 lines, back to 3      |
| Activity row words                                | "8 · TEMP: … entry 8…"                          | The same                |
| Activity opened: entries, scrolls in its own box  | 8, yes                                          | 8, yes                  |
| History row, then its pop-up                      | Whole instructions, 8 entries, 1 earlier ticket | The same                |
| Unticked entry                                    | Not shown                                       | Not shown               |
| Short ticket: any Show all button, any scroll box | None                                            | None                    |
| Where the first step starts, long ticket          | 418 px down                                     | 425 px down             |
| Sideways scroll                                   | None                                            | None                    |

The step bar was measured at 320, 360, 390 and 745 wide: the words are whole and the dots stay
inside the bar at every width.

Removed after: the three tickets, their entries, events and history rows. Ticket numbers are back
at 6075. No notices were written. The test login is an admin again.
