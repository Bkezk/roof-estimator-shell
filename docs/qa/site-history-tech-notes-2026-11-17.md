# History at this property: what the technician found and wrote

Date: Nov 17, 2026

The owner sent a picture of the history a technician-only login sees on a ticket: one earlier
inspection, shown as a date, a description and "Outcome: Repair ticket". His words: "its
honestly not very useful. what would be useful for the techs would be something that shows
history as far as the previous tickets tech notes and photos".

## What was wrong

- **That ticket:** it had no photo but the signature, no closing notes and no note on any
  checklist row. It did have two checklist rows flagged as issues. The row showed neither.
- **Flagged rows:** the database handed over what an inspection flagged, with each row's note.
  The screen used it only for the "Last time" line under a checklist item, never in the history.
- **Notes typed in Activity:** never handed over.
- **The inspection's own notes box:** never handed over.
- **An empty row:** said nothing, so it read as a page that had not loaded.

Photos were already complete: every photo of the earlier ticket, opened full size with a tap.

## What each earlier ticket shows now

1. The date, type, number, stage, technician and named site. Unchanged.
2. The description. Unchanged.
3. **Found on the inspection:** each flagged checklist row, with the technician's note on it.
4. **Inspection notes:** the inspection's own notes box.
5. Each repair with what was wrong and what was done. Unchanged.
6. **Closing notes.** It was labelled "Notes".
7. **Technician notes:** what a technician typed in that ticket's Activity, with who and when.
   A Note, or the words typed with Called, Texted, Emailed or Visited.
8. The inspection outcome. Unchanged.
9. Every photo. Unchanged.
10. When there is nothing written and no photo: "No notes were written and no photos were taken
    on this ticket."

## Whose notes

Only notes written by a technician: a person ticked Technician, the ticket's own technician, or
someone on its crew. An office person's note is not handed over. Since Nov 14 a technician reads
another ticket's notes only with that ticket, and an office note can be about money, so this
opens exactly what was asked for and no more. The lines the site writes by itself ("Date moved
from ...") and the close-out's own summary are left out as well.

No price, rate, invoice, hours or materials are in the history, as before. Who may open a
property's history is unchanged.

## Proof

- Database change `20261117170000_site_history_tech_notes.sql`, applied on the live database.
  Read back as a signed-in admin across the newest 25 tickets: the new keys are there, a
  manager's note on an earlier ticket is left out, the photos and repairs are as before.
- Checked on live rows which Activity entries the rule picks: technicians' typed notes only.
  Entries with no words, the site's own lines, the close-out summary and the office's notes are
  left out.
- New checks: `src/lib/site-history-tech-notes-nov17.test.ts` (7).
- Whole suite: 591 files, 8,332 tests pass. Lint, types and the build pass.
- Browser, 1500 px and 390 px, read only: the ticket in the owner's picture now lists the two
  flagged rows under "Found on the inspection". Another ticket's history shows its photo. No
  dollar sign on either, no sideways scroll.
- Not seen in the browser: a row with technician notes. No live ticket has both a technician's
  typed note and a later ticket at the same property yet. The checks above cover it.

Nothing in the data was changed.
