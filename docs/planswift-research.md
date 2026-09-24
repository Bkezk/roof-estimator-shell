# PlanSwift research and the Takeoff proposal (the module is called "Takeoff")

Written Sep 24, 2026 for the owner's question: "do some research on PlanSwift's capabilities and
menus instead of just going off our prompt." Everything under **Verified** was read from
ConstructConnect's help centre, the PlanSwift user guide (v10), the PlanSwift site, or the
Commercial Roofing Starter Pack PDF (assembly compendium, pages 17–29, read as images). Anything
we still have to confirm with the owner is under **Open questions**. The brief's takeoff row in
`docs/roofing-ops-portal-brief.md` stays the plan of record; this document is the detail behind
it.

## 1. What PlanSwift is (verified)

- Windows-only desktop takeoff and estimating program, sold by ConstructConnect. Two tiers:
  Essential (about $2,000 per seat per year) and Core (about $3,000). No Mac or browser version.
- Opens PDF, DWG, DXF, JPG, TIFF and PLN plan files. Each page carries its own scale; a page can
  have different horizontal and vertical scales.
- One job = a set of pages (folders, bookmarks, tabs) plus the takeoff objects drawn on them
  plus an estimating tree (items, assemblies, parts) that turns the drawn quantities into a
  material and labour list. Reports export to PDF, Excel, CSV, XML and HTML; a "Live Excel Link"
  pushes quantities straight into a spreadsheet.
- 2026 releases add "Takeoff BOOST" AI tools: auto takeoff, auto count, auto scale and auto
  bookmark.

Sources: planswift.com/features, constructconnect.com/products/planswift, help.constructconnect
.com "Getting started with PlanSwift", PlanSwift release notes 2026-05-06, PlanSwift User Guide
v10 (planswiftuk.co.uk).

## 2. Menu and ribbon map (verified)

### Home tab

| Group            | What it holds                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages            | Add pages, switch pages, page list                                                                                                                                                                                                                                                                                                                                |
| Takeoff          | **Area**, **Linear**, **Segment**, **Count**. Each has a dropdown of specialty items: Roof Area (adds a Pitch field so the sloped area is computed from the flat drawing), Single-Click Area / Linear / Count (clicks a closed region or line on the drawing and uses the plan's own lines, with "cut-lines" to close gaps), Grid, Joists, Cubic Yards, Price Per |
| Measure          | **Scale** (Calculate Scale from a known dimension by clicking two points, or pick a Standard Scale from a list; per page; separate horizontal and vertical), **Dimension** (draw a dimension line to verify the scale; precision from 1 inch down to 1/16 inch)                                                                                                   |
| Annotations      | Text, arrows, shapes, highlights, stamps                                                                                                                                                                                                                                                                                                                          |
| Digitizer Record | Options while a takeoff tool is live (below)                                                                                                                                                                                                                                                                                                                      |

Digitizer (drawing) options while a tool is active: **Snap** (to plan lines), **Ortho** (lock to
90 degrees; hold Shift to override), **Freehand**, **Verify Points**, **Record Mode** Point-to-
Point or Box, **New Section** (start another polygon under the same takeoff item), **Continue
With** (carry on the same item on another page), Backspace or Ctrl-Z removes the last point,
double-click or right-click stops, M toggles a magnifier, Esc cancels.

Area takeoff specifics: a closed polygon; multiple sections per item; **cut-outs** (subtract
an inner polygon); the item shows square feet and the perimeter; can be converted to a
"Roof Area" with pitch. Linear takeoff: polyline, total length; Segment takeoff: the same but
each segment is reported on its own line. Count: one click per pin, with a symbol and colour
per item.

Sources: help.constructconnect.com 03-08 (scale), 03-09 (dimension line), 03-11-01 (area),
03-11-04 (count), 03-12 (digitizer options), 03-12 (linear and segment), 03-12-10 (Continue
With), 14-03 (different horizontal and vertical scales), 14-07-01 (roof area), 14-07-04 (grid),
14 specialty single-click items.

### Page tab

Add pages (drag PDFs or folders in), folders and bookmarks, batch rename, rotate and **level**
(straighten a scanned sheet), invert colours, **crop as new page**, page or sheet information
(scale, sheet size, Imperial or Metric), page order, tabbed and undocked pages.

Sources: help.constructconnect.com 04-02, 04-03, 04-04, 04-06, 04-09, 04-10, 04-11, 04-12.

### Estimating tab

- **Items**: everything in the job tree. **Takeoff Items** are the area, linear, segment and
  count objects. **Assemblies** are containers that hold parts. **Parts** are the materials and
  labour attached to a takeoff item; each part has a quantity formula that reads the takeoff's
  properties (area, perimeter, length, count, pitch) and its own coverage (roll size, sheet
  size, box count, gallons per square foot).
- **Types** classify parts (Material, Labor, Folder). **Lists** are pick lists. **Templates**
  pane holds reusable Parts and Assemblies to drag onto a takeoff. **Reports** designer.
- New item dialog offers Takeoff Item, Assembly or Part.

Sources: help.constructconnect.com 07 overview and 07-03, planswift.com blog "use parts and
assemblies", "use takeoff assemblies".

### Plugins and the Commercial Roofing Starter Pack (verified from the PDF)

The starter pack is a template library (no prices): about 60 assemblies and 200 parts. The
compendium shows exactly how PlanSwift users model a commercial roof:

| Takeoff type              | Assemblies in the pack                                                                                                                                                                                                                                                              | Parts they carry                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Area** (the roof field) | TPO MF, TPO FA, TPO MF or FA with cover board; PVC MF, PVC FA; EPDM FA, MF, Ballasted; BUR three-, four-, five-ply; SBS two-, three-ply cold applied; APP two-, three-ply                                                                                                           | Membrane roll (10 x 100 ft), seam tape, insulation sheets 4 x 4, cover board 4 x 8, fasteners and 2 in plates per box, vapour barrier roll, adhesive by gallons per sq ft, asphalt by lb per square, labour priced per sq ft |
| **Linear**                | Wall flashing (TPO, PVC, EPDM), 10 in flashing, curb flashing, fascia edge flashing, parapet wall (base and cap flashing, cant strip, fasteners at 12 in on centre, cement, primer), flat edge flashing (cap and base flashing, 4 in metal roof edge in 8 ft lengths, joint covers) | Rolls by width, metal in 8, 10 or 12 ft lengths, fasteners per row and spacing, labour per ft or per sq ft                                                                                                                   |
| **Count**                 | Pipe boot, turbine vent, drain (strainer, clamp ring, deck ring, lead flashing, cement), extrusions                                                                                                                                                                                 | One each, labour priced each                                                                                                                                                                                                 |

Every system also ships a "Basic Takeoff" folder with the same six takeoff items: **System**
(area), **Flashing** (linear), **Wall Flashing** (linear), **Drains** (count), **Pipe Boots**
(count), **Extrusions** (count). That six-item set is the whole PlanSwift roofing takeoff at
its simplest.

## 3. What this means for us

The owner said PlanSwift is used on "both" PDF plans and aerial views. Two conclusions:

1. **We only need the drawing half.** PlanSwift's Estimating tab (assemblies, parts, coverage
   formulas, labour per sq ft) is the job Bid-Advantage does and our estimator already does
   with legacy parity. Rebuilding assemblies would be a second, worse estimator. The takeoff
   module should produce **measured quantities** and hand them to the estimator; the estimator
   keeps pricing.
2. **The six-item Basic Takeoff maps one-to-one onto estimator inputs.** Area → roof section;
   Flashing (linear along the roof edge) → edge options per side (termination, blocking, ARP);
   Wall Flashing (linear) → parapets; Drains, Pipe Boots, Extrusions (count) → drains, pipe
   stacks, vents and curbs on the Accessories and Curbs steps.

So the module is: an underlay, a scale, three drawing tools, per-object attributes, a
quantities panel, and "Create bid from takeoff".

## 4. Proposed Takeoff module

### 4.1 Underlays

- **PDF plan sheet** (phase 1). Upload to a private storage bucket; render pages with pdf.js on
  a canvas; a page list on the left like the Page tab (rotate in 90 degree steps, page name).
  Level and crop are later.
- **Aerial** (phase 3). The Prospecting map already draws KyFromAbove imagery with MapLibre and
  knows the building footprint, so the scale is known and the footprint can be offered as the
  first area polygon. Same object model, different underlay.

### 4.2 Scale (PlanSwift's Measure group)

- **Calibrate from a known dimension**: click two points, type the real distance (feet and
  inches). PlanSwift's guide recommends a dimension of at least 20 ft for accuracy; we show the
  same hint. Stored per page.
- **Standard scale** dropdown (1/8 in = 1 ft, 1/4 in = 1 ft, 1 in = 10 ft, 1 in = 20 ft and so
  on) for sheets with a printed scale, converted using the PDF's page size.
- **Verify** with a dimension tool that draws a line and reports its length.
- Separate horizontal and vertical scale only if a sheet turns out distorted; not in phase 1.

### 4.3 Tools

| Tool             | Behaviour                                                                                                                                                                                                                                                                                              | Feeds                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Area**         | Closed polygon. Snap to 90 degrees by default (PlanSwift Ortho; hold Shift to free the angle). Cut-outs for wells and penthouses. Shows sq ft and perimeter live. Multiple polygons per section allowed.                                                                                               | Roof section area, perimeter, and each edge           |
| **Edge marking** | After an area is closed, click any side to set: perimeter edge yes/no, termination (the legacy list: T-Bar, fascia, gravel stop, drip edge, 2-pc metal), wood blocking, ARP size, tall wall. Outside corners are detected from the polygon; inside corners are not corners for the corner enhancement. | Edge options A–D today, N sides tomorrow (see 4.5)    |
| **Linear**       | Polyline, total length. Attribute: what it is (parapet wall with height band, gutter, expansion joint, other).                                                                                                                                                                                         | Parapets (length), NDL metals and accessories by feet |
| **Count**        | One pin per click with a symbol per kind: drain, pipe stack (size), vent, curb (with width and length in inches), scupper, other.                                                                                                                                                                      | Drains, Pipe stacks, Curbs, accessories               |
| **Dimension**    | A measuring line, not saved as a quantity.                                                                                                                                                                                                                                                             | Scale check                                           |

Interaction details copied from PlanSwift because estimators already know them: Backspace
removes the last point, Esc cancels, double-click closes, a magnifier while drawing, colour and
name per object, undo and redo, keyboard shortcuts A, L, C for the tools.

### 4.4 Quantities panel

Always visible on the right: every object with its computed quantity (sq ft, ft, count) and
its attributes, grouped Sections / Edges / Parapets / Counts. This is the PlanSwift job tree
without the parts. Export to CSV so the bookkeeper or a manual bid can use it.

### 4.5 Engine prerequisite: a measured section

The engine prices a roof section as a rectangle (`length × width`, sides A–D, four outside
corners; `src/lib/engine/estimate.ts`, `src/lib/engine/edges.ts`). A measured outline has N
sides and any number of outside corners. Two facts settle the design:

- For a rectilinear outline (every corner 90 degrees, which is nearly every commercial roof)
  the outline's perimeter is at least its bounding box's perimeter and its area at most the
  box's area, so a rectangle with the same area and perimeter always exists. The Prospecting
  helper `equivalentRectangle` in `src/lib/prospect.ts` already computes it. That rectangle
  drives the parts of the engine that genuinely think in sheets and rolls (membrane with
  overlap, sheet size, layout).
- Perimeter and corner enhancement, terminations, blocking and ARP do not need a rectangle.
  They are sums over sides and corners, and `resolveSectionZones` already sums marked sides
  into `perimLengthFt` and `cornerLengthFt`. Generalising from four sides to N sides is a
  change of loop bound, not of formula.

So a measured section is: polygon area, the equivalent rectangle, a list of edges (length and
the existing per-edge attributes), and the count of marked outside corners. The **parity test**
before any takeoff UI: a rectangle drawn as a four-point polygon must produce the same money as
the same rectangle typed on the Sections screen, on the existing fixture bids.

### 4.6 Materials first, then draw, then Create bid (owner, Sep 24)

Where Takeoff differs from PlanSwift: it asks the material questions **up front**, before any
drawing, then prefills as much of the new bid as it can when the drawing is finished. The
setup step is the estimator's own Setup/Defaults panel in short form: roofing system, membrane
mil and colour, attachment and adhesive, underlayment layers, deck type, edge termination and
wood blocking defaults, parapet system, fastening (pull test or on-centre). Every object drawn
afterwards already knows what it becomes in the bid, so the quantities panel can show the bid's
own names (sections, edges, parapets, curbs) rather than generic areas and lines.

**Create bid** is one button. It creates a new estimate with those setup answers as the bid's
defaults and with sections, edges, parapets, curbs, drains and pipe stacks filled from the
drawing, then opens it. The
takeoff row stores the bid id; the estimate stores `takeoff_id`. Re-running after the drawing
changes shows "quantities updated" on the estimate rather than overwriting silently, as the
brief already states.

### 4.7 Data and access

- `takeoffs` table as in the brief: id, name, underlay kind (pdf or aerial), file reference,
  pages with scale, objects (JSON: kind, points in page units, attributes), computed
  quantities, `building_id`, `bid_id`, created and updated by. Row-level security like bids.
- Storage bucket `takeoffs` for the PDFs (private; signed URLs).
- Access: add `takeoff` to `PAGES` in `src/lib/access.ts` and a route `src/routes/takeoff.tsx`
  patterned on `src/routes/prospect.tsx`.
- Dependencies: pdf.js for rendering; drawing on a plain canvas or SVG overlay (Konva is the
  brief's suggestion; a small hand-rolled overlay is enough for three tools); MapLibre is
  already present for the aerial mode.

### 4.8 Phases

| Phase | Scope                                                                                                                                                                 | Done when                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | Measured-section mode in the engine plus the parity test                                                                                                              | Test green; no UI                                                  |
| 1     | Takeoff page: PDF upload, page list, scale calibration and verify, area with cut-outs and edge marking, linear, count, quantities panel, CSV export, `takeoffs` table | An estimator measures a real plan set and reads correct quantities |
| 2     | Create bid from takeoff, live "quantities updated"                                                                                                                    | The bid prices the same as the same job typed by hand              |
| 3     | Aerial mode from the Prospecting map, footprint offered as the first area                                                                                             | A prospect becomes a measured quick bid without a plan             |
| 4     | Nice-to-haves only if asked: level and crop, standard-scale detection from the title block, page overlays, single-click area using the plan's lines                   | —                                                                  |

What we deliberately do not build: assemblies and parts, report designer, Excel live link,
DWG or DXF input (PDF export from the architect covers it), pitch (flat commercial roofs; a
pitch factor is a one-field addition if a sloped job ever appears).

## 5. Owner's answers (Sep 24) and what they change

1. **What else is measured beyond area, edge and parapets:** not sure yet. The three tools stay
   generic enough (any linear or count object can be "other" with a name and a quantity) that
   nothing is lost while we find out on the first real plan set.
2. **Pricing happens in Bid-Advantage, never in PlanSwift:** everything is measured in PlanSwift
   and transferred by hand. Confirms the scope: Takeoff replaces the measuring and the
   transfer, the estimator keeps pricing.
3. **Scale:** mostly a known dimension, on plans and on aerial shots alike. Calibrate-from-two-
   points is the primary scale tool on every underlay; the standard-scale dropdown is secondary.
4. **Aerial takeoffs are done on a screenshot.** So the aerial underlay in phase 1 is simply an
   image file (PNG or JPG screenshot) with the same calibration step, not a map layer. The
   Prospecting-map mode in phase 3 is a convenience on top of that (the footprint and scale
   already known), not a prerequisite.

Net change to the phases: phase 1 accepts PDF **and image** underlays; phase 3 shrinks.

## 6. Open questions for the owner

1. Which parapet fields should the setup step ask up front (system, height band, deck) and
   which stay per wall in the bid?
2. When the first real plan set is measured: the list of things measured that are not a section,
   an edge, a parapet, a drain, a pipe or a curb.
