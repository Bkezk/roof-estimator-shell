# Service pages — behaviour check after the Nov 3 review batches (Nov 4, 2026)

Owner: "since we made some changes go ahead and go through the service pages and test whether
the behavior is as expected … be thorough dont assume and report back your findings."

How it was done: local dev build of main at 5da698e, Playwright, signed in as the test login
(an admin with the Technician tick). Real tickets were read only — every write from the
browser was refused unless it named one of two temporary tickets I created for the purpose
(#6056 repair, #6057 inspection, both at a real property so History had something to show).
The temporary tickets, their photos, signature, time, materials, invoice, notifications,
follow-ups and audit rows were removed afterwards; the ledger sums to the same total as before
(−51.332) and no audit row by the test login remains outside the temporary rows.

## Verified as expected

**Office pages (batch A)**
- Tickets list: 15 cards, city/state on each, one slim read (60 KB for the whole list).
- Tech Board: the "Finished, no technician" group shows the 6 finished tickets nobody owns;
  the temporary ticket sat in its technician's column.
- Invoices: the status chip, search and sort live in the URL
  (`?status=unpaid&sort=due:asc&q=…`), the row link carries them, the editor's "← Invoices"
  returns to the same filtered list, and Back from the editor keeps the chip and the search box.
  Due column reads "On receipt" on the open invoices; none is late today.
- Awaiting invoice: 3 rows, the tab badge says 3 (a count read, not the rows).
- Office ticket page: one bundle read on open (12.9 KB with every photo link signed inside
  it); the browser signs only the signature image itself (one call). County code read by id.
- History at this property: opens on click and on `?open=history`; the fold shows the earlier
  ticket with its photos; "Show all" is not offered under ten tickets (correct).
- Phone (iPhone 13 emulation): the Tickets list, Board, Invoices, Awaiting invoice, My tickets,
  the close-out and the office ticket page all lay out at 390 px — no page zooms out.
- Setup › Inspection checklist: the trash can asks "Remove 'Seams' from the checklist?"; Keep it
  leaves the list as it was with Save disabled; Remove takes the row off and enables Save.
- Inventory page: the stock table comes from the summed view (11 rows, same numbers as the ledger).

**The technician's close-out on #6056 (batches B and C)**
- My tickets: the card carries the history strip ("History here: 1 earlier ticket, last
  Oct 28 … 31 photos") with no extra read per card; clock buttons and Open ticket are
  finger-sized (46 px / 52 px).
- The close-out opens in ~3 s on the bundle; the seven step dots are 44 × 44 px.
- Who is here → "I'm alone" saved, Next step enabled, and it survived reopening.
- Before: a repair chip whose save was made to fail showed "Could not add the repair: No
  signal. Check your connection and try again." with a Try again button; Try again added the
  repair. "Before from my photos" opens the library picker (several pictures, no camera
  capture); the picture went up as the full file plus a 320 × 240 small copy, and the square
  showed the small copy after reload.
- The work: typed text saved; "After from my photos" the same as Before.
- Materials: "Nothing used on this ticket — next step" moved the close-out to Time and the mark
  landed on the ticket (`nothing_used_at`). Edit reopened the card with Undo. "Find any
  material" found the shop's cell; one tap on the source logged it and cleared the box; three
  quick + taps became ONE ledger write 3.5 s later (qty −0.003 box), with the count moving at
  once; "−" on my own entry took it back (the row was removed).
- Time: Add time → Add travel (1.25 h prefilled from the office → site estimate) → "Travel
  added".
- Notes: an autosave made to fail showed "Not saved — try again" (a 44 px button) and the toast
  "Your notes did not save. Check your signal: No signal. Check your connection and try
  again."; the retry saved. With the notes empty, "Skip — nothing to add, next step" moved to
  the signature and the mark landed on the ticket (`notes_skipped_at`).
- Signature: Signed by, the pad, Save → the PNG went up, "Signed Nov 4, 2:07 PM · Sign again".
- Complete → "Done — the office invoices and closes it", stage Done, completed_at set; the
  office page then showed the Work fold "Closed out Nov 4 · 1.25 h", the materials, the two
  photos as small copies.
- Audit log for the ticket: created, time entry, closing notes, "signed by", "signature — →
  signed; signed at", "stage 'scheduled' → 'done'; completed at". Nothing for the crew answer,
  the marks, the field status or the city copy (the Nov 3 quieting works).

**The inspection close-out on #6057**
- Four steps (Checklist, Additional findings, Time, Signature), 44 px dots.
- Checklist: Issue with a note, OK, N/A saved as you go ("1 issue · 8 OK · 1 N/A · saved Nov 4,
  2:15 PM by Claude"); the audit log reads "Ticket 6057 inspection checklist saved: 1 of 10
  items flagged" and `changes.inspection` holds that sentence, not the JSON.
- Findings: the note, Recommend repairs / new roof, Today, grades A–F, a photo roll; Next step
  enabled once something is written.
- Time added (0.75 h labor); Signature "Optional for an inspection — … Complete does not wait
  for it."; Complete without a signature → Done. The office page's Invoice card says "The
  inspection is done. Once it is reviewed and authorized, it is complete — nothing is invoiced."
- The History strip on My tickets summarised both temporary tickets ("2 earlier tickets …").

**The invoice on #6056**
- Stage picker → Authorized ("Stage: Authorized", the ticket re-read); the Invoice card then
  offered "Make the invoice"; the draft had the travel line ($68.75) and the material line
  (3 fasteners, cost + 75 %) — $69.23.
- Typing the description: one save, no list re-reads afterwards; typing the same text again
  saved nothing.
- Preview: opening it rendered once at once; the next edit rendered again 4.3 s after the save
  landed (the four-second wait).
- Finalise: "Finalise invoice #6056? The invoice is frozen at $69.23 and its PDF stored; the
  ticket moves to Invoiced." → "Send it now?" → Not now; the page showed Final with Download
  PDF / Send / Mark paid / Void; the ticket went to Invoiced; the Invoices list showed the row
  with Due "On receipt".
- Error wording: a missing ticket reads "Could not open the ticket: Ticket not found"; a
  material the shop does not stock reads "… is not on this screen" with Try again.

## Findings (nothing broke; these are what I would fix or decide)

1. **Three sets of buttons are under the 44 px finger size** the Nov 3 batch gave the dots,
   chips and links: the material row's + and − (39 px), "Nothing used on this ticket — next
   step" and "Skip — nothing to add, next step" (36 px tall), and the inspection checklist's
   OK / Issue / N/A (29 px tall). The checklist ones are the smallest and the most tapped.
2. **The "Nothing used" mark stays on the ticket after materials are logged.** The screen is
   right (the step summary says "1 item logged"), but `nothing_used_at` keeps its time. Logging
   a material should clear the mark, so a report never sees both.
3. **Old photos stay heavy in History.** Pictures from before Nov 3 have no small copy until
   someone who may edit that ticket opens its page; the History fold at the property of the Oct 28 inspection
   downloaded 30 full-size pictures (2016 px) for the Oct 28 inspection. A one-time backfill on
   the server would fix every old ticket at once.
4. **The Inventory page reads 708 KB of item numbers on every open** (admin-item-numbers).
   Outside the service review, noticed in passing; the same slimming the service lists got.
5. **Setup lists 11 checklist items, the phone asks 10.** "Recommend repairs" is deliberately
   the Findings switch, not a row (since Oct 12), but the Setup page still shows it as an
   item; a note there, or hiding it, would stop the two from being compared.
6. Small: the browser still signs the signature image itself (one call per ticket page);
   it could ride along in the bundle like the photos.

Not a bug: the one "Could not take back … No signal" toast in my run came from my own
write guard refusing the undo (its request names the ledger row, not the ticket); on the
office page, with the guard relaxed, the take-back went through.

## Still open from the Nov 3 review
The 17 bugs in §1 of `service-pages-review-2026-11-03` (fixes await the owner's go-ahead),
item 16 (smaller PDF photos — declined) and the "Not exported" chip (declined).

## The six findings, fixed (Nov 4, later the same day)

Owner: "go ahead and fix 1-6."

1. Finger sizes: the material row's − and + are 44 × 44 px (the count box, Remove and a search
   source 44 px tall), the two "next step" marks and their Undo 44 px, the inspection checklist's
   OK / Issue / N/A 44 px. Measured on the phone: the Done repair's + / − read 44 × 44.
2. A material logged clears the "Nothing used" mark: the close-out turns its own draft off
   (and saves) as soon as a material is on the ticket, and the server clears `nothing_used_at`
   on any consumed movement against a ticket (the office page's path too).
3. Setup carries a "Small copies for older pictures" card (managers and admins): it counts the
   pictures without a small copy (72 at the time of writing), makes them in the browser the way
   the phone does — each full picture downloaded once, shrunk to 320 px, uploaded beside it,
   recorded — and reports what could not be made. The full pictures are never changed. **The
   owner presses the button**: the check here could not run it against the real tickets.
4. The Inventory page reads the item-number keys as compact lines (`listItemNumberKeys`),
   not the full rows: the item numbers went from 475 KB to 84 KB. The page's other catalog read,
   the price targets list (267 KB), was left as it was.
5. Setup's checklist marks the "Recommend repairs" row "asked as the switch in Findings — not a
   row on the phone", and its description says why the phone shows one row fewer.
6. The ticket bundle signs the signature's link with the photos (`signature_url`); the screens
   use it while it names the row's path, else sign their own. The office ticket page now makes
   no signing call from the browser (measured: 0).

Tests: service-verification-fixes-nov4.test.ts (13; all fail on the code before). The
field-edit-lock test's fake learned `.not(col, "is", null)`; the quantity-box pin moved to 44 px.

## The Nov 3 review's bugs, fixed (Nov 4; owner: "fix the rest" — all but 6 and 7)

1. The office's ticket save re-leads the crew: every save goes through saveCrew; a manager's
   carries the form's crew and rates, anyone else's moves the lead row to the new technician
   (set_job_crew). The crew, is_on_crew and the invoice follow a reassignment.
2. Unticking the last helper saves the lead alone (the crew box pushes the empty list).
3. A timeline row goes in only from someone who works on that ticket (works_on_ticket) and only
   of the kinds the app writes; 20261104120000, applied live.
4. A phone draft typed against an older ticket is a choice: the server's text stays and a toast
   offers "Use mine" / "Keep theirs" (lib/draft-conflict.ts; the close-out's notes carry the
   ticket's updated_at, the checklist its saved_at). A draft against the current row restores as
   before.
5. Void says the ticket goes back to Authorized; Mark paid says the stage does not change.
8. The server refuses to void a paid invoice ("edit the payment first").
9. Recording and deleting a photo follow the field edit lock on the server (editableJob); the
   close-out's loose pictures get the X only while the ticket may be edited.
10. "Usual here" samples the newest 50 tickets.
11. The short-stock dialog says inventory keeps a note for the next count.
12. The pricing list saves in one transaction (save_service_materials, 20261104120000, applied
    live): the markup, the updates and the inserts land together or not at all.
13. The PDF preview redraws when the invoice's pictures change (the pane's version carries them).
14. Adding a line no longer leaves the editor "dirty" forever (the dirty key ignores `orig`).
15. A failed read of the ticket's stage is an error, not a blind stage write.
16. The server refuses Invoiced / Closed on an inspection ("An inspection ends at Authorized").
17. The long-press flag lets go after 600 ms; a time row takes a background re-read unless it is
    being edited.

Not done, by the owner's choice: 6 (the Sage export stamps invoices before the file exists) and
7 (vendor-billed invoices export with a blank Sage customer id).

Tests: service-review-bugs-nov4.test.ts (19; 16 fail on the code before — the three pure
draftConflict / constant tests pass either way). Older pins moved (ownJob → editableJob,
prev?.stage → prev.stage, the PreviewPane line, the saveCrew line, the TicketExtras X).
