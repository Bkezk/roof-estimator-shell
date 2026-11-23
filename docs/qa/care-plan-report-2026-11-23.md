# The Care plan report: what was built and how it was proven (Nov 23, 2026)

The owner, Nov 23: "we should also be able to add pictures to checked marked good items since we
can then use that to generate the care plan reports". Offered a second report that starts with
every row and its pictures, he answered: "1. add a care plan report".

## What it is

A second one-press report on an inspection ticket. It lists every row of the checklist, the
rows found OK included, each with its result, its note and its pictures. The Inspection report
lists only the issues, and it is unchanged.

## Where the button is, and who sees it

On the ticket page, the Documents button in the header opens "Documents · Ticket #N". On an
inspection ticket that box now has two buttons side by side: **Inspection report** and **Care
plan report**. That box is the only place the Inspection report is offered, so it is the only
place the new one is. Any inspection ticket has it, a Roof Care plan's or not.

The same people see both: whoever may open a ticket's documents. A person who is only a
technician has no Documents button and sees neither.

One press makes the report from the shipped "Care plan report" template and opens it in the
editor, where the office can still change, move or remove anything, then Export PDF, Share link
or Email as with any document. Nothing is made, sent or attached without the press.

## What the report holds, top to bottom

1. The letterhead.
2. The property's name, "Roof Care Plan Report", and on a plan's inspection two lines: the plan
   and which inspection of the year it was ("Roof Care plan, inspection 1 of 2"; a storm
   inspection and one owed from last plan year say so), and the cleaning the plan includes at
   that inspection with its answer ("Drains and scuppers cleaned: Yes · Gutters cleaned: No:
   needs a lift"). A ticket that is not a plan's inspection has neither line. Roof Watch and a
   storm inspection have no cleaning line, because none is asked of them.
3. The property's picture.
4. Customer, Property Inspected, Inspected By, Summary ("1 issue · 8 OK · 1 N/A"), and
   "Property Grade: B" when the inspection has a grade (no line at all when it has none), then
   the property's address.
5. "Checklist": every row in the checklist's own order. Each is the row's name with its result
   after it in the site's own words ("Seams · OK", "Perimeter flashings · Issue",
   "Drains/scuppers · N/A"), its note, and its pictures as thumbnails, three to a line, so
   several rows fit a page. A row never answered reads "Not checked" (see "Later the same
   day" below; it read as OK at first).
6. "Items needing attention": the issues again as a short table, Item and Note, with no
   pictures. "No issues found" when there are none.
7. "Recommendation:" with the inspection's recommendation.

No price, cost, credit or allowance is anywhere in it. The plan's lines come from the
inspection's own answers, which carry none.

## How a good row's pictures get in

A picture added on a row (Pictures, then the camera or From my photos, Nov 20 and Nov 23) is
kept against that row whatever its result. The report prints each row's pictures under the
row. The stored pictures are not touched or made smaller: the PDF carries each file as it was
uploaded (proven below).

A picture on the ticket that is on no row goes on the last page under "Other pictures from
this visit" (see "Later the same day" below; at first it was left out).

## How it is built

- `src/lib/documents/defaults.ts`: the template "Care plan report" (`CARE_PLAN_REPORT_TEMPLATE`),
  shipped after the Inspection report. An install gets it the next time anyone lists the
  templates, the way the Inspection report reached installs on Oct 26; removed by the office,
  it stays removed.
- `src/lib/documents/care-plan-report.ts`: the choices the report is made with (the Inspection
  report's own: pictures and marks on, no prices), how the button finds its template, and
  `carePlanLines()`, the two plan lines.
- `src/components/documents/care-plan-report-button.tsx`: the button.
- `src/components/service/ticket-header-actions.tsx`: both buttons in one row of the box.
- The generator already could list every row (`allItems` on a Repair List, unused until now).
  Two small settings were added for this report, both absent on every other list and item:
  - `showStatus`: a row's heading says " · Issue" too. Without it an issue's heading is its
    bare name, as on the Inspection report.
  - `listOnly`: the closing list of issues stays a table when the report is made and prints no
    pictures. Without it every Repair List is split into one box per item with its pictures,
    as before.
- Three new variables, all blank where they do not apply: `careplan.plan`,
  `careplan.cleaning`, `inspection.grade.line`.
- `src/lib/documents.functions.ts`: when a document is made from an inspection ticket that is a
  plan's, the plan and the cleaning answers are read where they are kept
  (`readVisitCleaning()`), with the reader's own rights. A read that fails leaves the lines
  out and never stops the document.

No database change.

## Proof that the Inspection report is unchanged

`src/lib/care-plan-report-nov23.test.ts`, first block, seven tests. They pass on the code as it
stood before this work and on the code after it:

- its template is the same, module for module: a fingerprint of the template worked out on the
  earlier code (commit 771fbad) and on this code is the same value, and so are the fingerprints
  of the other four shipped templates;
- its choices are the same;
- its button still finds its own template;
- made on a ticket, its findings are one box per issue only, the box carries exactly the keys
  it did, an issue's heading is its bare name, and only the issue's pictures are loaded;
- an ordinary Repair List still prints its pictures; the variables it prints are untouched.

In the browser, on the temporary ticket: Inspection report pressed after the Care plan report.
Its PDF read: cover, "Findings", "Perimeter flashings" with its note and its one picture, no
other row, then the recommendation and the signature lines. The document as stored holds
letterhead, line, text, picture, line, text, text, one Checklist item, Photo Grid, text,
signature, and the item has no new key.

## Tests

`src/lib/care-plan-report-nov23.test.ts`: 31 tests. With the eight changed files put back to
their committed versions (the two new files kept): the seven "unchanged" tests pass, 7 fail and
14 are skipped because the template they need does not exist; 3 pass, being tests of the new
file alone. With the new files taken away too the whole file fails. On this code all 31 pass.

One older pin moved, with a dated note: `src/lib/documents/model.test.ts`, the list of
templates a fresh install and an older install are given (one more ticket template).

## Browser proof (Nov 23)

On a temporary inspection ticket, number 999901, under the test customer, made a Roof Guard
plan's first inspection by a temporary plan with made-up figures, drains answered Yes and
gutters No with a reason.

- Through each row's own buttons on a phone-sized screen: two rows ticked OK with pictures (two
  on one, one on the other), one row an issue with a note and a picture, one N/A, one OK with
  no picture, five never answered.
- Documents box: both buttons shown. Care plan report pressed: the editor opened on "Care plan
  report — Ticket 999901".
- Read in the editor and again in the exported PDF (3 pages): the plan line "Roof Guard plan,
  inspection 1 of 2", the cleaning line, the customer, day, technician, summary and grade; all
  ten rows in the checklist's order with their results; the note on the issue; the pictures
  under their rows, two, one and one; the closing table with the one issue and no picture.
- The PDF holds the four row pictures at the size in bytes of the files uploaded: not reduced.
- No variable about a price, cost, credit, allowance or total is kept on the document.
- No notice was sent to anyone: the count of notices was the same before and after.

## Not proven

- The report on a real plan's inspection: there is no plan on the live site yet. The temporary
  plan stood in for one.
- The report as a person who is not an admin (a manager, or office staff with Documents). The
  button sits in the same box as the Inspection report's and uses the same server functions, so
  it follows the same rule; it was tried only as the test login, an admin.
- A long checklist with many pictures on every row, for how the pages break.

## Cleanup

Removed after the proof: the two documents and their two saved versions, the two stored PDFs,
the four pictures and their four small copies (eight files), the temporary ticket with its
events, the temporary plan and its inspection, and the "Care plan report" template row that
listing the templates had added to the live site ahead of the publish (so the published code
adds it itself). History entries of those records were removed by their ids. Ticket and plan
numbers stand where they stood: the temporary rows took none.

## Later the same day: rows not answered, and the ticket's other pictures

The owner, offered both as open issues of the first build: "go with issue 1, issue 2".

### 1. A row nobody answered prints "Not checked"

On this report only. A technician ticks OK, marks an issue, marks N/A, or leaves a row alone.
A row left alone reads as OK on every other document (owner, Oct 26: "not every part needs a
comment or status, just ones with problems"). On a report that lists every row to the
customer, "OK" would claim a check nobody recorded, so here it reads "Gutters · Not checked".

- In each row's heading, in the PDF and in the editor, by the same words
  (`fullStatusText()` in `variables.ts`).
- In the Summary on the cover: "1 issue · 2 OK · 1 N/A · 6 not checked". The count of OK is
  the rows ticked OK and nothing else (`carePlanSummary()`).
- The report keeps that Summary when the office presses Refresh data.
- The Inspection report, an ordinary Checklist item and an ordinary list of every row are as
  they were: a row left alone reads OK, and the Summary counts it as OK.

What this means on the roof: technicians are not made to answer every row. A row a technician
looked at and left alone prints "Not checked". On a plan's inspection they tick OK on what
they checked.

### 2. The ticket's pictures that are on no row

A picture taken on the inspection that sits on no row of the checklist now goes on the last
page: the heading "Other pictures from this visit", then the pictures three to a line. With no
such picture there is no heading and no gap. A repair's before and after pictures are not the
inspection's and are not taken. The pictures are the ticket's own files by reference, as the
rows' pictures are: nothing is copied or made smaller. The office can still move, resize or
remove the grid in the editor.

A template the office has given an empty Photo Grid of its own gets the pictures there, under
whatever the office put above it, and no heading is added.

### How a template that is already in an install is handled

Neither change touches the shipped template. Both are done where the report is made, and they
tell a Care plan report by what it holds: a list or a row marked `showStatus`, which only this
report's template carries (`isCarePlanReport()` in `care-plan-report.ts`). So a "Care plan
report" template that an install was given before today, or that the office renamed or
edited, gets both. A report made before today shows "Not checked" on its rows the next time
it is opened or exported; its Summary line changes when Refresh data is pressed; it does not
gain the pictures, which are put in only when a report is made.

On the live site the template had not been given yet when this was built (no row named "Care
plan report" in the table).

### Tests

`src/lib/care-plan-report-not-checked-nov23.test.ts`: 19 tests. With the five changed source
files put back to their committed versions, 17 fail and 2 pass. The 2 that pass are the ones
that hold every other document still (an ordinary box and list read OK for a row left alone).
On this code all 19 pass. Two pins in `care-plan-report-nov23.test.ts` moved from "Gutters ·
OK" to "Gutters · Not checked", each with a dated note. The seven tests that hold the
Inspection report still were not touched and pass.

### Browser proof

On a temporary inspection ticket, number 999902, under the test customer. Through each row's
own buttons on a phone-sized screen: two rows ticked OK with pictures, one an issue with a
note and a picture, one N/A, six left alone. Two more pictures were put on the ticket and on
no row.

- Care plan report pressed. In the editor: Summary "1 issue · 2 OK · 1 N/A · 6 not checked";
  the six rows left alone read "· Not checked"; the last page ends with "Other pictures from
  this visit" and a grid holding the two pictures.
- Exported PDF, 3 pages, read back as text and pictures: the same Summary, the same six rows,
  the heading and both pictures on page 3. Each of the two pictures is in the PDF at the size
  in bytes of the file uploaded: not reduced.
- Inspection report pressed on the same ticket: Summary "1 issue · 8 OK · 1 N/A", one box
  named "Perimeter flashings" with its picture, its own Photo Grid empty, no "Not checked"
  and no "Other pictures" heading anywhere.
- No notice was sent to anyone: the count of notices was the same before and after.

### Not proven

- A report with many loose pictures, for how the grid breaks across pages.
- With the document's Photos box unticked, the pictures are hidden like every picture, and the
  heading "Other pictures from this visit" still prints over nothing. The office can delete
  the heading in the editor.

### Cleanup

Removed after the proof: the two documents and their saved versions, the stored PDF, the six
pictures and their six small copies, the temporary ticket with its history entries, and the
"Care plan report" template row that listing the templates had added to the live site ahead
of the publish. Counts afterwards as before: 58 tickets, 0 temporary, 45 documents, 7
templates, 314 notices.
