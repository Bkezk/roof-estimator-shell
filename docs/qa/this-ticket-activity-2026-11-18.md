# This ticket's Activity entries, where a technician works the ticket

Nov 18, 2026. The owner asked, after technicians were moved into the workflow only: "but the
activity list and timeline are on the history when you click it no?"

## What was true

Checked against the live database function `site_history` and the screens.

| Question                                                      | Answer before this change                         |
| ------------------------------------------------------------- | ------------------------------------------------- |
| Earlier tickets at the property, in History                   | Yes. Each with its repairs, photos, closing notes |
| Their Activity entries ticked "Viewable to technicians"       | Yes, under each earlier ticket                    |
| The ticked entries of the ticket being worked                 | **No.** On no screen a technician has             |
| The stage steps of a ticket (who opened it, who scheduled it) | No. Never part of History                         |
| The Called / Texted / Emailed / Visited / Note buttons        | No. They are on the ticket page only              |

History lists **earlier** tickets (`j.id <> p_job_id`). The ticket in hand showed its own entries
on the ticket page only, and a technician-only login no longer opens that page. So a note the
office ticked for technicians on today's ticket, a gate code for one, was read by nobody until
the ticket itself became history. One open ticket on the live database had such an entry.

## What changed

A box, **Activity on this ticket**, lists the ticket's own entries that are ticked "Viewable to
technicians", newest first. It is drawn the same way as an earlier ticket's entries.

- At the top of the workflow, under the Special instructions.
- At the top of the History pop-up, under the Special instructions and above the earlier tickets.
  This is the pop-up the History line opens on My tickets and in the workflow.
- Nothing is drawn when the ticket has no ticked entry.
- The office sees the same box with one more line, saying these are the ticked entries.
- Not in the History fold on the ticket page. The whole Activity is already on that page.

The rule is `techVisibleEntries` in `src/lib/tech-visible.ts`. The box is
`src/components/service/ticket-shared-notes.tsx`. It reads the Activity's own list, so the
database decides what the reader may see, and a new entry shows without a reload of the page.

The hint beside the tick now says: "Shows to the technician working this ticket, and under
History at this property for technicians on later tickets here."

## Still not on a technician's screens

- The stage steps of the ticket.
- The buttons that add a Called / Texted / Emailed / Visited / Note entry. A technician writes
  in the workflow's own boxes.
- On the My tickets card the entries are behind the History line, which is left out on the first
  ticket at a property. The workflow shows them either way.

These wait for the owner's word.

## Proof

Tests: `src/components/service/ticket-shared-notes.test.tsx` (13). Older pins updated with a
dated note: `history-popup-nov17.test.ts`, `ticket-instructions-nov18.test.ts`.

Browser, local build against the live database, every write blocked. Two temporary tickets at
the test customer's property: an earlier closed one with a ticked note, and one for today with a
ticked note, a ticked call and an unticked note.

| Login                | Screen                    | Ticked note and call              | Unticked note | Earlier ticket's note |
| -------------------- | ------------------------- | --------------------------------- | ------------- | --------------------- |
| Technician only, 390 | Workflow                  | Shown                             | Not shown     | Not here              |
| Technician only, 390 | History pop-up, from card | Shown                             | Not shown     | Shown under #999001   |
| Technician only, 390 | History pop-up, workflow  | Shown                             | Not shown     | Shown under #999001   |
| Technician only, 390 | `/service?id=`            | Opens the workflow                |               |                       |
| Admin, 1500          | Workflow and pop-ups      | Shown, office line                | Not shown     | Shown in the pop-ups  |
| Admin, 1500          | Ticket page               | Whole Activity, as before. No box |               |                       |

In the pop-up the order from the top is: Special instructions, Activity on this ticket, earlier
tickets. No sideways scroll at 390. No page errors.

Removed after: both tickets, their four entries, their events and history rows. Ticket numbers
are back at 6075. No notices were written. The test login is an admin again.
