# Takeoff audit: measuring a roof and sending it into a bid (Nov 10, 2026)

Asked for by the owner: "audit the takeoff … the ability to measure out the roof and then import it
into a bid works correctly and accurately … test everything, don't assume". Nothing was fixed. Every
number below was read off the running app (the test login, temporary "ZZ Audit Takeoff …" rows on
the local dev server against the live database) or printed by the app's own functions. All
temporary rows and files were removed afterwards (five takeoffs, two bids, one customer, three
files, their audit rows).

Live data when the audit ran: two live takeoffs, both satellite pictures, neither has built a bid.
No bid in the system came from a takeoff, so no live bid is affected by anything below.

## How it was tested

- A three-sheet test plan set made for the audit, with known sizes: sheet 1 at 1/8" = 1'-0" (a
  100 × 50 ft rectangle with a 10 × 10 ft well, an L of 3,600 sq ft / 280 ft, a 30-40-50 triangle,
  a 60 ft dimension line), sheet 2 at 1/4" = 1'-0" (40 × 20 ft), sheet 3 a letter page with no
  scale note (20 × 10 ft and a 30 ft line).
- A picture (1000 × 700 px) with a 600 × 300 px roof for the screenshot path.
- The Kentucky imagery service's own tile description and its picture of a football field, for the
  satellite scale.
- The real page in a browser: New takeoff, Scale, Area, Linear, Penetrations, Cut-out, Edge from
  this area, typed sizes, rotation, pitch, zoom, undo, Setup, Create bid, the estimator's screens,
  Save, the lock, Edit a copy, Update bid, CSV and marked-up PDF.
- The saved rows read back from the database.

## What holds (proven)

Measuring, sheet 1 (scale read off the sheet, corners snapped to the plan's own lines):

| Shape                   | Known                           | App                                          |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| Rectangle               | 5,000 sq ft, 300 ft             | 5,000 sq ft, 300 ft, layout 100 × 50         |
| L                       | 3,600 sq ft, 280 ft, 6 sides    | 3,600 sq ft, 280 ft, sides 80/30/40/30/40/60 |
| Triangle                | 600 sq ft, 120 ft               | 600 sq ft, 120 ft, sides 40/50/30            |
| Line                    | 60 ft                           | 60.0 ft                                      |
| Rectangle less the well | 4,900 sq ft, 40 ft of well wall | 4,900 sq ft, "penthouse walls 40"            |

- A gutter line drawn by hand along the rectangle's long side was recognised: "gutter: A (100 ft)".
- Penetrations counted as placed (3 drains, 2 pipes, 1 curb).
- A scale drawn on a 30 ft line (sheet 3): the 20 × 10 ft rectangle read 200 sq ft. Turning the page
  kept it at 200.
- Pitch 4:12 on that rectangle: 211 sq ft (200 × 1.054) and 61.1 ft around (the two short sides
  sloped). The section note says the rakes are assumed.
- Drawing zoomed in to 60 % with snapping off: a 10 × 10 ft square read exactly 100 sq ft.
- Typed size "40x20" made an 800 sq ft rectangle; typed lengths 30, 10, 30 made 300 sq ft. A typed
  `24'-6"` reads as 24 ft 6 in (the dash is ignored).
- Edge from this area on the 40 × 20: four parapet walls, 40/20/40/20 ft, 120 ft.
- Undo and redo.
- Picture underlay: drawn scale 600 px = 120 ft, roof read 7,200 sq ft, 360 ft.
- CSV export and the marked-up PDF carry the same numbers.

Create bid, every seeded value read back from the saved bid:

- Three sections with the measured sides, in order, and the layout rectangle of the same area and
  perimeter (101.93 × 48.07, 106.06 × 33.94, 47.32 × 12.68).
- Corners marked on outside corners only; the L's one inside corner is not marked.
- The gutter side came across with a 4" Drip Edge.
- Parapet 60 ft at 36 in: 180 sq ft of wall on the Parapets screen.
- Curb 48 × 36 × 12, quantity 1. Pipe stacks 2 × 4 in. Drains 3 with the 4" boot and rings.
- Roof system, attachment, mil, colour, deck and design table from the takeoff's Setup; the Setup
  note in the bid's notes; the gutter and the well walls listed under "add these by hand".
- The suite's parity test (a drawn rectangle prices the same as the same rectangle typed by hand)
  passes.

After the bid is saved:

- The takeoff locks, says which bid it built, and refuses a drawing with a plain message.
- Edit a copy makes an unlocked copy that offers "Update bid" on the original's bid, with a list of
  what changed.
- The estimator's "Are these numbers right?" check stopped the save for parapets with no height and
  a low price per sq ft.

Satellite scale:

- The Kentucky service publishes 256 px Web Mercator tiles at 0.29858 m per pixel at level 19. The
  app's constant is the same number, and it applies the latitude correction.
- The two live takeoffs' stored scales work back to latitude 37.74°, which is where their address
  is.
- On the state's level-19 picture of a college football field, corner to corner by eye: 362 × 161 ft
  with the app's formula. The field is 360 × 160 ft.

## Findings

### 1. "Update bid" often rebuilds the bid from scratch and drops the estimator's work

Setup: a bid made from a takeoff, then edited by hand (Section 1 changed to Tan, one section added
by hand). Edit a copy, press Update bid, confirm. Eight tries in a row, nothing else changed:

- 5 of 8: every section and wall was thrown away and made new. The hand-added section was gone
  (8 sections instead of 9), Section 1 was White again, and the notice read "Added section …" for
  all eight sections and all four walls. Saving at that point makes the loss permanent.
- 3 of 8: correct. "Nothing in the drawing changed", 9 sections, Tan kept.

The confirmation says "The bid's own edits to unrelated fields are kept." Nothing on screen says
otherwise when they are not.

Cause, from the code (`src/routes/estimate.tsx`, the `?takeoff=` effect): the update is applied to
whatever the page holds at the moment the bid finishes loading. When the takeoff has already
arrived, that is still the empty page from before the load, and the result replaces the loaded bid.
The same block also sets curbs, pipe stacks, drains, accessory, metal and Non-DL lines and the
notes; those were not tested one by one.

### 2. A scale drawn on one sheet is put on every other sheet by default

On the Scale popup the box "Apply this scale to every page of this file that has no scale yet" is
ticked by default. A sheet only reads its own printed scale note the first time it is opened, and
only if it has no scale by then.

Proven: scale drawn on sheet 1's 60 ft line, box left as it was. Sheet 2 prints 1/4" = 1'-0" but
took sheet 1's scale. Its 40 × 20 ft roof read 3,200 sq ft instead of 800. Sheet 3's 20 × 10 ft
roof read 356 sq ft instead of 200. The chip on both sheets says "Scale: 60' line drawn on the
sheet", a line that was never drawn on them.

### 3. Two people in the same takeoff overwrite each other, with no warning

Proven with two windows on one takeoff (6 areas): the first drew an area, the second (not
reloaded) drew another. After a reload there were 7, not 8. The first person's area was gone.
The save sends the whole drawing and the server takes it without checking that it is newer.
Bids have a lock for this; takeoffs do not.

Also proven: opening a takeoff and touching nothing saves it again unchanged and stamps "Last
updated … by" with the viewer's name.

### 4. An outline that crosses itself is accepted with a wrong area

Four corners clicked in a crossing order gave "0 sq ft" with no message. Create bid then made a
0 × 0 section, the notice said "Everything measured has been placed", and the save check did not
mention it. With more corners a crossed outline gives a believable but wrong number (the app's own
function returned 5,100 for one such test shape).

### 5. Cut-outs are not checked against the roof

- A cut-out drawn completely outside its roof still came off: 800 sq ft became 700.
- Two cut-outs on top of each other are taken off twice (4,800 where 4,900 is right).
- A cut-out half outside the roof comes off in full.

### 6. If linking the takeoff to its new bid fails, nobody is told

The first save of a bid made from a takeoff sends one background request that links and locks the
takeoff. Its failure is swallowed (`.catch(() => {})`) and it is never tried again. Reproduced by
blocking that one request: the bid saved, the takeoff still said "No bid yet", stayed unlocked and
still offered Create bid, which would make a second bid.

### 7. Smaller points

- Every section made from a takeoff arrives with the red note "The following field(s) have invalid
  values: Perimeter Enhancement Width < 12". Takeoff sides default to perimeter edges, the
  estimator's own default width is 3 ft, and the estimator's rule wants 12. The rule and the
  default are the estimator's; the takeoff only brings it out every time.
- A new bid from a takeoff opens with a long toast "field spacing re-derived to 6" (was 18")" for
  every section. The 18 is a starting default, not something the estimator typed.
- The bid prices the layout rectangle rounded to two decimals. On the test roof that is 9,099.47
  sq ft against 9,100. Over 4,000 generated shapes the worst gap was 3 sq ft (0.08 %).
- Setup answers only reach areas and drains placed afterwards (the page says so). Drains placed
  before the drain boot and ring are chosen stay "no boot / ring picked" until set on each.

## Not tested

- Drawing by touch or pencil on an iPad.
- Deficiency pins, their pictures and the customer viewer.
- The satellite address search in the browser (the scale maths was checked instead), and the
  Tennessee imagery.
- A material on a line priced in the browser (the suite covers it).
- The PlanSwift import.
- Delete and restore of a takeoff.
