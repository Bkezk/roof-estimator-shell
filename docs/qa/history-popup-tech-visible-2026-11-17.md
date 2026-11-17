# History at this property: a short list, a pop-up per ticket, and "Viewable to technicians"

Date: Nov 17, 2026

The owner, with a picture of a short history row: "when the tech clicks history at this
property i just want them to see this and then they can click the ticket and itll pop up its
photos and notes from the tickets and on the activity log have a check box that says viewable
to technicians and anything with that check box should also show".

An earlier attempt the same day put everything into the list itself. The owner had it undone
("thats not exactly what i wanted"). This is the version he described.

## The list

One short row per earlier ticket at the property:

- the date, type, ticket number, stage, technician and named site
- the description
- what an inspection flagged, by name
- the outcome
- what waits behind it: "2 photos · notes", "1 photo", "notes", or "no photos or notes"

No photos and no notes in the row itself. The whole row is the button.

## The pop-up

A tap on a row opens that ticket's pop-up:

- **Photos:** every photo. A tap opens it full size, with arrows between that ticket's photos.
- **Special instructions:** the ticket's own box.
- **Found on the inspection:** each flagged row with the note typed on it.
- **Inspection notes:** the inspection's own notes box.
- **Repairs:** what was wrong and what was done.
- **Closing notes.**
- **From the ticket's activity:** the entries ticked "Viewable to technicians".
- **Outcome.**
- When there is nothing: "No photos were taken and no notes were written on this ticket."

"Open the ticket" shows only for someone who can open it. A technician-only login never sees
it. No price, rate, invoice, hours or materials are in the pop-up.

## The checkbox

An entry a person makes in a ticket's Activity (a Note, or Called, Texted, Emailed, Visited)
carries a tick: "Viewable to technicians".

- **When writing:** the office sees the checkbox under the note box. It starts unticked.
- **Afterwards:** each such entry in the Activity list has the checkbox, so a tick can be added
  or taken off later.
- **Who chooses:** an admin, a manager, or a Service user who is not technician-only. The
  database refuses anyone else.
- **Technicians:** a technician-only login is shown no checkbox. What a technician writes is for
  technicians, so it is always ticked.
- **Nothing already written is ticked.** Every existing entry is as private as it was.
- **Not tickable:** the lines the site writes itself and the close-out's own summary.

The tick decides what shows in the history pop-up. On the ticket itself the Activity is
unchanged: whoever could read it before still reads all of it.

## Proof

- Database change `20261117190000_history_popup_tech_visible.sql`, applied on the live database.
  A trial that was rolled back: the history handed over 0 shared entries, then 1 after the tick;
  the close-out summary could not be ticked; a technician-only login was refused; a call with
  no sign-in was refused.
- New checks: `src/lib/history-popup-nov17.test.ts` (21). Two older checks were updated with a
  dated note each.
- Whole suite: 591 files, 8,345 tests pass. Lint, types and the build pass.
- Browser, 1500 px and 390 px, read only:
  - the list shows short rows with no photos in them, and the hint "1 photo · notes";
  - a tap opens the pop-up with the photo, the special instructions and the repair;
  - a tap on the photo opens the viewer, Escape returns to the pop-up, Close closes it;
  - the pop-up fits the phone, with no sideways scroll and no dollar sign;
  - the Activity shows the checkbox on the one person-made entry and under the note box,
    unticked. Nothing was ticked or saved.
- Not seen in the browser: an entry showing in the pop-up after a tick. Ticking a real entry
  would have changed a real ticket. The rolled-back trial above covers it.

Nothing in the data was changed.
