# History at this property: a timeline, the ticket's photos, and "Viewable to technicians"

Date: Nov 17, 2026

How the owner settled it, in his words and in order:

1. "its honestly not very useful. what would be useful for the techs would be something that
   shows history as far as the previous tickets tech notes and photos"
2. "when the tech clicks history at this property i just want them to see this and then they
   can click the ticket and itll pop up its photos and notes from the tickets and on the
   activity log have a check box that says viewable to technicians and anything with that check
   box should also show"
3. Of a pop-up that showed the earlier ticket whole: "again i dont really want them to see the
   whole ticket just the history at this property and the activities that are check viewable to
   the techs in a timeline like setup"
4. Asked which layout: "i like the timeline but id like to be able to click the ticket to see
   the photos". Asked what else to show: photos, the inspection's findings, the repairs and
   closing notes.

Two earlier attempts the same day were wrong: the first put everything in the list and was
undone; the second put the whole earlier ticket, its Special instructions included, in a
pop-up. This is the third and matches points 3 and 4.

## The timeline

History at this property is one timeline, a line down the left with a dot per earlier ticket,
newest first. Each ticket shows, always in view:

- its line: the date, type, ticket number, stage, technician and named site
- the description
- **Found on the inspection:** each flagged row, with the note typed on it, and the outcome
- **Inspection notes:** the inspection's own notes box
- **Repairs:** what was wrong and what was done
- **Closing notes**
- under those, the Activity entries ticked "Viewable to technicians", drawn the way the
  ticket's own Activity draws them: the icon, "Note" or "Called", when, who, and the words

Not shown: the earlier ticket's Special instructions, its other Activity entries, and anything
about money, hours or materials. The database no longer hands the Special instructions over.

## The photos

The ticket's line is a button. It says how many photos are behind it ("3 photos", "no photos").
A tap opens a pop-up with that ticket's photos and nothing else. A tap on a photo opens it full
size, with arrows between that ticket's photos. With no photo the pop-up says "No photos were
taken on this ticket."

"Open the ticket" is in the pop-up only for someone who can open it. A technician-only login
never sees it.

## The checkbox

An entry a person makes in a ticket's Activity (a Note, or Called, Texted, Emailed, Visited)
carries a tick: "Viewable to technicians".

- **When writing:** the office sees the checkbox under the note box. It starts unticked.
- **Afterwards:** each such entry in the Activity list has the checkbox, so a tick can be added
  or taken off later.
- **Who chooses:** an admin, a manager, or a Service user who is not technician-only. The
  database refuses anyone else.
- **Technicians:** a technician-only login is shown no checkbox. What a technician writes is
  always ticked.
- **Nothing already written is ticked.**
- **Not tickable:** the lines the site writes itself and the close-out's own summary.

The tick decides what shows in the history. On the ticket itself the Activity is unchanged.

## Proof

- Database changes, both applied on the live database:
  `20261117190000_history_popup_tech_visible.sql` (the tick, its setter, the history hand-over)
  and `20261117210000_history_timeline_no_special_instructions.sql` (the Special instructions
  are no longer handed over).
- A trial that was rolled back: the history handed over 0 shared entries, then 1 after the
  tick; the close-out summary could not be ticked; a technician-only login was refused; a call
  with no sign-in was refused.
- Checks: `src/lib/history-popup-nov17.test.ts` (24).
- Whole suite: 591 files, 8,348 tests pass. Lint, types and the build pass.
- Browser, 1500 px and 390 px, read only, on two tickets:
  - one timeline, two tickets on it, no photos in the timeline itself;
  - a repair shows its repair, what was wrong and what was done; an inspection shows what it
    flagged and its outcome; neither says "Special instructions"; no dollar sign;
  - the ticket's line says "1 photo" or "no photos"; a tap opens the pop-up with the photo and
    no notes or repairs in it;
  - a tap on the photo opens the viewer, Escape returns to the pop-up, Close closes it;
  - no sideways scroll on the phone.
- Not seen in the browser: a ticked entry on the timeline. Ticking a real entry would have
  changed a real ticket. The rolled-back trial and the checks cover it.

Nothing in the data was changed.
