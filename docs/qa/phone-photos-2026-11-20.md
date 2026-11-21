# Phone: the tags box when marking up, and pictures on any inspection row (Nov 20, 2026)

Owner, Nov 20:

1. "two things on mobile if youre marking it up, the tags pop up box is half off screen."
2. "also for the inspections we need to be able to add pictures even if the section is good and
   has a checkmark, it needs to be available via opening the camera or from camera roll just
   like the repairs are."

Tried on a temporary inspection ticket under the test customer, as the test login, in a phone
sized browser. The ticket, its pictures and their files were removed after.

## 1. The tags box

**What was wrong.** On the aerial ("the property from above"), a new tag opened a box 320 px
wide beside the tag. On a phone there is no room beside it: at 390 px wide the box reached from
153 to 473, so more than a third of it, with its Note box and its buttons, was off the side of
the screen. The text box had the same fault near the picture's right edge.

**What it does now, on a phone.** A new tag or text opens a sheet across the bottom of the
screen (`src/components/service/aerial-markup.tsx`), as the photo tool already did.

- It is the full width of the screen and never taller than 70% of it; a longer one scrolls
  inside.
- The picture is not dimmed. If the tag would sit under the sheet, the page moves up so the tag
  shows just above it.
- A tap on the picture moves the tag there and keeps what was typed. A tap anywhere else keeps a
  tag that has a label and drops one that has none, as before.
- The ready-made labels come first, each a 44 px button. A tag does not raise the keyboard by
  itself; the label box does when it is tapped. A text has to be typed, so its box takes the
  keyboard at once.
- When the keyboard is up the sheet sits on top of it and is no taller than what shows above it
  (`src/lib/keyboard-inset.ts`, `src/hooks/use-keyboard-inset.ts`). The photo tool's own sheet
  does the same now, and its buttons are 44 px too.

A computer is unchanged: the box beside the tag, the text box on the picture.

**Measured**, a tag placed at each corner, the middle and the left of the picture:

| Screen    | Box, left to right | Box, top to bottom | Off the screen | Covers the tag | Smallest button |
| --------- | ------------------ | ------------------ | -------------- | -------------- | --------------- |
| 320 x 568 | 0 to 320           | 266 to 568         | no             | no             | 44 px           |
| 375 x 667 | 0 to 375           | 365 to 667         | no             | no             | 44 px           |
| 390 x 844 | 0 to 390           | 542 to 844         | no             | no             | 44 px           |
| 414 x 896 | 0 to 414           | 594 to 896         | no             | no             | 44 px           |
| 390 x 500 | 0 to 390           | 198 to 500         | no             | no             | 44 px           |

With a keyboard 336 px tall (pretended in the test browser, the way an iPhone reports it) on a
390 x 844 screen: the aerial's sheet sat from 206 to 508 and the photo tool's from 212 to 508,
both whole above the keys; with the keyboard away both went back to the bottom edge.

Also tried: a ready-made label then a tap elsewhere on the picture (the tag moved, the sheet
stayed, the label was kept); Add tag (the tag joined the picture's list); Cancel; a text near
the right edge (the sheet, with the keyboard on its box). Save markup was never pressed.

## 2. Pictures on any checklist row

**What was wrong.** A row showed its pictures and its camera only while it was marked an issue.
A row that was good, N/A or not answered had no way to take one, and a picture put on such a row
from the ticket's Photos was not shown on the row at all.

**What it does now** (`ChecklistRows` in `src/components/service/inspection-section.tsx`).
Every row ends with a Pictures button: a camera, with the row's count once it has any.

- On a row that is not an issue it opens the same things an issue row has: **Photo** (the
  camera), **From my photos** (pictures already on the phone) and From ticket photos, with the
  row's thumbnails. These are the same two ways a repair has (Before, Before from my photos).
- No note is asked, and the row's answer is not touched: a good row stays good, an N/A row stays
  N/A, an unanswered row stays unanswered.
- A row that has pictures shows them without a press. A row with none stays one line.
- A picture is removed the same way as on an issue row: the × deletes it, Detach takes it off
  this row and leaves it on the ticket.
- N/A rows can have pictures too.
- The office's Inspection fold on the ticket page has the same button, with Add pictures and
  From ticket photos.
- Someone who cannot edit the ticket sees the button only on a row that has pictures.
- Nothing changed in how a picture is stored: the same upload, the same sizes, the same lock
  (a picture is refused once the ticket is past Done, as before).

**Tried on a phone** (390 x 844), on the temporary ticket:

| Step                                          | Result                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Seams ticked OK, Pictures pressed             | Photo, From my photos, From ticket photos; each 44 px; no note box |
| Photo (the camera input)                      | 1 picture on the row; the row still OK                             |
| From my photos (the camera roll input)        | 2 pictures on the row; the row still OK                            |
| Membrane condition, no answer: From my photos | 1 picture; the row still unanswered                                |
| Debris, N/A: From my photos                   | 1 picture; the row still N/A                                       |
| Detach one from Seams                         | 1 left on the row; the other stays on the ticket                   |
| Pictures pressed again                        | the row folds back to one line                                     |
| The page loaded again                         | the three rows show their pictures; a row with none is one line    |
| In the database                               | Seams OK, Debris N/A, every other row unanswered, no note anywhere |
| The ticket's stage                            | unchanged                                                          |
| The office's ticket page on a computer        | the same rows show their pictures, with Add pictures               |

**The row at phone widths**, with its fourth button, on the signed-in page:

| Screen | Page / screen | Buttons end at | A word cut in two | Rows with their buttons on a second line |
| ------ | ------------- | -------------- | ----------------- | ---------------------------------------- |
| 320    | 320 / 320     | 285.5          | none              | 10 of 10                                 |
| 340    | 340 / 340     | 305.5          | none              | 10 of 10                                 |
| 360    | 360 / 360     | 325.5          | none              | 6 of 10                                  |
| 375    | 375 / 375     | 340.5          | none              | 6 of 10                                  |
| 390    | 390 / 390     | 355.5          | none              | 0                                        |
| 393    | 393 / 393     | 358.5          | none              | 0                                        |
| 414    | 414 / 414     | 379.5          | none              | 0                                        |

To make room, a label may now narrow and break after its slash on any phone (it was under
390 px only), and the buttons drop to a line of their own under 390 px (it was under 350 px).
On a computer the row is as it was.

**Where a good row's pictures show.**

- On the row, in the technician's workflow and in the office's Inspection fold.
- In the ticket's Photos, as every ticket picture does.
- In the property's History pop-up, with the ticket's other pictures, and on the "Last time"
  line under the same row on the next ticket at the property.
- In a document: under the row when the Repair List is set to list every item, or when the
  row's own Checklist item is added. A Repair List that lists the issues only does not list a
  good row, so it does not print that row's pictures. The document generator was not changed.

## Tests

- `src/lib/inspection-row-photos-nov20.test.ts` (17): when a row's pictures show, the button on
  every row, a good, an N/A and an unanswered row, the two ways to add one, the press never
  touching the row's answer, the row's phone classes. On the code before: 13 fail.
- `src/components/service/markup-label-sheet-nov20.test.ts` (14): the keyboard rules, the spot
  kept clear, the aerial's sheet on a phone, the photo tool's sheet. On the code before it
  cannot run: the keyboard rules did not exist.
- `src/lib/roof-care-break-tickets-nov20.test.ts`: three lines updated for the row's new phone
  classes, with a dated note.
- The 36 test files that read these components: 766 pass.

## Not proven here

- A real phone. The keyboard was pretended in a test browser the way an iPhone reports it.
- The mark-up editor that opens on a fresh camera shot did not show the test picture in the test
  browser; the picture itself went up and landed on the row. That editor was not changed.
