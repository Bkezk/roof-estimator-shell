# PlanSwift ↔ Bid-O-Matic bridge

One document for the PlanSwift template build (Sep 25, 2026). **Part A** is the quantities-only
template set that Bid-O-Matic imports. **Part B** adds cost parts so a PlanSwift job can also
produce its own number. **Part C** is every price and labor table those parts read, exported from
Bid-O-Matic's live database on 2026-09-25. Regenerate Part C after each price import; nothing in it is
typed from memory.

# Part A — the quantities set (what Bid-O-Matic imports)

Written Sep 25, 2026 for the owner's plan: keep measuring in PlanSwift 11 for now, export the
job, and drop it into Bid-O-Matic, which turns it into a bid the same way its own Takeoff page
does (docs/planswift-research.md §4.6). This document is the contract between the two: what the
PlanSwift items must be called, which properties they carry, which values those properties may
take, and what Bid-O-Matic reads from the export. Part B is the costing version and Part C is every price and
labor table the costing parts read, so this one file is the whole hand-off.

### 1. Two rules before anything else

**No prices in PlanSwift.** Bid-O-Matic prices. Its catalog carries the live Duro-Last price
list, the labor tables, tax, freight, markup and every legacy quirk of Bid-Advantage, and it
already prices a drawn outline to the cent. A price typed into a PlanSwift part is a second copy
that drifts the day the price list changes, and it would never include labor, tax or markup
anyway. So the templates carry **quantities and parameters only**: `Cost Each` stays 0 on every
part, and "what does this roof cost" is answered in Bid-O-Matic after the import. If a rough
number is wanted on the PlanSwift side for a quick look, the only honest one is the estimator's
own total, which the import produces in seconds.

**Names are keys.** Bid-O-Matic matches PlanSwift items and property values by exact text
(case-insensitive, surrounding spaces ignored, but otherwise letter for letter, including
inch marks). Every list below is copied from the live Bid-O-Matic catalog on Sep 25, 2026. Use a
`SimpleList` dropdown for each parameter with exactly these values so nothing is typed by hand.

### 2. What Bid-O-Matic wants from a plan

Bid-O-Matic's Takeoff model has three kinds of object and it needs nothing else:

| Kind   | PlanSwift takeoff type | Becomes in the bid                                      |
| ------ | ---------------------- | ------------------------------------------------------- |
| Area   | Area                   | A roof **section**: true area, perimeter, each side     |
| Linear | Linear or Segment      | A **parapet** run (or gutter, walkway, expansion joint) |
| Count  | Count                  | **Drains, pipe stacks, vents, curbs, scuppers**         |

The material answers (system, mil, colour, deck, attachment, underlayment, edge defaults) are
asked **once per job**, not per item. In PlanSwift that is one hidden **Job Setup** item (a
Count type placed once, or job-level custom properties); Bid-O-Matic reads it as the setup
answers and applies it to every section the same way its own Setup tab does.

#### 3. The templates to build

All names below are the item names Bid-O-Matic looks for. Folder: `Bid-O-Matic`.

#### 3.1 `BOM Job Setup` (Count, placed once per job)

| Property (Input)       | Values (SimpleList)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Notes                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Roof System`          | `Duro-Last`, `Duro-Tuff`, `Duro-Bond`, `Duro-Fleece`, `Duro-Roof`, `Duro-Tech TPO`, `Non-DL TPO`, `EPDM Rubber`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The eight systems the estimator prices                                                                                                                 |
| `Attachment`           | `mechanical`, `adhered`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Valid pairs: Duro-Last, Duro-Tuff, Duro-Tech TPO, Non-DL TPO, EPDM Rubber take both; Duro-Bond and Duro-Roof mechanical only; Duro-Fleece adhered only |
| `Adhesive`             | `Water Based Adhesive`, `Solvent Based Adhesive`, `Duro-Fleece Adhesive(2-boxes)`, `Duro-Fleece Adhesive(cartridge)`, `Duro-Grip Adhesive(CR-20)`, `OlyBond500 Bag-in-Box`, `OlyBond500 SpotShot`, `Millenium One Step`, `Millenium PG1 Boxes`, `Millenium PG1 Drums`, `TECH-Bond TPO Bonding Adhesive`, `TECH-Bond TPO LVOC Bonding Adhesive`, `TECH-Bond TPO Spray Adhesive`, `Non-DL TPO Bonding Adhesive`, `Non-DL TPO Spray Adhesive`, `EPDM Bonding Adhesive`, `EPDM Spray Adhesive`                                                                                                                                                                                                                                                                                                                                                                                                                            | Only read when Attachment = adhered                                                                                                                    |
| `Membrane Mil`         | `40`, `50`, `60` (Duro-Last, Duro-Bond, Duro-Fleece); `50`, `60` (Duro-Tuff); `45`, `60`, `80` (Duro-Tech TPO, Non-DL TPO); `45`, `60`, `75`, `90` (EPDM Rubber)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Number                                                                                                                                                 |
| `Membrane Variant`     | `Plus` or blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Duro-Fleece only ("Duro-Fleece - 50mil Plus")                                                                                                          |
| `Color`                | `White`, `Tan`, `Gray`, `Dark Gray`, `Terra Cotta`, `Rock-Ply`, `Black`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The membrane price columns                                                                                                                             |
| `Sheet Size`           | `Roll Good`, `500 sf`, `1000 sf`, `1500 sf`, `2000 sf`, `2500 sf`, `3000 sf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Duro-Roof has no Roll Good; Duro-Bond tops out at 2500 sf; other systems price as roll goods                                                           |
| `Field Tab Spacing`    | Duro-Last `28`, `60`, `120`; Duro-Roof `57`, `87`, `120`; Duro-Tuff, Duro-Tech TPO, Non-DL TPO `30`, `60`, `120`; EPDM Rubber `120`, `240`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Inches (tab spacing on sheets / roll width on rolls)                                                                                                   |
| `Deck Type`            | `Wood`, `Steel`, `Retrofit`, `Concrete`, `Gypsum`, `LWC/Steel`, `LWC/Concrete`, `LWC/Other`, `Tectum`, `Purlin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Roof section deck (labor multiplier)                                                                                                                   |
| `Design Table (psf)`   | `60`, `90`, `120`, `150`, `180`, `210`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Wind design table; default 60                                                                                                                          |
| `Pull Test (lbs)`      | number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Default 350; drives the fastener spacing lookup                                                                                                        |
| `Underlayment 1..4`    | `1/4" Dens Deck`, `1/2" HD ISO 4'x 4'`, `1/2" ISO`, `1/2" Rigid 4'x 4'`, `1" ISO`, `1" ISO 4'x 4'`, `1" Rigid`, `1" Rigid 4'x 4'`, `1/2" DensDeck Prime`, `1/2" Securock GFRB`, `1/4" DensDeck Prime`, `1/4" Securock GFRB`, `1 1/2" ISO`, `1 1/2" ISO 4'x 4'`, `1 1/2" Rigid`, `1 1/2" Rigid 4'x 4'`, `2" ISO`, `2" ISO 4'x 4'`, `2" Rigid`, `2" Rigid 4'x 4'`, `2.7" ISO`, `2.7" ISO 4'x 4'`, `2.7" Rigid`, `2.7" Rigid 4'x 4'`, `2 1/2" ISO`, `2 1/2" ISO 4'x 4'`, `2 1/2" Rigid`, `2 1/2" Rigid 4'x 4'`, `3" ISO`, `3" ISO 4'x 4'`, `3" Rigid`, `3" Rigid 4'x 4'`, `3/8" Dens Deck`, `3/8" Securock GFRB`, `3 1/2" ISO`, `3 1/2" ISO 4'x 4'`, `3 1/2" Rigid`, `3 1/2" Rigid 4'x 4'`, `4" ISO`, `4" ISO 4'x 4'`, `4" Rigid`, `4" Rigid 4'x 4'`, `5/8" DensDeck Prime`, `5/8" F/C Sheet Rock`, `5/8" Securock GFRB`, `Duro-Blue Slipsheet`, `Duro-Fold`, `Duro-Weave`, `FR 10`, `FR 50`, `Geotextile`, `Ultra-Fold` | Bottom layer first; blank = no layer                                                                                                                   |
| `Underlayment Attach`  | `mechanical`, `adhesive`, `none`, `durobond`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | How the boards are attached                                                                                                                            |
| `Edge: Perimeter`      | `Yes`, `No`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Default for every roof edge (perimeter enhancement zone)                                                                                               |
| `Edge: Termination`    | `No Termination`, `T-Bar`, `1-3/4" Fascia`, `4" Fascia`, `2" Gravel Stop`, `4" Gravel Stop`, `2" Drip Edge`, `4" Drip Edge`, `3" 2-pc Metal`, `4" 2-pc Metal`, `5" 2-pc Metal`, `6" 2-pc Metal`, `7" 2-pc Metal`, `8" 2-pc Metal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Default edge metal                                                                                                                                     |
| `Edge: Wood Blocking`  | `Yes`, `No`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Blocking the full length of each edge                                                                                                                  |
| `Edge: ARP (in)`       | `0`, `12`, `18`, `24`, `30`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Additional reinforcement ply width; 0 = none                                                                                                           |
| `Parapet: Deck`        | `Concrete`, `Gypsum`, `LWC over Concrete`, `LWC over Other`, `LWC over Steel`, `Metal Retrofit`, `Purlin Fastened`, `Structural Metal`, `Tectum`, `Wood`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Parapet labor deck names (differ from the section list on purpose)                                                                                     |
| `Parapet: System`      | same list as Roof System, or blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Blank = same as the roof                                                                                                                               |
| `Parapet: Attachment`  | `mechanical`, `adhered`, or blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |                                                                                                                                                        |
| `Drain: Existing Roof` | `None`, `Single Ply`, `BUR`, `GS BUR`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Default for every drain                                                                                                                                |
| `Drain: Reuse Rings`   | `Yes`, `No`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |                                                                                                                                                        |

#### 3.2 `BOM Roof Section` (Area)

One per roof section. PlanSwift gives Bid-O-Matic the polygon itself (see §4), so the item
needs only a `Section Name` input and, optionally, overrides of the job setup for that section
(`Deck Type`, `Membrane Mil`, `Color`, `Sheet Size`, `Field Tab Spacing`, same lists as above;
blank = job setup). Do **not** compute membrane squares, fasteners, plates or boards as parts:
Bid-O-Matic derives every one of those from the outline with the Bid-Advantage rules
(membrane with overlap, zone shares, sheet and roll layout, pull-test fastener spacing, board
counts and waste), and two different formulas will never agree.

The per-side options (perimeter yes/no, termination, blocking, ARP, tall wall) are edge
properties Bid-O-Matic assigns from the job setup defaults to every side of the imported
polygon; the estimator then changes individual sides on the Sections screen. If a plan needs
different edge metal on different sides at takeoff time, draw a `BOM Roof Edge` linear (below)
along those sides instead of trying to tag polygon edges in PlanSwift.

Cut-outs: draw wells and penthouses as a second `BOM Roof Section` named for the hole with the
input `Cut-out of` = the parent section's name; Bid-O-Matic subtracts it.

#### 3.3 `BOM Roof Edge` (Linear, optional)

For runs of edge whose options differ from the job default. Inputs: `Termination` (list above),
`Perimeter` (`Yes`/`No`), `Wood Blocking` (`Yes`/`No`), `ARP (in)`, `Tall Wall` (`Yes`/`No`).
Bid-O-Matic snaps the run onto the nearest section sides and applies the options to those sides.

#### 3.4 `BOM Parapet Wall` (Linear)

Inputs: `Wall Name`, `Height (in)` (number; the estimator derives the labor band `0"-30"`,
`31"-48"`, `49"-72"`, `73"-99"`, `100"+` from it), `Deck` (parapet deck list; blank = job
setup), `Pre-drill` (`Yes`/`No`), `Canted` (`Yes`/`No`), `Slipsheet` (`Yes`/`No`).

#### 3.5 Counts

| Item              | Inputs                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOM Drain`       | `Size (in)` `2`, `2 1/2`, `3`, `3 1/2`, `4`, `4 1/2`, `5`, `5 1/2`, `6`, `6 1/2`, `7`, `7 1/2`, `8` (boot and ring are sized alike); `Existing Roof`, `Reuse Rings` (blank = job setup)                                                                                                                                             |
| `BOM Pipe Stack`  | `Size (in)` `1`, `1.5`, `2` … `15`, `16`, `18` … `44` (even sizes above 16 are open only; 1" is closed only); `Usage` `Plumbing`, `Hot Stack`, `Pitch Pan`; `Open` `Yes`/`No`                                                                                                                                                       |
| `BOM Vent`        | `Color` (membrane colour list)                                                                                                                                                                                                                                                                                                      |
| `BOM Curb`        | `Curb Name`, `Width (in)`, `Length (in)`, `Type` `Open`, `Closed`, `Closed w/ Top`, `Scupper`, `Metal Scupper`, `Height (in)`, `Deck` (section deck list; blank = job setup)                                                                                                                                                        |
| `BOM Scupper`     | `Width (in)`, `Height (in)`, `Type` `Scupper`, `Metal Scupper`                                                                                                                                                                                                                                                                      |
| `BOM Walk Pad`    | `Pad` `30" x 60" White - Walk Pad`, `60" x 60" White - Walk Pad`, `30" x 60" Gray - Walk Pad`, `60" x 60" Gray - Walk Pad`, `30" x 60" Safety - Walk Pad`, `60" x 60" Safety - Walk Pad`, `30" x 60" Tan - Walk Pad`, `60" x 60" Tan - Walk Pad`, `30"X 60" Safety Fully Skirted Walk Pad`, `30"X 60" White Fully Skirted Walk Pad` |
| `BOM Other Count` | `Name` free text                                                                                                                                                                                                                                                                                                                    |

#### 3.6 Other linears

`BOM Gutter` (`Style`, `Size (in)`), `BOM Expansion Joint`, `BOM Walkway` (linear pad run),
`BOM Other Linear` (`Name`). These land in the bid's "place by hand" list with their footage,
as they do from Bid-O-Matic's own Takeoff, until each gets its own estimator home.

### 4. What Bid-O-Matic reads

Bid-O-Matic will import the PlanSwift **job export** (the same zip-of-`XMLData.XML` shape as
the template export, produced for a job), not a report. From it:

- every `BOM Roof Section` / `BOM Roof Edge` / `BOM Parapet Wall` / count item, with its
  **digitizer points** (page coordinates) and the page's scale, so the outline is rebuilt as
  Bid-O-Matic's own measured section (true area, equivalent rectangle for the sheet layout,
  one edge per drawn side, outside corners marked between perimeter sides), exactly as if it
  had been drawn on the Takeoff page. That is why no quantity formulas are needed in PlanSwift.
- the `BOM Job Setup` inputs as the setup answers.
- If a job export turns out not to carry the points, the fallback is the item list with
  `Area`, `Perimeter`, `Linear Total`, `Count` and the inputs; sections then import as
  equivalent rectangles (same area and perimeter) with the edge defaults on all sides, which
  is what a typed bid is today.

**First thing to send back:** one PlanSwift job export with a single `BOM Roof Section`
drawn on a scaled page, so the importer can be written against the real file. Until that file
is in hand, everything in §4 about points is a plan, not a fact.

### 5. Membrane variations, spelled out

The estimator's membrane rows (the "Duro-Last Membrane" screen, one price per colour):

- Duro-Last 40 mil: Roll Goods, 28" Tabs, 60" Tabs, 120" Tabs, Parapets
- Duro-Last 50 mil: Roll Goods, 28" Tabs, 60" Tabs, Parapets
- Duro-Last 60 mil: Roll Goods, 28" Tabs, 60" Tabs, 120" Tabs, Parapets
- Duro-Fleece 50 mil, 60 mil, 50 mil Plus, 60 mil Plus
- Duro-Bond 40, 50, 60
- Duro-Tuff 50, 60
- Duro-Tech TPO 45, 60, 80
- Non-DL TPO 45, 60, 80
- EPDM Rubber 45, 60, 75, 90

The tier (roll goods vs a tab size vs parapets) is not a PlanSwift input: the estimator picks
it from Sheet Size, Field Tab Spacing and whether the material is on a wall. So the PlanSwift
side needs only System + Mil (+ Plus) + Color + Sheet Size + Tab Spacing, and every variation
above is reachable.

# Part B — the costing version

Part A is the quantities-only set that Bid-O-Matic imports. This part adds cost parts under the
same items so a PlanSwift job can also produce its own number on the spot.

### 1. How to keep it honest

The estimator's numbers come from about forty tables (price list, labor combos, fastener
lookups, adhesive coverage, setup and inspection bands, parapet and curb matrices, shipping
steps, tax, markup). A PlanSwift copy is only right on the day it is written, so the rule is:

1. **Bid-O-Matic is the bid.** The PlanSwift total is a field estimate. Every job still goes
   through the import (`planswift-mapping.md`), and the estimator's total is the one quoted.
2. **Generate, don't transcribe.** The costing templates are built from
   `bid-o-matic-feed.json`, an export of the live tables (Part C of this document;
   later an "Export PlanSwift feed" button on Estimate Pricing, so it can be regenerated after
   every price import). Nothing in the templates is typed from memory.
3. **Fidelity is labelled.** Each rule below is marked **exact** (the estimator's formula on
   the same inputs), **near** (same formula, one simplification), or **rough** (a stand-in
   the estimator does not use). Where a rule is rough, the PlanSwift part carries a note so
   nobody mistakes it for the bid.

### 2. Inputs the costing items need beyond the quantities set

Everything in `planswift-mapping.md` §3, plus on `BOM Job Setup`:

| Input                    | Values / default                                                     | Used by                                 |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------- |
| `Field Fastener OC (in)` | from the pull-test lookup (feed `mech_fastener_lookup`) or typed     | membrane screws, install labor          |
| `Fastener`               | a row of feed `pricing_catalog[duro_last:fasteners_and_bits]`        | screw price (Price/Box ÷ Fasteners/Box) |
| `Plate`                  | a plate row of the same screen                                       | plate price                             |
| `Crew rate ($/h)`        | feed `markup_options.hourly_rate` (45)                               | every labor line                        |
| `Sales tax`              | feed `company_settings.sales_tax_rate` (0.0625), material only       | tax line                                |
| `Markup`                 | feed `markup_options`: gross profit 35 % → price = cost ÷ (1 − 0.35) | price line                              |
| `Hours per man-day`      | feed `company_settings.hours_per_man_day`                            | man-day display                         |

### 3. Geometry PlanSwift must derive

The estimator lays out sheets and rolls on a rectangle with the section's area and perimeter.
From PlanSwift's `[Area]` (A) and `[Perimeter]` (P):

```
half = P / 2
L    = (half + Sqrt(half*half - 4*A)) / 2        ' the longer side
W    = half - L                                   ' the shorter side
AWEO = A + P/2 + 1                                ' = (L+1)(W+1): area with edge overlap
```

If `half*half - 4*A` is negative (a rounder-than-square outline) use `L = W = Sqrt(A)`.

### 4. Roof section parts

#### 4.1 Membrane (exact for roll goods and sheets on a rectangle)

Tier: `Sheet Size` = `Roll Good` → the "Roll Goods" row of the mil; otherwise the row for the
`Field Tab Spacing` (`28" Tabs`, `60" Tabs`, `120" Tabs`). Price = that row's `Color` column of
feed `pricing_catalog[duro_last:duro_last_membrane]` (Duro-Fleece / Duro-Bond / Duro-Tuff /
TPO / EPDM rows are flat per mil; colour columns as present).

Quantity (sq ft with overlap, "MWO"):

- Roll goods: `lap = Int(TabSpacing / 12)` (whole feet); `MWO = AWEO + RoundUp((W+1)/lap * (L+1)) * (LapOver/12)` where `LapOver` = feed `legacy_roof_system.lap_over` (6 for Duro-Last, 3 for Duro-Fleece and EPDM).
- Sheets: `n = RoundUp(AWEO / SheetSqFt)`; `MWO = AWEO + RoundDown(2n − 2*Sqrt(n)) * Sqrt(AWEO / n)`.

Material $ = MWO × price. **Near** for outlines that are not rectangles (the estimator uses the
same equivalent rectangle, so this matches its own Takeoff import); **rough** for Duro-Tuff
mechanical (the estimator lays 30"/60" perimeter rows; use the roll-goods formula).

#### 4.2 Install labor (exact chain)

Mechanical systems (feed `rdl_combos[system/mechanical].data`):

```
hours = MWO / 2500 * 10
      * deck_multipliers[Deck Type]
      * tab multiplier            ' base.tab_multiplier at base.tab_value; other spacings from feed mech_tab_multi (Duro-Last: 28→1.5125, 60→1, 64→1, 120→0.8)
      * fastener_spacing_multipliers[Field Fastener OC]   ' 24:0.91 21:0.96 18:1 15:1.04 12:1.1 9:1.21 6:1.41
      * sheet_size_multipliers[Sheet Size].roof_section   ' Roll Good 4, 500 sf 2.4, 1000 sf 1.2, 1500 sf 1, 2000 sf 0.98, 2500 sf 0.9, 3000 sf 0.82
      * thickness_multipliers[Membrane Mil]               ' 40:1 50:1.15 60:1.25
```

Adhered systems: `hours = MWO / 1000 * adhesive.base_hours_per_1000_sqft_by_substrate[Adhesive] * sheet multiplier * thickness multiplier` (Water Based 5.215, Solvent 6.95, TECH-Bond 13.2, Non-DL TPO 14, EPDM 13.6). Duro-Bond: `base.sheet_layout_hours` (10) per sheet layout. **Near**: the estimator bills the perimeter and corner zones at their own tighter spacing multiplier; a first version bills the whole area at the field spacing (understates labor on small roofs with heavy perimeters by a few percent).

Labor $ = hours × crew rate.

#### 4.3 Membrane fasteners and plates (exact for the row-style systems)

For Duro-Last, Duro-Roof, Duro-Tuff, Duro-Tech TPO, Non-DL TPO, EPDM on a mechanical attachment:

```
rows   = RoundUp((W + 1) / (TabSpacing / 12))
screws = Round(rows * (L + 1) * 12 / FieldFastenerOC)
plates = screws
```

Screw $ = screws × (Price/Box ÷ Fasteners/Box) of the chosen fastener row; plate $ likewise.
**Near**: the estimator adds perimeter-row fasteners at the perimeter spacing; add
`RoundUp(P * 12 / PerimOC)` screws if the job uses a tighter perimeter spacing.

#### 4.4 Underlayment (material exact; labor rough)

Per layer: `sqft = A * 1.03` (`1.06` for Geotextile); material $ = sqft × `Cost/Sq. Ft.`
(feed `pricing_catalog[duro_last:underlayment]`). Boards = `RoundUp(sqft / 32)` for 4×8 boards,
`/ 16` for the `4'x 4'` names. Mechanical layer fasteners: 5 per board (the estimator's default
for a converted legacy layer; its full rule depends on board type and deck and is not in the
feed). Adhesive layer: gallons = `A / coverage_sqft` from feed `adhesive_coverage_deck` (first
layer on the deck) or `adhesive_coverage_underlayment` (a layer on a board group) for the
adhesive id (feed `legacy_adhesive`). Mechanical layer labor (**exact**, Part C §C.9):
`hours = A / 2500 * layout_hours_per_2500sqft[board] + fasteners * minutes_per_fastener[deck] / 60`,
fasteners = `sqft * per_sqft` of the chosen fasteners-per-4×8 option (5 per board = 0.15625
per sq ft is the default); deck names for the minutes table are the parapet-style names
(`Wood`, `Steel`, `Gypsum`, `Tectum`, `Concrete`, `LWC / Other`, `LWC / Steel`,
`LWC / Concrete`, `Metal Retrofit`, `Purlin Fastened`).

#### 4.5 Membrane adhesive, adhered systems (exact)

`units = RoundUp(A / coverage_sqft)` per adhesive from `adhesive_coverage_deck` (bare deck) or
`adhesive_coverage_underlayment` (over the top board's group), summed over sections before the
round-up; price from feed `legacy_adhesive.price` per `unit_type`.

#### 4.6 Vents (exact)

Systems with `needs_vents` = 1 on a mechanical attachment: `RoundUp(A / 1000)` vents per
section; price from `pricing_catalog[duro_last:vents]` by colour; 0.5 h each
(`accessory_labor[vents]`).

### 5. Edge parts (per `BOM Roof Edge` or per section side at the job default)

| Edge option                  | Material                                                                           | Labor (feed `accessory_labor`)                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `T-Bar`                      | ft × `termination_bars[Color]` (per ft)                                            | `termination_bars`: 0.035 h/ft pre-drill, 0.0175 no-drill       |
| `1-3/4" Fascia`, `4" Fascia` | ft × bar price + vinyl / metal cover per ft (`facia_bars_vinyl_covers`)            | `fascia_bars`: 0.0374 / 0.0187 h/ft (1¾"), 0.0395 / 0.0197 (4") |
| `2" Gravel Stop`, `4" …`     | ft × price (`gravel_stops`, colour column) + corners each                          | `gravel_stops`: 0.0275 h/ft, 0.2 h per corner                   |
| `2" Drip Edge`, `4" …`       | ft × price (`drip_edge`, colour column) + clips / corners                          | `drip_edges`: 0.0275 h/ft                                       |
| `3"…8" 2-pc Metal`           | ft × Non-DL sheet metal price (`non_dl:sheet_metal_work`)                          | `two_piece_metals`: 0.043 h/ft, 0.2 h per corner                |
| `ARP (in)`                   | `1.03 * ((ARP + 6) / 12) * ft` sq ft of membrane at the section's roll-goods price | `membrane_accs[ARP (SqFt)]`: 0                                  |
| Wood blocking                | ft × `non_dl:roof_edge_blocking` row price; labor per unit from the same row       | row `LaborPerUnit` × ft at the row's rate                       |

Units, settled from the estimator (**exact**): fascia bar, gravel stop and drip edge prices
are **per foot**; the T-bar price is per foot per colour; vinyl and metal covers are per foot;
corners, clips, covers' inside/outside corners are per piece. Footage is billed as
`RoundToNextTen(RoundUp(1.03 * ft))` (3 % scrap, then up to the next 10 ft) for gravel stop and
drip edge bars and for every labor line; fascia bar material is the plain footage and its
covers are `RoundToNextTen` of the cover footage. Fascia fasteners = `RoundUp(ft / 10 * 21)`.
Pre-drill applies on Concrete, Gypsum and LWC decks.

### 6. Parapets (`BOM Parapet Wall`)

- Material sq ft = `(Length + 1 + Pieces) * Girth / 12`, Girth = skirt + cant + vertical + wall
  top + drop in inches (default skirt 6 + `Height`); price = the mil's `Parapets` row, colour
  column. **Exact.**
- Labor hours = `Length / 50 * rate`, rate from feed `labor_parapet` by `Parapet: Deck`, the
  height band from `Height` (`0"-30"`, `31"-48"`, `49"-72"`, `73"-99"`, `100"+`), and
  pre-drill × canted (`no_drill_no_cant`, `no_drill_canted`, `predrill_no_cant`,
  `predrill_canted`). **Exact.**
- Slipsheet: `Height * Length * 1.25` sq ft × $0.01375 and 0.25 h per 100 sq ft. **Exact.**
- Wall adhesive (adhered walls): sq ft ÷ `adhesive_wall_coverage.coverage_sqft`. **Exact.**

### 7. Curbs (`BOM Curb`)

- Labor minutes per curb = `labor_curb.setup_minutes + labor_curb_deck[Deck].minutes * labor_curb_type[Type].multiplier * PerimeterFt`, Perimeter = `2 * (Width + Length) / 12`; hours = minutes × qty ÷ 60. **Exact.**
- Wrap material = `PerimeterFt * (Height + 6) / 12` sq ft at the mil's `Parapets` row. **Near** (the estimator's wrap model has six legacy styles; this is style 1, Open).
- Curb ISO (if insulated): `RoundUp(Σ Round((Width + Length) / 6, 8) * qty)` sq ft at $0.30 (feed `non_dl:others` row 2). **Exact.**

### 8. Counts

| Item             | Material                                                                                           | Labor                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOM Drain`      | boot (`drain_boots`, + `+ for Color` if coloured) + ring (`cdr_rings`) per drain, 0 if reuse rings | `drain_roof_types[Existing Roof]` area-prep hours + boot hours (`drain_boots` labor) or reinstall hours if reuse. **Exact.**                                        |
| `BOM Pipe Stack` | `pipe_stacks` row by size, colour column (White when the colour has no price)                      | hours per stack = usage factor (`pipe_stack_usages`: Plumbing 0.5, Hot Stack 1, Pitch Pan 1.5) × 1.25 if Open × 1.5 if size > 12 in × 2 if size > 18 in. **Exact.** |
| `BOM Vent`       | see §4.6                                                                                           |                                                                                                                                                                     |
| `BOM Walk Pad`   | `walk_pads_wall_vents` row                                                                         | `accessory_others`: 0.5 h each                                                                                                                                      |
| `BOM Scupper`    | Non-DL sheet metal row                                                                             | row `LaborPerUnit`                                                                                                                                                  |

### 9. Job-level lines (exact)

- Setup hours = `Max(labor_setup.minimum_hours (16), RoofSqFt × labor_setup_steps band multiplier (0.003))`.
- Inspection hours from `labor_inspection_steps` by roof sq ft: 0→5 h, 5,001→7, 10,001→10, 20,001→13, 50,001→16, 100,001→19, 150,001→23.
- Material before tax = every material line. Tax = material × 0.0625 (material only). Shipping from `shipping_steps` by material $: 0→$800, 5,001→975, 7,500→1,050, 10,000→1,100, 15,001→1,200, 20,001→1,300, 40,001→2,000, 80,001→2,600, 120,001→3,300, 170,000→4,000.
- Labor $ = Σ hours × crew rate. Cost = material + tax + shipping + labor. Price at gross profit 35 % = cost ÷ 0.65.

##### 9b. Tear-off (exact)

`hours = A / 100 * tearoff_times[Tear-off type][Deck]` (Part C §C.10; a 0 means the deck is
not torn off that way) plus disposal, which the estimator prices as a Non-DL dumpster line.

### 10. Not modelled in the costing version

Perimeter / corner zone labor and material tiers, Duro-Tuff custom rows,
quote-only boards (Flute Filler, Tapered, ISO-Rigid), complexity factors, high-wind warranty
upcharges, per diem and commission, metals (gutters, coping) beyond 2-pc edge metal, the
Non-DL custom lines. Each of these exists in Bid-O-Matic and is why the import remains the bid.

# Part C — the data (exported 2026-09-25 14:56 UTC)

### C.1 Duro-Last price list (material, $)

#### `duro_last:duro_last_membrane` — Duro-Last Membrane

| Description                  | White | Tan  | Gray | Dark Gray | Terra Cotta | Rock-Ply | Black |
| ---------------------------- | ----- | ---- | ---- | --------- | ----------- | -------- | ----- |
| Duro-Last - 40mil Roll Goods | 1.28  | 1.3  | 1.3  | 1.3       | 1.3         |          |       |
| Duro-Last - 40mil 28" Tabs   | 1.4   | 1.42 | 1.42 | 1.42      | 1.42        |          |       |
| Duro-Last - 40mil 60" Tabs   | 1.33  | 1.34 | 1.34 | 1.34      | 1.34        |          |       |
| Duro-Last - 40mil 120" Tabs  | 1.33  | 1.34 | 1.34 | 1.34      | 1.34        |          |       |
| Duro-Last - 40mil Parapets   | 1.28  | 1.3  | 1.3  | 1.3       | 1.3         |          |       |
| Duro-Last - 50mil Roll Goods | 1.42  | 1.43 | 1.43 | 1.43      | 1.43        | 0        |       |
| Duro-Last - 50mil 28" Tabs   | 1.53  | 1.55 | 1.55 | 1.55      | 1.55        | 0        |       |
| Duro-Last - 50mil 60" Tabs   | 1.46  | 1.48 | 1.48 | 1.48      | 1.48        | 0        |       |
| Duro-Last - 50mil Parapets   | 1.42  | 1.43 | 1.43 | 1.43      | 1.43        | 0        |       |
| Duro-Last - 60mil Roll Goods | 1.55  | 1.57 | 1.57 | 1.57      | 1.57        |          |       |
| Duro-Last - 60mil 28" Tabs   | 1.67  | 1.7  | 1.7  | 1.7       | 1.7         |          |       |
| Duro-Last - 60mil 60" Tabs   | 1.6   | 1.62 | 1.62 | 1.62      | 1.62        |          |       |
| Duro-Last - 60mil 120" Tabs  | 1.6   | 1.62 | 1.62 | 1.62      | 1.62        |          |       |
| Duro-Last - 60mil Parapets   | 1.55  | 1.57 | 1.57 | 1.57      | 1.57        |          |       |
| Duro-Fleece - 50mil Plus     | 2     |      |      |           |             |          |       |
| Duro-Fleece - 60mil Plus     | 226   |      |      |           |             |          |       |
| Duro-Fleece - 50mil          | 1.46  |      |      |           |             |          |       |
| Duro-Fleece - 60mil          | 1.55  |      |      |           |             |          |       |
| Duro-Bond - 40               | 0     | 0    | 0    | 0         |             |          |       |
| Duro-Bond - 50               | 1.14  | 1.29 | 1.29 | 1.29      | 1.29        | 0        |       |
| Duro-Bond - 60               | 1.25  | 1.29 | 1.29 | 1.29      | 1.29        |          |       |
| Duro-Tuff - 50               | 1.14  | 1.29 | 129  | 129       | 1.29        |          |       |
| Duro-Tuff - 60               | 1.25  | 1.29 | 1.29 | 1.29      | 1.29        |          |       |
| Duro-Tech TPO - 45           | 0.75  | 0.75 | 0.75 |           |             |          |       |
| Duro-Tech TPO - 60           | 0.84  | 0.84 | 0.84 |           |             |          |       |
| Duro-Tech TPO - 80           | 1.3   | 1.3  | 1.3  |           |             |          |       |
| Non-DL TPO - 45              |       |      |      |           |             |          |       |
| Non-DL TPO - 60              |       |      |      |           |             |          |       |
| Non-DL TPO - 80              |       |      |      |           |             |          |       |
| EPDM Rubber - 45             |       |      |      |           |             |          |       |
| EPDM Rubber - 60             |       |      |      |           |             |          |       |
| EPDM Rubber - 75             |       |      |      |           |             |          |       |
| EPDM Rubber - 90             |       |      |      |           |             |          |       |

#### `duro_last:underlayment` — Underlayment

| Name                | Cost/Sq. Ft. |
| ------------------- | ------------ |
| 1/4" Dens Deck      | 0.58         |
| 1/2" HD ISO 4'x 4'  | 0.85         |
| 1/2" ISO            | 0.85         |
| 1/2" Rigid 4'x 4'   | 0.85         |
| 1" ISO              | 0.59         |
| 1" ISO 4'x 4'       | 0.59         |
| 1" Rigid            | 0.59         |
| 1" Rigid 4'x 4'     | 0.59         |
| 1/2" DensDeck Prime | 0.7          |
| 1/2" Securock GFRB  | 0            |
| 1/4" DensDeck Prime | 0.7          |
| 1/4" Securock GFRB  | 0            |
| 1 1/2" ISO          | 0.72         |
| 1 1/2" ISO 4'x 4'   | 0.72         |
| 1 1/2" Rigid        | 0.71         |
| 1 1/2" Rigid 4'x 4' | 0.71         |
| 2" ISO              | 0.93         |
| 2" ISO 4'x 4'       | 0.93         |
| 2" Rigid            | 0.93         |
| 2" Rigid 4'x 4'     | 0.93         |
| 2.7" ISO            | 1.42         |
| 2.7" ISO 4'x 4'     | 1.42         |
| 2.7" Rigid          | 1.42         |
| 2.7" Rigid 4'x 4'   | 1.42         |
| 2 1/2" ISO          | 1.38         |
| 2 1/2" ISO 4'x 4'   | 1.38         |
| 2 1/2" Rigid        | 1.38         |
| 2 1/2" Rigid 4'x 4' | 1.38         |
| 3" ISO              | 1.52         |
| 3" ISO 4'x 4'       | 1.52         |
| 3" Rigid            | 1.52         |
| 3" Rigid 4'x 4'     | 1.52         |
| 3/8" Dens Deck      | 0            |
| 3/8" Securock GFRB  | 0            |
| 3 1/2" ISO          | 0            |
| 3 1/2" ISO 4'x 4'   | 0            |
| 3 1/2" Rigid        | 0            |
| 3 1/2" Rigid 4'x 4' | 0            |
| 4" ISO              | 1.29         |
| 4" ISO 4'x 4'       | 0            |
| 4" Rigid            | 0            |
| 4" Rigid 4'x 4'     | 0            |
| 5/8" DensDeck Prime | 0.75         |
| 5/8" F/C Sheet Rock | 0            |
| 5/8" Securock GFRB  | 0            |
| Duro-Blue Slipsheet | 0.0599       |
| Duro-Fold           | 0.3          |
| Duro-Weave          | 0.07         |
| FR 10               | 0.27         |
| FR 50               | 0.54         |
| Geotextile          | 0.11         |
| Ultra-Fold          | 0.31         |

#### `duro_last:fasteners_and_bits` — Fasteners & Bits

| Part #   | Subtype         | Description                  | Price/Box | Fasteners/Box |
| -------- | --------------- | ---------------------------- | --------- | ------------- |
| 1241     |                 | Metal Anchors                | 255       | 1000          |
| 1751     | Auger           | 2"                           | 374.5     | 500           |
| 1752     | Auger           | 2 1/2"                       | 379.5     | 500           |
| 1753     | Auger           | 3"                           | 402       | 500           |
| 1754     | Auger           | 3 1/2"                       | 429.5     | 500           |
| 1755     | Auger           | 4"                           | 431.5     | 500           |
| 1756     | Auger           | 4 1/2"                       | 453       | 500           |
| 1757     | Auger           | 5"                           | 478       | 500           |
| 1758     | Auger           | 5 1/2"                       | 483.5     | 500           |
| 1759     | Auger           | 6"                           | 498       | 500           |
| 1760     | Auger           | 6 1/2"                       | 510       | 500           |
| 1761     | Auger           | 7"                           | 263       | 250           |
| 1762     | Auger           | 7 1/2"                       | 308       | 250           |
| 1763     | Auger           | 8"                           | 338.5     | 250           |
| 1764     | Auger           | 8 1/2"                       | 373.5     | 250           |
| 1765     | Auger           | 9"                           | 380       | 250           |
| 1766     | Auger           | 10"                          | 422.5     | 250           |
| 1767     | Auger           | 1/2" Bit -                   | 10.4      | 1             |
| 1749     | Auger           | 1/4" Auger Bit(Square Drive) | 4.9       | 1             |
| 1629     | Bit-SDS         | 3/16"x8" SDS                 | 8.15      | 1             |
| 1635     | Bit-SDS         | 3/16"x8 1/2" SDS             | 11.65     | 1             |
| 1630     | Bit-SDS         | 3/16"x10" SDS                | 16.5      | 1             |
| 1640     | Bit-SDS         | 3/16"x12" SDS                | 20.35     | 1             |
| 1641     | Bit-SDS         | 7/16"x6" SDS                 | 11        | 1             |
| 1642     | Bit-SDS         | 7/16"x12" SDS                | 15.35     | 1             |
| 1268     | Bit-SDS         | 1/4"x4" SDS                  | 7.75      | 1             |
| 1269     | Bit-SDS         | 1/2"x6" SDS                  | 15.35     | 1             |
| 1270     | Bit-SDS         | 1/2"x10" SDS                 | 19.93     | 1             |
| 1644     | Bit-SDS         | 7/32"x12" SDS                | 200.75    | 1             |
| 1645     | Bit-SDS         | 7/32"x16" SDS                | 30.9      | 1             |
| 1643     | Bit-SDS         | 1/4"x6" SDS                  | 8.15      | 1             |
| 1632     | Bit-Straight    | 3/16"x3" Straight            | 3.9       | 1             |
| 1633     | Bit-Straight    | 3/16"x6" Straight            | 5.35      | 1             |
| 1804     | Bit-Straight    | 3/16"x12" Straight           | 21.75     | 1             |
| 1631     | Bit-Straight    | 7/32"x6" Straight            | 6.15      | 1             |
| 1637     | Bit-Straight    | 7/32"x12" Straight           | 45.53     | 1             |
| 1266     | Bit-Straight    | 1/4"x4" Straight             | 4.45      | 1             |
| 1271     | Bit-Straight    | 1/2"x6" Straight             | 13.45     | 1             |
| 1272     | Bit-Straight    | 1/2"x12" Straight            | 22.65     | 1             |
| 1267     | Bit-Straight    | 7/16"x6" Straight            | 11.18     | 1             |
| 1730     | Bit-TE-CX       | 3/16"x6 1/2" TE-CX           | 10.99     | 1             |
| 1731     | Bit-TE-CX       | 3/16"x8" TE-CX               | 13.34     | 1             |
| 1732     | Bit-TE-CX       | 3/16"x12" TE-CX              | 37.61     | 1             |
| 1733     | Bit-TE-CX       | 3/16"x16" TE-CX              | 39.17     | 1             |
| 1734     | Bit-TE-CX       | 1/4"x4" TE-CX                | 12.54     | 1             |
| 1735     | Bit-TE-CX       | 1/4"x6" TE-CX                | 13.69     | 1             |
| 1736     | Bit-TE-CX       | 1/4"x8" TE-CX                | 15.59     | 1             |
| 1637     | Bit-TE-CX       | 1/4"x12" TE-CX               | 45.53     | 1             |
| 1265     | SD-Tips         | 2" P3 Style Long             | 2.35      | 1             |
| 1264     | SD-Tips         | 2" Square Drive #3           | 2.7       | 1             |
| 1470     | Concrete Screw  | 1 1/4"                       | 106       | 1000          |
| 1471     | Concrete Screw  | 1 3/4"                       | 123       | 1000          |
| 1472     | Concrete Screw  | 2 1/4"                       | 143       | 1000          |
| 1473     | Concrete Screw  | 2 3/4"                       | 159       | 1000          |
| 1474     | Concrete Screw  | 3 1/4"                       | 194       | 1000          |
| 1475     | Concrete Screw  | 3 3/4"                       | 210       | 1000          |
| 1476     | Concrete Screw  | 4 1/4"                       | 263       | 1000          |
| 1477     | Concrete Screw  | 5"                           | 334       | 1000          |
| 1478     | Concrete Screw  | 5 1/2"                       | 385       | 1000          |
| 1479     | Concrete Screw  | 6"                           | 403       | 1000          |
| 1480     | Concrete Screw  | 6 1/2"                       | 238       | 500           |
| 1481     | Concrete Screw  | 7"                           | 253       | 500           |
| 1482     | Concrete Screw  | 7 1/2"                       | 279       | 500           |
| 1483     | Concrete Screw  | 8"                           | 307       | 500           |
| 1484     | Concrete Screw  | 9"                           | 429       | 500           |
| 1485     | Concrete Screw  | 10"                          | 497.5     | 500           |
| 1486     | Concrete Screw  | 11"                          | 559       | 500           |
| 1487     | Concrete Screw  | 12"                          | 603       | 500           |
| 1305P    | DL-Plates       | 2" Poly Plates               | 290       | 1000          |
| 1300S    | DL-Plates       | 3" Square Steel              | 190       | 500           |
| 1305I    | DL-Plates       | 3" Insulation Plates         | 240       | 1000          |
| 1299     | DL-Plates       | 2" Barbed Steel              | 217.5     | 1000          |
| 1304     | DL-Plates       | Metal Cleat Plates           | 470       | 1000          |
| 1306     | DL-Plates       | Induction Welding Plates     | 465       | 500           |
| 1243     | Stainless       | 1 5/8" #12                   | 598       | 1000          |
| 1442     | Spade           | 1 1/2"                       | 208       | 2000          |
| 1446     | Spade           | 2"                           | 242       | 2000          |
| 1456     | Spade           | 2 1/2"                       | 159       | 1000          |
| 1447     | Spade           | 3"                           | 175       | 1000          |
| 1457     | Spade           | 3 1/2"                       | 194       | 1000          |
| 1448     | Spade           | 4"                           | 230       | 1000          |
| 1458     | Spade           | 4 1/2"                       | 298       | 1000          |
| 1449     | Spade           | 5"                           | 315       | 1000          |
| 1459     | Spade           | 5 1/2"                       | 385       | 1000          |
| 1450     | Spade           | 6"                           | 403       | 1000          |
| 1451     | Spade           | 7"                           | 253       | 500           |
| 1452     | Spade           | 8"                           | 279       | 500           |
| 1253     | Spade           | 9"                           | 385       | 500           |
| 1254     | Spade           | 10"                          | 447       | 500           |
| 1255     | Spade           | 11"                          | 498       | 500           |
| 1256     | Spade           | 12"                          | 542       | 500           |
| 1361     | Drill Point     | 1 1/2"                       | 208       | 2000          |
| 1362     | Drill Point     | 2"                           | 242       | 2000          |
| 1363     | Drill Point     | 2 1/2"                       | 159       | 1000          |
| 1364     | Drill Point     | 3"                           | 175       | 1000          |
| 1365     | Drill Point     | 3 1/2"                       | 194       | 1000          |
| 1366     | Drill Point     | 4"                           | 230       | 1000          |
| 1367     | Drill Point     | 4 1/2"                       | 298       | 1000          |
| 1368     | Drill Point     | 5"                           | 315       | 1000          |
| 1369     | Drill Point     | 5 1/2"                       | 385       | 1000          |
| 1370     | Drill Point     | 6"                           | 403       | 1000          |
| 1371     | Drill Point     | 7"                           | 253       | 500           |
| 1372     | Drill Point     | 8"                           | 279       | 500           |
| 1373     | Drill Point     | 9"                           | 385       | 500           |
| 1374     | Drill Point     | 10"                          | 447       | 500           |
| 1375     | Drill Point     | 11"                          | 498       | 500           |
| 1376     | Drill Point     | 12"                          | 542       | 500           |
| 1444     | Hex Head        | 1 1/4"                       | 242       | 2000          |
| 1378     | XHD             | 2"                           | 210       | 1000          |
| 1379     | XHD             | 3"                           | 263       | 1000          |
| 1380     | XHD             | 4"                           | 298       | 1000          |
| 1381     | XHD             | 5"                           | 385       | 1000          |
| 1382     | XHD             | 6"                           | 246       | 500           |
| 1383     | XHD             | 7"                           | 342       | 500           |
| 1384     | XHD             | 8"                           | 378       | 500           |
| 1385     | XHD             | 9"                           | 298       | 250           |
| 1386     | XHD             | 10"                          | 318.5     | 250           |
| 1387     | XHD             | 11"                          | 328       | 250           |
| 1388     | XHD             | 12"                          | 406       | 250           |
| 1257     | XHD             | 14"                          | 447       | 250           |
| 1258     | XHD             | 16"                          | 494       | 250           |
| 1259     | XHD             | 18"                          | 634       | 250           |
| 1260     | XHD             | 20"                          | 768       | 250           |
| 1620     | Nail            | 1 1/2"                       | 194       | 500           |
| 1621     | Nail            | 2"                           | 230       | 500           |
| 1622     | Nail            | 2 1/2"                       | 246       | 500           |
| 1623     | Nail            | 3"                           | 133       | 500           |
| 1624     | Nail            | 3 1/2"                       | 149       | 500           |
| 1625     | Nail            | 4"                           | 175       | 500           |
| 1626     | Nail            | 4 1/2"                       | 186       | 500           |
| 1627     | Nail            | 5"                           | 202       | 500           |
| 1619     | Nail            | 5 1/2"                       | 230       | 500           |
| 1628     | Nail            | 6"                           | 246       | 500           |
| 1638     | Nail            | 7"                           | 298       | 500           |
| 1639     | Nail            | 8"                           | 482       | 500           |
| 1628-009 | Nail            | 9"                           | 246       | 250           |
| 1628-010 | Nail            | 10"                          | 290       | 250           |
| 1628-011 | Nail            | 11"                          | 307       | 250           |
| 1628-012 | Nail            | 12"                          | 429       | 250           |
| RN001    | Roofing Nails   | 1 1/2"                       | 46.78     | 2160          |
| NTB15    | NTB             | 2"                           | 149.5     | 500           |
| NTB01    | NTB             | 2 1/2"                       | 77.63     | 500           |
| NTB02    | NTB             | 3"                           | 83.38     | 500           |
| NTB03    | NTB             | 3 1/2"                       | 89.13     | 500           |
| NTB04    | NTB             | 4"                           | 92        | 500           |
| NTB05    | NTB             | 4 1/2"                       | 97.75     | 500           |
| NTB06    | NTB             | 5"                           | 100.63    | 500           |
| NTB07    | NTB             | 5 1/2"                       | 106.38    | 500           |
| NTB08    | NTB             | 6"                           | 109.25    | 500           |
| NTB09    | NTB             | 6 1/2"                       | 115       | 500           |
| NTB10    | NTB             | 7"                           | 117.88    | 500           |
| NTB11    | NTB             | 7 1/2"                       | 123.63    | 500           |
| NTB12    | NTB             | 8"                           | 129.38    | 500           |
| NTB13    | NTB             | 8 1/2"                       | 135.13    | 500           |
| NTB14    | NTB             | 9"                           | 140.88    | 500           |
| NTB16    | NTB             | 10"                          | 155.25    | 500           |
| NTB17    | NTB             | Bit (Hex Driver)             | 14.38     | 1             |
| PL1      | Purlin          | 2 3/4"                       | 259       | 1000          |
| PL2      | Purlin          | 3 3/4"                       | 375       | 1000          |
| PL3      | Purlin          | 4 3/4"                       | 397       | 1000          |
| PL4      | Purlin          | 5 3/4"                       | 413       | 1000          |
| PL5      | Purlin          | 6 3/4"                       | 659       | 1000          |
| PL6      | Purlin          | 7 3/4"                       | 349.5     | 500           |
| 1278-001 | Collated Screws | 1 1/2"                       | 91        | 1000          |

#### `duro_last:termination_bars` — Termination Bars

| Description | Part # | Price |
| ----------- | ------ | ----- |
| White       | 1225   | 0.75  |
| Tan         | 1225B  | 0.9   |
| Gray        | 1225G  | 0.9   |

#### `duro_last:facia_bars_vinyl_covers` — Facia Bars/Vinyl Covers

| Description          | Part # | Price |
| -------------------- | ------ | ----- |
| 1 3/4" Fascia Bar    | 1568   | 2.5   |
| White Vinyl Cover    | 1569   | 1.9   |
| Tan Vinyl Cover      | 1569B  | 1.9   |
| Gray Vinyl Cover     | 1574   | 1.9   |
| Metal Cover          | 2537   | 3     |
| Metal Outside Corner | 2515   | 26.95 |
| Metal Inside Corner  | 2517   | 26.95 |
| 4" Fascia Bar        | 1571   | 3.7   |
| White Vinyl Cover    | 1572   | 3.7   |
| Tan Vinyl Cover      | 1572B  | 4.35  |
| Gray Vinyl Cover     | 1578   | 4.35  |
| Metal Cover          | 2543   | 3.6   |
| Metal Outside Corner | 2545   | 30.15 |
| Metal Inside Corner  | 2547   | 30.15 |

#### `duro_last:gravel_stops` — Gravel Stops

| Description                   | Part # | White Price | Tan Price | Gray Price |
| ----------------------------- | ------ | ----------- | --------- | ---------- |
| Gravel Stop 2"                | 1226   | 4.3         | 5.05      | 5.05       |
| Gravel Stop 2" Clip           | 1613   | 2.1         | 2.1       | 2.1        |
| Gravel Stop 2" Corner         | 1614   | 12.25       | 15.15     | 15.15      |
| Gravel Stop 2" Cover          | 2525   | 3.2         | 3.2       | 3.2        |
| Gravel Stop 2" Outside Corner | 2527   | 26.8        | 26.8      | 26.8       |
| Gravel Stop 2" Inside Corner  | 2529   | 26.8        | 26.8      | 26.8       |
| Gravel Stop 4"                | 1587   | 5.05        | 5.8       | 5.8        |
| Gravel Stop 4" Clip           | 1588   | 2.1         | 2.1       | 2.1        |
| Gravel Stop 4" Corner         | 1589   | 14.45       | 17.25     | 17.25      |
| Gravel Stop 4" Cover          | 2554   | 3.85        | 3.85      | 3.85       |
| Gravel Stop 4" Outside Corner | 2555   | 29.6        | 29.6      | 29.6       |
| Gravel Stop 4" Inside Corner  | 2556   | 29.6        | 29.6      | 29.6       |

#### `duro_last:drip_edge` — Drip Edge

| Description         | Part # | White Price | Tan Price | Gray Price |
| ------------------- | ------ | ----------- | --------- | ---------- |
| Drip Edge 2"        | 1220   | 8.4         | 9.98      | 9.98       |
| Drip Edge 2" Clip   | 1228   | 0           | 0         | 0          |
| Drip Edge 2" Corner | 1558   | 0           | 0         | 0          |
| Drip Edge 4"        | 1583   | 9.6         | 11.08     | 11.08      |
| Drip Edge 4" Clip   | 1584   | 0           | 0         | 0          |
| Drip Edge 4" Corner | 1585   | 0           | 0         | 0          |

#### `duro_last:corners` — Corners

| Description               | Part #  | White | Tan   | Gray  | Dark Gray | Terra Cotta |
| ------------------------- | ------- | ----- | ----- | ----- | --------- | ----------- |
| Inside 6" x 6"            | 1311    | 4.75  | 5.75  | 5.75  | 5.75      | 1.2         |
| Inside 6" x 18"           | 1313    | 7.35  | 8.35  | 8.35  | 8.35      | 13.7        |
| Outside 6" x 6"           | 1312    | 6.55  | 7.55  | 7.55  | 7.55      | 12.55       |
| Outside 6" x 18"          | 1314    | 8.3   | 9.3   | 9.3   | 9.3       | 15.6        |
| Outside 18" x 12"         | 1309    | 13.85 | 14.85 | 14.85 | 14.85     | 17.25       |
| Outside Butterfly 6" x 6" | 1312 BF | 7.9   | 8.9   | 8.9   | 8.9       | 13.35       |

#### `duro_last:pipe_stacks` — Pipe Stacks

| Description      | Size | Open Part # | Closed Part # | Price | Tan Price | Gray Price | Dark Gray | Terra Cotta | Rock Ply |
| ---------------- | ---- | ----------- | ------------- | ----- | --------- | ---------- | --------- | ----------- | -------- |
| 1" Closed Only   | 1    | 0           | 1315          | 12.55 | 13.55     | 13.55      | 13.55     | 16.95       |          |
| 1.5" Closed/Open | 1.5  | 2315H       | 1315H         | 15.25 | 16.25     | 16.25      | 16.25     | 16.95       | 0        |
| 2" Closed/Open   | 2    | 2316        | 1316          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 3" Closed/Open   | 3    | 2317        | 1317          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 4" Closed/Open   | 4    | 2318        | 1318          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 5" Closed/Open   | 5    | 2319        | 1319          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 6" Closed/Open   | 6    | 2320        | 1320          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 7" Closed/Open   | 7    | 2321        | 1321          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 8" Closed/Open   | 8    | 2322        | 1322          | 15.25 | 16.25     | 16.25      | 16.25     | 17.85       |          |
| 9" Closed/Open   | 9    | 2323        | 1323          | 18.85 | 19.85     | 19.85      | 19.85     | 21.65       |          |
| 10" Closed/Open  | 10   | 2324        | 1324          | 18.85 | 19.85     | 19.85      | 19.85     | 21.65       |          |
| 11" Closed/Open  | 11   | 2325        | 1325          | 18.85 | 19.85     | 19.85      | 19.85     | 21.65       |          |
| 12" Closed/Open  | 12   | 2326        | 1326          | 23.35 | 24.35     | 24.35      | 24.35     | 24.8        |          |
| 13" Closed/Open  | 13   | 2327        | 1327          | 23.35 | 24.35     | 24.35      | 2435      | 24.8        |          |
| 14" Closed/Open  | 14   | 2328        | 1328          | 23.35 | 24.35     | 24.35      | 24.35     | 24.8        |          |
| 15" Closed/Open  | 15   | 2329        | 1329          | 23.35 | 24.35     | 24.35      | 24.35     | 24.8        |          |
| 16" Open Only    | 16   | 0           | 0             | 57.75 | 58.75     | 58.75      | 58.75     | 59.75       |          |
| 18" Open Only    | 18   | 0           | 0             | 59.11 | 60.11     | 60.11      | 60.11     | 61.11       |          |
| 20" Open Only    | 20   | 0           | 0             | 60.46 | 61.46     | 61.46      | 61.46     | 62.46       |          |
| 22" Open Only    | 22   | 0           | 0             | 61.82 | 62.82     | 62.82      | 62.82     | 63.82       |          |
| 24" Open Only    | 24   | 0           | 0             | 63.17 | 64.17     | 64.17      | 64.17     | 65.17       |          |
| 26" Open Only    | 26   | 0           | 0             | 60    | 61        | 61         | 61        | 62          |          |
| 28" Open Only    | 28   | 0           | 0             | 61    | 62        | 62         | 62        | 63          |          |
| 30" Open Only    | 30   | 0           | 0             | 63    | 64        | 64         | 64        | 65          |          |
| 32" Open Only    | 32   | 0           | 0             | 65    | 66        | 66         | 66        | 67          |          |
| 34" Open Only    | 34   | 0           | 0             | 68    | 69        | 69         | 69        | 70          |          |
| 36" Open Only    | 36   | 0           | 0             | 70    | 71        | 71         | 71        | 72          |          |
| 38" Open Only    | 38   | 0           | 0             | 72    | 73        | 73         | 73        | 74          |          |
| 40" Open Only    | 40   | 0           | 0             | 74    | 75        | 75         | 75        | 76          |          |
| 42" Open Only    | 42   | 0           | 0             | 76    | 77        | 77         | 77        | 78          |          |
| 44" Open Only    | 44   | 0           | 0             | 78    | 79        | 79         | 79        | 80          |          |

#### `duro_last:drain_boots` — Drain Boots

| Description       | Part # | Price | + for Color |
| ----------------- | ------ | ----- | ----------- |
| 2" Drain Boot     | 1916   | 22.4  | 23.4        |
| 2 1/2" Drain Boot | 1916H  | 22.4  | 23.4        |
| 3" Drain Boot     | 1917   | 22.4  | 23.4        |
| 3 1/2" Drain Boot | 1917H  | 22.4  | 23.4        |
| 4" Drain Boot     | 1918   | 22.4  | 23.4        |
| 4 1/2" Drain Boot | 1918H  | 22.4  | 23.4        |
| 5" Drain Boot     | 1922   | 22.4  | 23.4        |
| 5 1/2" Drain Boot | 1922H  | 22.4  | 23.4        |
| 6" Drain Boot     | 1921   | 22.4  | 23.4        |
| 6 1/2" Drain Boot | 1921H  | 22.4  | 23.4        |
| 7" Drain Boot     | 1923   | 22.4  | 23.4        |
| 7 1/2" Drain Boot | 1923H  | 22.4  | 23.4        |
| 8" Drain Boot     | 1924   | 22.4  | 23.4        |

#### `duro_last:cdr_rings` — CDR Rings

| Description        | Part # | Price |
| ------------------ | ------ | ----- |
| 2" Drain Rings     | 1536   | 17.5  |
| 2 1/2" Drain Ring  | 1536H  | 17.5  |
| 3" Drain Rings     | 1537   | 17.5  |
| 3 1/2" Drain Rings | 1537H  | 18.25 |
| 4" Drain Rings     | 1538   | 18.25 |
| 4 1/2" Drain Rings | 1538H  | 18.25 |
| 5" Drain Rings     | 1539   | 19.25 |
| 5 1/2" Drain Rings | 1539H  | 20.85 |
| 6" Drain Rings     | 1540   | 20.85 |
| 6 1/2" Drain Rings | 1540H  | 21.75 |
| 7" Drain Rings     | 1541   | 22.65 |
| 7 1/2" Drain Rings | 1541H  | 27.75 |
| 8" Drain Rings     | 1542   | 30    |

#### `duro_last:drain_boot_accessories` — Drain Boot Accessories

| Description             | Part # | Price |
| ----------------------- | ------ | ----- |
| 3" - 4" PVC Drains      | 1518   | 68.6  |
| 3"-5" Black Leaf Grates | 1820   | 19    |
| Dome Strainer           | 1830   | 75.6  |
| 2" Drain Adapter        | 1543   | 16.35 |
| Drain Guard White       | 18301  | 75.6  |

#### `duro_last:vents` — Vents

| Description      | Part # | Price |
| ---------------- | ------ | ----- |
| Tan Vent         | 1231   | 28.25 |
| Gray Vent        | 1231   | 28.25 |
| White Vent       | 1231   | 28.25 |
| Dark Gray Vent   | 1231   | 28.25 |
| Terra Cotta Vent | 1231   | 32    |
| Rock Ply Vent    | 1231   | 0     |

#### `duro_last:walk_pads_wall_vents` — Walk Pads & Wall Vents

| Description                            | Part # | Price |
| -------------------------------------- | ------ | ----- |
| 30" x 60" White - Walk Pad             | 1080   | 28.8  |
| 60" x 60" White - Walk Pad             | 1082   | 52    |
| 30" x 60" Gray - Walk Pad              | 1084   | 28.8  |
| 60" x 60" Gray - Walk Pad              | 1085   | 52    |
| 30" x 60" Safety - Walk Pad            | 1086   | 29.5  |
| 60" x 60" Safety - Walk Pad            | 1087   | 54    |
| White Parapet Wall Vent                | 1235   | 39    |
| Tan Parapet Wall Vent                  | 1235G  | 40    |
| Gray Parapet Wall Vent                 | 1235B  | 40    |
| 30" x 60" Tan - Walk Pad               | 1081   | 28.8  |
| 60" x 60" Tan - Walk Pad               | 1083   | 52    |
| 30"X 60" Safety Fully Skirted Walk Pad | 1355   | 40.05 |
| 30"X 60" White Fully Skirted Walk Pad  | 1356   | 40.05 |

#### `duro_last:conduit_washers` — Conduit Washers

| Description         | Part # | Price |
| ------------------- | ------ | ----- |
| 1/2" Conduit Washer | 1338   | 3.65  |
| 3/4" Conduit Washer | 1337   | 3.65  |
| 1" Conduit Washer   | 1336   | 3.65  |

#### `duro_last:sealants` — Sealants

| Description                   | Part # | Price  |
| ----------------------------- | ------ | ------ |
| Duro-Caulk - White            | 1116   | 10.2   |
| Duro-Caulk - Tan              | 1116B  | 10.2   |
| Duro-Caulk - Gray             | 1114   | 10.2   |
| Duro-Caulk - Bronze           | 1115   | 10.2   |
| Paraseal - White              | 1126   | 10.2   |
| Paraseal - Tan                | 1126B  | 10.2   |
| Paraseal - Gray               | 1124   | 10.2   |
| Paraseal - Bronze             | 1125   | 10.2   |
| Strip Mastic (Pail)           | 1129   | 149.15 |
| Pitch Pocket Filler (10.2 oz) | 1121   | 10.7   |
| Pitch Pocket Filler (30 oz)   | 1122   | 29.5   |
| SB-240 Mastic (5 gallon pail) | 1123   | 271.7  |
| Duro-Caulk Plus - White       | 1136   | 10.2   |
| Duro-Caulk Plus - Tan         | 1138   | 10.2   |
| Duro-Caulk Plus - Gray        | 1134   | 10.2   |
| Duro-Caulk Plus - Bronze      | 1135   | 10.2   |
| Tab Sealer                    | 1119T  | 210    |

#### `duro_last:membrane_accs` — Membrane Accs

| Description | Part # | Parts/Package | Price/Package |
| ----------- | ------ | ------------- | ------------- |
| ARP (SqFt)  | 1001   | 1             | 4             |
| T-Patch     | 8067   | 50            | 7.1           |

#### `duro_last:panduit` — Panduit

| Description  | Part # | Parts/Bag | Price/Part |
| ------------ | ------ | --------- | ---------- |
| 3/8" x 14"   | 1222   | 50        | 0.88       |
| 3/8" x 20"   | 1222P  | 50        | 1.3        |
| Panduit Tool | 1221   | 1         | 239        |

### C.2 Non-DL price list (material $ per unit, labor per unit in hours, labor rate $/h; 0 rate = crew rate)

#### `non_dl:roof_edge_blocking` — Roof Edge Blocking

| Description            | Price | LaborPerUnit | Labor Rate |
| ---------------------- | ----- | ------------ | ---------- |
| ½" Wood Blocking       | 0     | 0            | 45         |
| ¾" Wood Blocking       | 0     | 0            | 45         |
| 5/4" Wood Blocking     | 0     | 0            | 45         |
| 2" Wood Blocking       | 0     | 0            | 45         |
| 2" x 6" x 12'          | 8.99  | 0.25         | 45         |
| 2" x 6" x 12' Treated  | 14.29 | 0.25         | 45         |
| 2" x 8" x 12'          | 19.78 | 0.25         | 45         |
| 2" x 8" x 12' Treated  | 17.89 | 0.25         | 45         |
| 2" x 10" x 12'         | 18.12 | 0.25         | 45         |
| 2" x 10" x 12' Treated | 23.39 | 0.25         | 45         |
| 2" x 12" x 12'         | 17.95 | 0.25         | 45         |
| 2" x 12" x 12' Treated | 29.59 | 0.25         | 45         |
| 1" x 4" x 12'          | 13.97 | 0.25         | 45         |
| 1" x 6" x 12'          | 11.18 | 0.25         | 45         |
| 1" x 8" x 12'          | 13.28 | 0.25         | 45         |
| 1" x 10" x 12'         | 18.72 | 0.25         | 45         |
| 1" x 12" x 12'         | 18.71 | 0.25         | 45         |
| 5/4 " x 12'            | 15.08 | 0.25         | 45         |
| 2" x 4" x 12'          | 6.48  | 0.25         | 45         |
| 2" x 4" x 12' Treated  | 10.38 | 0.25         | 45         |

#### `non_dl:parapet_wall_blocking` — Parapet Wall Blocking

| Description                | Price | LaborPerUnit | Labor Rate |
| -------------------------- | ----- | ------------ | ---------- |
| 2" x 4" W/ 8" ISO          | 0.57  | 0.04         | 40         |
| Tear Off                   | 0     | 0            | 0          |
| Drip Edge 10'              | 9.39  | 0            | 0          |
| Ice & Water 66'            | 74.5  | 1            | 0          |
| Ice & Water HT 66'         | 120   | 1            | 0          |
| Synthetic Underlayment     | 76.5  | 1            | 0          |
| Starter Shingle 100'       | 55    | 0            | 0          |
| Shingle ( Per Bundle )     | 41    | 0            | 0          |
| Ridge Cap 30'              | 75    | 0            | 0          |
| Ridge Vent 4' W/Nails      | 14    | 0            | 0          |
| Coil Nails ( 1 Box 18SQ )  | 51.5  | 0            | 0          |
| Valley Metal ( 20" X 10' ) | 33    | 0            | 0          |
| Step Flashing per ft       | 0.75  | 0            | 0          |
| Stack Boot                 | 22.13 | 0            | 0          |
| 1 Tube Black Jack          | 3.26  | 0            | 0          |
| Cap Nails                  | 33    | 0            | 0          |
| Paint                      | 8.5   | 0            | 0          |

#### `non_dl:sheet_metal_work` — Sheet Metal Work

| Description              | Price  | LaborPerUnit | Labor Rate |
| ------------------------ | ------ | ------------ | ---------- |
| Curb Counter Flashing    | 4      | 0.0167       | 45         |
| Reglet Flashing          | 4.3    | 0.25         | 45         |
| Retro Edge               | 0      | 0            | 45         |
| Exspansion Joints        | 30     | 0.35         | 45         |
| Inside Miters            | 110    | 0.35         | 45         |
| Outside Miters           | 110    | 0.35         | 45         |
| Flat Coping Cap          | 17.98  | 0.2          | 45         |
| Snap Coping Cap          | 27.38  | 0.2          | 45         |
| Canted Coping Cap        | 19.03  | 0.2          | 45         |
| Reglet Flashing 2-piece  | 9.35   | 0.5          | 45         |
| White 4 X 10 Sheet       | 209.2  | 0            | 0          |
| 3' Edge Extender         | 3.15   | 0.15         | 45         |
| 4" Edge Extender & Cleat | 5.55   | 0.2          | 45         |
| 5" Edge Extender & Cleat | 5.75   | 0.2          | 45         |
| 6" Edge Extender & Cleat | 6.05   | 0.2          | 45         |
| 7" Edge Extender & Cleat | 6.45   | 0.2          | 45         |
| 8" Edge Extender & Cleat | 6.75   | 0.2          | 45         |
| Surface Mt. Counter      | 4      | 0.15         | 45         |
| Duro - Flash per FT      | 6.85   | 0            | 45         |
| Parapet Vents Metal      | 160.85 | 0            | 45         |
| ATR Hub 8x8x14           | 374.35 | 0            | 0          |
| ATR Hub 8x8x30           | 465.2  | 0            | 0          |

#### `non_dl:structural_deck_materials` — Structural Deck Materials

| Description         | Price | LaborPerUnit | Labor Rate |
| ------------------- | ----- | ------------ | ---------- |
| Structural Steel    | 0     | 0            | 45         |
| Plywood Deck ¾"     | 21.89 | 0.35         | 45         |
| Plywood Deck 5/8"   | 21.85 | 0.35         | 45         |
| Plywood Deck ½"     | 12.58 | 0.35         | 45         |
| Tectum 32" x 96"    | 0     | 0            | 45         |
| Tectum Sq Ft        | 4.25  | 0            | 45         |
| 1/2 Plywood Treated | 23.48 | 0.35         | 45         |
| 3/4 Plywood Treated | 59.99 | 0.35         | 45         |
| 5/8 Plywood Treated | 53.68 | 0.35         | 45         |

#### `non_dl:masonry` — Masonry

| Description       | Price | LaborPerUnit | Labor Rate |
| ----------------- | ----- | ------------ | ---------- |
| Remove Only       | 0     | 0.1          | 45         |
| Mortar Mix        | 0     | 0.3          | 45         |
| Replace Capstones | 0     | 0            | 45         |

#### `non_dl:3rd_party_services` — 3rd Party Services

| Description    | Price | LaborPerUnit | Labor Rate |
| -------------- | ----- | ------------ | ---------- |
| Crane          | 0     | 0            | 150        |
| Landfill       | 0     | 1            | 85         |
| Dumpster       | 850   | 0            | 45         |
| Vacuum Service | 30    | 0            | 45         |
| Set Up Charge  | 0     | 0            | 45         |

#### `non_dl:subcontractors` — Subcontractors

| Description | Price | LaborPerUnit | Labor Rate |
| ----------- | ----- | ------------ | ---------- |
| HVAC        | 0     | 0            | 45         |
| Sheet Metal | 0     | 0            | 45         |
| Masonry     | 0     | 0            | 45         |
| Guttering   | 8.5   | 0            | 45         |

#### `non_dl:preset_custom_applications` — Preset Custom Applications

| Description               | Price  | LaborPerUnit | Labor Rate |
| ------------------------- | ------ | ------------ | ---------- |
| Plentum Parapet wall vent | 160.85 | 1.5          | 45         |
| Standard Roof Hatch       | 1200   | 10           | 45         |
| Hatch With Rails          | 2500   | 15           | 45         |
| Straight up Ladder        | 3500   | 20           | 45         |
| Ladder W/ Platform &      | 4200   | 30           | 45         |

#### `non_dl:others` — Others

| Description           | Price   | LaborPerUnit | Labor Rate |
| --------------------- | ------- | ------------ | ---------- |
| DL Approved Slipsheet | 0.01375 | 0            | 0          |
| Curbs 1 1/2" ISO      | 0.3     | 0            | 0          |

### C.3 Adhesives

| adhesive_id | short_name           | long_name                           | part_number | price  | unit_type        | field_spacing_in | perim_spacing_in | used_with_wall |
| ----------- | -------------------- | ----------------------------------- | ----------- | ------ | ---------------- | ---------------- | ---------------- | -------------- |
| 1           | waterbasedadhesive   | Water Based Adhesive                | 1111        | 122.1  | 5-gal. Bucket    | -1               | -1               | 1              |
| 2           | solventbasedadhesive | Solvent Based Adhesive              | 1112-010    | 141.75 | 5-gal. Bucket    | -1               | -1               | 0              |
| 3           | dfadhesive2part      | Duro-Fleece Adhesive(2-boxes)       | 1107        | 394.9  | 5-gal. Box Set   | 12               | 6                | 0              |
| 4           | dfadhesivecart       | Duro-Fleece Adhesive(cartridge)     | 1106        | 1561.5 | 4-Cartridge Case | 12               | 6                | 0              |
| 5           | durogrip             | Duro-Grip Adhesive(CR-20)           | 1109        | 486.75 | 5-gal. Box Set   | 12               | 6                | 0              |
| 6           | olybondbaginbox      | OlyBond500 Bag-in-Box               | 1108        | 394.25 | 5-gal. Box Set   | 12               | 6                | 0              |
| 7           | olybondspotshot      | OlyBond500 SpotShot                 | 1106        | 156.2  | 4-Cartridge Case | 12               | 6                | 0              |
| 8           | milonestep           | Millenium One Step                  | 1105        | 125.45 | 5-gal. Box Set   | 12               | 6                | 0              |
| 9           | milpg1boxes          | Millenium PG1 Boxes                 | 1130        | 398.75 | 5-gal. Box Set   | 12               | 6                | 0              |
| 10          | milpg1drums          | Millenium PG1 Drums                 |             | 2457   | 50-Gal Drum Set  | 12               | 6                | 0              |
| 11          | techbondtpo          | TECH-Bond TPO Bonding Adhesive      |             | 0      | 5-gal. Pail      | -1               | -1               | 1              |
| 12          | techbondtpolvoc      | TECH-Bond TPO LVOC Bonding Adhesive |             | 0      | 5-gal. Pail      | -1               | -1               | 1              |
| 13          | techbondtpospray     | TECH-Bond TPO Spray Adhesive        |             | 0      | Cylinder         | -1               | -1               | 1              |
| 14          | ndltpobond           | Non-DL TPO Bonding Adhesive         |             | 0      | 5-gal. Pail      | -1               | -1               | 1              |
| 15          | ndltpospray          | Non-DL TPO Spray Adhesive           |             | 0      | Cylinder         | -1               | -1               | 1              |
| 16          | epdmbond             | EPDM Bonding Adhesive               |             | 0      | 5-gal. Pail      | -1               | -1               | 1              |
| 17          | epdmspray            | EPDM Spray Adhesive                 |             | 0      | Cylinder         | -1               | -1               | 1              |

#### Coverage on a bare deck (sq ft per unit; deck_type_id follows the section deck order 0 Wood … 9 Purlin; roof_system_id per C.4)

| adhesive_id | roof_system_id | deck_type_id | coverage_sqft | default_value | custom_value |
| ----------- | -------------- | ------------ | ------------- | ------------- | ------------ |
| 5           | 0              | 1            | 2000          | 6.5           | 0            |
| 5           | 0              | 2            | 2000          | 6.5           | 0            |
| 5           | 0              | 4            | 2000          | 6.5           | 0            |
| 5           | 0              | 5            | 2000          | 6.5           | 0            |
| 5           | 0              | 6            | 2000          | 6.5           | 0            |
| 5           | 0              | 7            | 2000          | 6.5           | 0            |
| 5           | 0              | 8            | 2000          | 6.5           | 0            |
| 5           | 0              | 9            | 2000          | 6.5           | 0            |
| 6           | 0              | 1            | 1700          | 6.5           | 0            |
| 6           | 0              | 2            | 1000          | 6.5           | 0            |
| 6           | 0              | 4            | 1700          | 6.5           | 0            |
| 6           | 0              | 5            | 1000          | 6.5           | 0            |
| 6           | 0              | 6            | 1300          | 6.5           | 0            |
| 6           | 0              | 7            | 1300          | 6.5           | 0            |
| 6           | 0              | 8            | 1300          | 6.5           | 0            |
| 6           | 0              | 9            | 1000          | 6.5           | 0            |
| 7           | 0              | 1            | 600           | 6.5           | 0            |
| 7           | 0              | 2            | 600           | 6.5           | 0            |
| 7           | 0              | 4            | 600           | 6.5           | 0            |
| 7           | 0              | 5            | 600           | 6.5           | 0            |
| 7           | 0              | 6            | 600           | 6.5           | 0            |
| 7           | 0              | 7            | 600           | 6.5           | 0            |
| 7           | 0              | 8            | 600           | 6.5           | 0            |
| 7           | 0              | 9            | 600           | 6.5           | 0            |
| 8           | 0              | 1            | 600           | 6.5           | 0            |
| 8           | 0              | 2            | 600           | 6.5           | 0            |
| 8           | 0              | 4            | 600           | 6.5           | 0            |
| 8           | 0              | 5            | 600           | 6.5           | 0            |
| 8           | 0              | 6            | 600           | 6.5           | 0            |
| 8           | 0              | 7            | 600           | 6.5           | 0            |
| 8           | 0              | 8            | 600           | 6.5           | 0            |
| 8           | 0              | 9            | 600           | 6.5           | 0            |
| 9           | 0              | 1            | 2000          | 6.5           | 0            |
| 9           | 0              | 2            | 2000          | 6.5           | 0            |
| 9           | 0              | 4            | 2000          | 6.5           | 0            |
| 9           | 0              | 5            | 2000          | 6.5           | 0            |
| 9           | 0              | 6            | 2000          | 6.5           | 0            |
| 9           | 0              | 7            | 2000          | 6.5           | 0            |
| 9           | 0              | 8            | 2000          | 6.5           | 0            |
| 9           | 0              | 9            | 2000          | 6.5           | 0            |
| 10          | 0              | 1            | 20000         | 6.5           | 0            |
| 10          | 0              | 2            | 20000         | 6.5           | 0            |
| 10          | 0              | 4            | 20000         | 6.5           | 0            |
| 10          | 0              | 5            | 20000         | 6.5           | 0            |
| 10          | 0              | 6            | 20000         | 6.5           | 0            |
| 10          | 0              | 7            | 20000         | 6.5           | 0            |
| 10          | 0              | 8            | 20000         | 6.5           | 0            |
| 10          | 0              | 9            | 20000         | 6.5           | 0            |
| 1           | 1              | 1            | 700           | 0             | 0            |
| 1           | 1              | 4            | 700           | 0             | 0            |
| 2           | 1              | 1            | 300           | 0             | 0            |
| 2           | 1              | 4            | 300           | 0             | 0            |
| 1           | 3              | 1            | 700           | 0             | 0            |
| 1           | 3              | 4            | 700           | 0             | 0            |
| 2           | 3              | 1            | 300           | 0             | 0            |
| 2           | 3              | 4            | 300           | 0             | 0            |
| 1           | 5              | 1            | 500           | 0             | 0            |
| 1           | 5              | 4            | 500           | 0             | 0            |
| 3           | 5              | 1            | 1700          | 0             | 0            |
| 3           | 5              | 4            | 1700          | 0             | 0            |
| 3           | 5              | 5            | 1000          | 0             | 0            |
| 3           | 5              | 6            | 1000          | 0             | 0            |
| 3           | 5              | 7            | 1000          | 0             | 0            |
| 3           | 5              | 8            | 1000          | 0             | 0            |
| 4           | 5              | 1            | 500           | 0             | 0            |
| 4           | 5              | 4            | 500           | 0             | 0            |
| 4           | 5              | 5            | 500           | 0             | 0            |
| 4           | 5              | 6            | 500           | 0             | 0            |
| 4           | 5              | 7            | 500           | 0             | 0            |
| 4           | 5              | 8            | 500           | 0             | 0            |
| 5           | 5              | 1            | 2000          | 0             | 0            |
| 5           | 5              | 4            | 2000          | 0             | 0            |
| 5           | 5              | 5            | 2000          | 0             | 0            |
| 5           | 5              | 6            | 2000          | 0             | 0            |
| 5           | 5              | 7            | 2000          | 0             | 0            |
| 5           | 5              | 8            | 2000          | 0             | 0            |
| 6           | 5              | 1            | 1700          | 0             | 0            |
| 6           | 5              | 4            | 1700          | 0             | 0            |
| 6           | 5              | 5            | 1000          | 0             | 0            |
| 6           | 5              | 6            | 1000          | 0             | 0            |
| 6           | 5              | 7            | 1000          | 0             | 0            |
| 6           | 5              | 8            | 1000          | 0             | 0            |
| 7           | 5              | 1            | 500           | 0             | 0            |
| 7           | 5              | 4            | 500           | 0             | 0            |
| 7           | 5              | 5            | 500           | 0             | 0            |
| 7           | 5              | 6            | 500           | 0             | 0            |
| 7           | 5              | 7            | 500           | 0             | 0            |
| 7           | 5              | 8            | 500           | 0             | 0            |
| 11          | 6              | 1            | 300           | 0             | 0            |
| 11          | 6              | 2            | 300           | 0             | 0            |
| 11          | 6              | 3            | 300           | 0             | 0            |
| 11          | 6              | 4            | 300           | 0             | 0            |
| 11          | 6              | 5            | 300           | 0             | 0            |
| 11          | 6              | 6            | 300           | 0             | 0            |
| 11          | 6              | 7            | 300           | 0             | 0            |
| 11          | 6              | 8            | 300           | 0             | 0            |
| 11          | 6              | 9            | 300           | 0             | 0            |
| 11          | 6              | 10           | 300           | 0             | 0            |
| 12          | 6              | 1            | 300           | 0             | 0            |
| 13          | 6              | 1            | 1000          | 0             | 0            |
| 12          | 6              | 2            | 300           | 0             | 0            |
| 13          | 6              | 2            | 1000          | 0             | 0            |
| 12          | 6              | 3            | 300           | 0             | 0            |
| 13          | 6              | 3            | 1000          | 0             | 0            |
| 12          | 6              | 4            | 300           | 0             | 0            |
| 13          | 6              | 4            | 1000          | 0             | 0            |
| 12          | 6              | 5            | 300           | 0             | 0            |
| 13          | 6              | 5            | 1000          | 0             | 0            |
| 12          | 6              | 6            | 300           | 0             | 0            |
| 13          | 6              | 6            | 1000          | 0             | 0            |
| 12          | 6              | 7            | 300           | 0             | 0            |
| 13          | 6              | 7            | 1000          | 0             | 0            |
| 12          | 6              | 8            | 300           | 0             | 0            |
| 13          | 6              | 8            | 1000          | 0             | 0            |
| 12          | 6              | 9            | 300           | 0             | 0            |
| 13          | 6              | 9            | 1000          | 0             | 0            |
| 12          | 6              | 10           | 300           | 0             | 0            |
| 13          | 6              | 10           | 1000          | 0             | 0            |
| 14          | 7              | 1            | 300           | 0             | 0            |
| 14          | 7              | 2            | 300           | 0             | 0            |
| 14          | 7              | 3            | 300           | 0             | 0            |
| 14          | 7              | 4            | 300           | 0             | 0            |
| 14          | 7              | 5            | 300           | 0             | 0            |
| 14          | 7              | 6            | 300           | 0             | 0            |
| 14          | 7              | 7            | 300           | 0             | 0            |
| 14          | 7              | 8            | 300           | 0             | 0            |
| 14          | 7              | 9            | 300           | 0             | 0            |
| 14          | 7              | 10           | 300           | 0             | 0            |
| 17          | 8              | 1            | 1000          | 0             | 0            |
| 17          | 8              | 2            | 1000          | 0             | 0            |
| 17          | 8              | 3            | 1000          | 0             | 0            |
| 17          | 8              | 4            | 1000          | 0             | 0            |
| 17          | 8              | 5            | 1000          | 0             | 0            |
| 17          | 8              | 6            | 1000          | 0             | 0            |
| 17          | 8              | 7            | 1000          | 0             | 0            |
| 17          | 8              | 8            | 1000          | 0             | 0            |
| 17          | 8              | 9            | 1000          | 0             | 0            |
| 17          | 8              | 10           | 1000          | 0             | 0            |
| 15          | 7              | 1            | 1000          | 0             | 0            |
| 15          | 7              | 2            | 1000          | 0             | 0            |
| 15          | 7              | 3            | 1000          | 0             | 0            |
| 15          | 7              | 4            | 1000          | 0             | 0            |
| 15          | 7              | 5            | 1000          | 0             | 0            |
| 15          | 7              | 6            | 1000          | 0             | 0            |
| 15          | 7              | 7            | 1000          | 0             | 0            |
| 15          | 7              | 8            | 1000          | 0             | 0            |
| 15          | 7              | 9            | 1000          | 0             | 0            |
| 15          | 7              | 10           | 1000          | 0             | 0            |
| 16          | 8              | 1            | 300           | 0             | 0            |
| 16          | 8              | 2            | 300           | 0             | 0            |
| 16          | 8              | 3            | 300           | 0             | 0            |
| 16          | 8              | 4            | 300           | 0             | 0            |
| 16          | 8              | 5            | 300           | 0             | 0            |
| 16          | 8              | 6            | 300           | 0             | 0            |
| 16          | 8              | 7            | 300           | 0             | 0            |
| 16          | 8              | 8            | 300           | 0             | 0            |
| 16          | 8              | 9            | 300           | 0             | 0            |
| 16          | 8              | 10           | 300           | 0             | 0            |

#### Coverage over an underlayment group

| adhesive_id | roof_system_id | underlayment_group_id | coverage_sqft | default_value | custom_value |
| ----------- | -------------- | --------------------- | ------------- | ------------- | ------------ |
| 5           | 0              | 2                     | 2000          | 6.5           | 0            |
| 5           | 0              | 3                     | 2000          | 6.5           | 0            |
| 5           | 0              | 4                     | 2000          | 6.5           | 0            |
| 5           | 0              | 7                     | 2000          | 6.5           | 0            |
| 5           | 0              | 8                     | 2000          | 6.5           | 0            |
| 5           | 0              | 12                    | 2000          | 6.5           | 0            |
| 5           | 0              | 13                    | 2000          | 6.5           | 0            |
| 5           | 0              | 17                    | 2000          | 6.5           | 0            |
| 5           | 0              | 16                    | 0             | 0             | 0            |
| 5           | 0              | 18                    | 0             | 0             | 0            |
| 5           | 0              | 19                    | 0             | 0             | 0            |
| 6           | 0              | 2                     | 1700          | 6.5           | 0            |
| 6           | 0              | 3                     | 1700          | 6.5           | 0            |
| 6           | 0              | 4                     | 1700          | 6.5           | 0            |
| 6           | 0              | 7                     | 1700          | 6.5           | 0            |
| 6           | 0              | 8                     | 1700          | 6.5           | 0            |
| 6           | 0              | 10                    | 1500          | 6.5           | 0            |
| 6           | 0              | 11                    | 1500          | 6.5           | 0            |
| 6           | 0              | 12                    | 1500          | 6.5           | 0            |
| 6           | 0              | 15                    | 1700          | 6.5           | 0            |
| 6           | 0              | 17                    | 1700          | 6.5           | 0            |
| 6           | 0              | 16                    | 0             | 0             | 0            |
| 6           | 0              | 18                    | 0             | 0             | 0            |
| 6           | 0              | 19                    | 0             | 0             | 0            |
| 7           | 0              | 2                     | 600           | 6.5           | 0            |
| 7           | 0              | 3                     | 600           | 6.5           | 0            |
| 7           | 0              | 4                     | 600           | 6.5           | 0            |
| 7           | 0              | 7                     | 600           | 6.5           | 0            |
| 7           | 0              | 8                     | 600           | 6.5           | 0            |
| 7           | 0              | 10                    | 600           | 6.5           | 0            |
| 7           | 0              | 11                    | 600           | 6.5           | 0            |
| 7           | 0              | 12                    | 600           | 6.5           | 0            |
| 7           | 0              | 15                    | 600           | 6.5           | 0            |
| 7           | 0              | 17                    | 600           | 6.5           | 0            |
| 7           | 0              | 16                    | 0             | 0             | 0            |
| 7           | 0              | 18                    | 0             | 0             | 0            |
| 7           | 0              | 19                    | 0             | 0             | 0            |
| 8           | 0              | 2                     | 600           | 6.5           | 0            |
| 8           | 0              | 3                     | 600           | 6.5           | 0            |
| 8           | 0              | 4                     | 600           | 6.5           | 0            |
| 8           | 0              | 7                     | 600           | 6.5           | 0            |
| 8           | 0              | 8                     | 600           | 6.5           | 0            |
| 8           | 0              | 10                    | 600           | 6.5           | 0            |
| 8           | 0              | 11                    | 600           | 6.5           | 0            |
| 8           | 0              | 12                    | 600           | 6.5           | 0            |
| 8           | 0              | 13                    | 600           | 6.5           | 0            |
| 8           | 0              | 17                    | 600           | 6.5           | 0            |
| 8           | 0              | 16                    | 0             | 0             | 0            |
| 8           | 0              | 18                    | 0             | 0             | 0            |
| 8           | 0              | 19                    | 0             | 0             | 0            |
| 9           | 0              | 2                     | 2000          | 6.5           | 0            |
| 9           | 0              | 3                     | 2000          | 6.5           | 0            |
| 9           | 0              | 4                     | 2000          | 6.5           | 0            |
| 9           | 0              | 7                     | 2000          | 6.5           | 0            |
| 9           | 0              | 8                     | 2000          | 6.5           | 0            |
| 9           | 0              | 10                    | 2000          | 6.5           | 0            |
| 9           | 0              | 11                    | 2000          | 6.5           | 0            |
| 9           | 0              | 12                    | 2000          | 6.5           | 0            |
| 9           | 0              | 13                    | 2000          | 6.5           | 0            |
| 9           | 0              | 17                    | 2000          | 6.5           | 0            |
| 9           | 0              | 16                    | 0             | 0             | 0            |
| 9           | 0              | 18                    | 0             | 0             | 0            |
| 9           | 0              | 19                    | 0             | 0             | 0            |
| 10          | 0              | 2                     | 20000         | 6.5           | 0            |
| 10          | 0              | 3                     | 20000         | 6.5           | 0            |
| 10          | 0              | 4                     | 20000         | 6.5           | 0            |
| 10          | 0              | 7                     | 20000         | 6.5           | 0            |
| 10          | 0              | 8                     | 20000         | 6.5           | 0            |
| 10          | 0              | 10                    | 20000         | 6.5           | 0            |
| 10          | 0              | 11                    | 20000         | 6.5           | 0            |
| 10          | 0              | 12                    | 20000         | 6.5           | 0            |
| 10          | 0              | 13                    | 20000         | 6.5           | 0            |
| 10          | 0              | 17                    | 20000         | 6.5           | 0            |
| 10          | 0              | 16                    | 0             | 0             | 0            |
| 10          | 0              | 18                    | 0             | 0             | 0            |
| 10          | 0              | 19                    | 0             | 0             | 0            |
| 1           | 1              | 2                     | 700           | 0             | 0            |
| 1           | 1              | 3                     | 700           | 0             | 0            |
| 1           | 1              | 7                     | 700           | 0             | 0            |
| 1           | 1              | 8                     | 700           | 0             | 0            |
| 1           | 1              | 16                    | 0             | 0             | 0            |
| 2           | 1              | 2                     | 300           | 0             | 0            |
| 2           | 1              | 3                     | 300           | 0             | 0            |
| 2           | 1              | 7                     | 300           | 0             | 0            |
| 2           | 1              | 8                     | 300           | 0             | 0            |
| 2           | 1              | 16                    | 0             | 0             | 0            |
| 1           | 5              | 2                     | 500           | 0             | 0            |
| 1           | 5              | 3                     | 500           | 0             | 0            |
| 1           | 5              | 7                     | 500           | 0             | 0            |
| 1           | 5              | 8                     | 500           | 0             | 0            |
| 1           | 5              | 16                    | 0             | 0             | 0            |
| 3           | 5              | 2                     | 1700          | 0             | 0            |
| 3           | 5              | 3                     | 1700          | 0             | 0            |
| 3           | 5              | 7                     | 1700          | 0             | 0            |
| 3           | 5              | 8                     | 1700          | 0             | 0            |
| 3           | 5              | 10                    | 1500          | 0             | 0            |
| 3           | 5              | 11                    | 1500          | 0             | 0            |
| 3           | 5              | 12                    | 1500          | 0             | 0            |
| 3           | 5              | 16                    | 0             | 0             | 0            |
| 4           | 5              | 2                     | 500           | 0             | 0            |
| 4           | 5              | 3                     | 500           | 0             | 0            |
| 4           | 5              | 7                     | 500           | 0             | 0            |
| 4           | 5              | 8                     | 500           | 0             | 0            |
| 4           | 5              | 10                    | 500           | 0             | 0            |
| 4           | 5              | 11                    | 500           | 0             | 0            |
| 4           | 5              | 12                    | 500           | 0             | 0            |
| 4           | 5              | 16                    | 0             | 0             | 0            |
| 5           | 5              | 2                     | 2000          | 0             | 0            |
| 5           | 5              | 3                     | 2000          | 0             | 0            |
| 5           | 5              | 7                     | 2000          | 0             | 0            |
| 5           | 5              | 8                     | 2000          | 0             | 0            |
| 5           | 5              | 10                    | 2000          | 0             | 0            |
| 5           | 5              | 12                    | 2000          | 0             | 0            |
| 5           | 5              | 16                    | 0             | 0             | 0            |
| 6           | 5              | 2                     | 1700          | 0             | 0            |
| 6           | 5              | 3                     | 1700          | 0             | 0            |
| 6           | 5              | 7                     | 1700          | 0             | 0            |
| 6           | 5              | 8                     | 1700          | 0             | 0            |
| 6           | 5              | 10                    | 1500          | 0             | 0            |
| 6           | 5              | 11                    | 1500          | 0             | 0            |
| 6           | 5              | 12                    | 1500          | 0             | 0            |
| 6           | 5              | 16                    | 0             | 0             | 0            |
| 7           | 5              | 2                     | 500           | 0             | 0            |
| 7           | 5              | 3                     | 500           | 0             | 0            |
| 7           | 5              | 7                     | 500           | 0             | 0            |
| 7           | 5              | 8                     | 500           | 0             | 0            |
| 7           | 5              | 10                    | 500           | 0             | 0            |
| 7           | 5              | 11                    | 500           | 0             | 0            |
| 7           | 5              | 12                    | 500           | 0             | 0            |
| 7           | 5              | 16                    | 0             | 0             | 0            |
| 1           | 3              | 2                     | 700           | 0             | 0            |
| 1           | 3              | 3                     | 700           | 0             | 0            |
| 1           | 3              | 7                     | 700           | 0             | 0            |
| 1           | 3              | 8                     | 700           | 0             | 0            |
| 1           | 3              | 16                    | 0             | 0             | 0            |
| 2           | 3              | 2                     | 300           | 0             | 0            |
| 2           | 3              | 3                     | 300           | 0             | 0            |
| 2           | 3              | 7                     | 300           | 0             | 0            |
| 2           | 3              | 8                     | 300           | 0             | 0            |
| 2           | 3              | 16                    | 0             | 0             | 0            |
| 11          | 6              | 2                     | 300           | 0             | 0            |
| 11          | 6              | 3                     | 300           | 0             | 0            |
| 11          | 6              | 4                     | 300           | 0             | 0            |
| 11          | 6              | 7                     | 300           | 0             | 0            |
| 11          | 6              | 8                     | 300           | 0             | 0            |
| 11          | 6              | 17                    | 300           | 0             | 0            |
| 11          | 6              | 16                    | 0             | 0             | 0            |
| 11          | 6              | 18                    | 0             | 0             | 0            |
| 11          | 6              | 19                    | 0             | 0             | 0            |
| 12          | 6              | 2                     | 300           | 0             | 0            |
| 13          | 6              | 2                     | 1000          | 0             | 0            |
| 12          | 6              | 3                     | 300           | 0             | 0            |
| 13          | 6              | 3                     | 1000          | 0             | 0            |
| 12          | 6              | 4                     | 300           | 0             | 0            |
| 13          | 6              | 4                     | 1000          | 0             | 0            |
| 12          | 6              | 7                     | 300           | 0             | 0            |
| 13          | 6              | 7                     | 1000          | 0             | 0            |
| 12          | 6              | 8                     | 300           | 0             | 0            |
| 13          | 6              | 8                     | 1000          | 0             | 0            |
| 12          | 6              | 17                    | 300           | 0             | 0            |
| 13          | 6              | 17                    | 1000          | 0             | 0            |
| 12          | 6              | 16                    | 0             | 0             | 0            |
| 13          | 6              | 16                    | 0             | 0             | 0            |
| 12          | 6              | 18                    | 0             | 0             | 0            |
| 13          | 6              | 18                    | 0             | 0             | 0            |
| 12          | 6              | 19                    | 0             | 0             | 0            |
| 13          | 6              | 19                    | 0             | 0             | 0            |
| 14          | 7              | 2                     | 300           | 0             | 0            |
| 14          | 7              | 3                     | 300           | 0             | 0            |
| 14          | 7              | 4                     | 300           | 0             | 0            |
| 14          | 7              | 7                     | 300           | 0             | 0            |
| 14          | 7              | 8                     | 300           | 0             | 0            |
| 14          | 7              | 17                    | 300           | 0             | 0            |
| 14          | 7              | 16                    | 0             | 0             | 0            |
| 14          | 7              | 18                    | 0             | 0             | 0            |
| 14          | 7              | 19                    | 0             | 0             | 0            |
| 15          | 7              | 2                     | 1000          | 0             | 0            |
| 15          | 7              | 3                     | 1000          | 0             | 0            |
| 15          | 7              | 4                     | 1000          | 0             | 0            |
| 15          | 7              | 7                     | 1000          | 0             | 0            |
| 15          | 7              | 8                     | 1000          | 0             | 0            |
| 15          | 7              | 17                    | 1000          | 0             | 0            |
| 15          | 7              | 16                    | 0             | 0             | 0            |
| 15          | 7              | 18                    | 0             | 0             | 0            |
| 15          | 7              | 19                    | 0             | 0             | 0            |
| 16          | 8              | 2                     | 300           | 0             | 0            |
| 16          | 8              | 3                     | 300           | 0             | 0            |
| 16          | 8              | 4                     | 300           | 0             | 0            |
| 16          | 8              | 7                     | 300           | 0             | 0            |
| 16          | 8              | 8                     | 300           | 0             | 0            |
| 16          | 8              | 17                    | 300           | 0             | 0            |
| 16          | 8              | 16                    | 0             | 0             | 0            |
| 16          | 8              | 18                    | 0             | 0             | 0            |
| 16          | 8              | 19                    | 0             | 0             | 0            |
| 17          | 8              | 2                     | 1000          | 0             | 0            |
| 17          | 8              | 3                     | 1000          | 0             | 0            |
| 17          | 8              | 4                     | 1000          | 0             | 0            |
| 17          | 8              | 7                     | 1000          | 0             | 0            |
| 17          | 8              | 8                     | 1000          | 0             | 0            |
| 17          | 8              | 17                    | 1000          | 0             | 0            |
| 17          | 8              | 16                    | 0             | 0             | 0            |
| 17          | 8              | 18                    | 0             | 0             | 0            |
| 17          | 8              | 19                    | 0             | 0             | 0            |

#### Wall coverage

| adhesive_id | roof_system_id | coverage_sqft |
| ----------- | -------------- | ------------- |
| 1           | 1              | 350           |
| 2           | 1              | 300           |
| 5           | 0              | -1            |
| 6           | 0              | -1            |
| 7           | 0              | -1            |
| 8           | 0              | -1            |
| 9           | 0              | -1            |
| 10          | 0              | -1            |
| 1           | 5              | -1            |
| 3           | 5              | -1            |
| 4           | 5              | -1            |
| 5           | 5              | -1            |
| 6           | 5              | -1            |
| 7           | 5              | -1            |
| 1           | 3              | -1            |
| 2           | 3              | -1            |
| 11          | 6              | 300           |
| 12          | 6              | 300           |
| 13          | 6              | 1000          |
| 14          | 7              | 300           |
| 17          | 8              | 1000          |
| 15          | 7              | 1000          |
| 16          | 8              | 300           |

#### Adhesive labor, hours per 1,000 sq ft

| adhesive_id | roof_system_id | hours_per_ksqft | custom_hours |
| ----------- | -------------- | --------------- | ------------ |
| 5           | 0              | 5.8408          | 0            |
| 6           | 0              | 5.215           | 0            |
| 7           | 0              | 7.822           | 0            |
| 8           | 0              | 7.822           | 0            |
| 9           | 0              | 5.215           | 0            |
| 10          | 0              | 5.215           | 0            |
| 1           | 1              | 5.215           | 0            |
| 2           | 1              | 6.95            | 0            |
| 1           | 3              | 5.215           | 0            |
| 2           | 3              | 6.95            | 0            |
| 1           | 5              | 5.215           | 0            |
| 3           | 5              | 5.215           | 0            |
| 4           | 5              | 5.215           | 0            |
| 5           | 5              | 5.8408          | 0            |
| 6           | 5              | 5.215           | 0            |
| 7           | 5              | 5.215           | 0            |

#### Underlayment groups and boards

| underlayment_group_id | description        | sort_option |
| --------------------- | ------------------ | ----------- |
| 1                     | Slip Sheets        | 1           |
| 2                     | ISO 4'x8'          | 2           |
| 3                     | ISO 4'x4'          | 3           |
| 4                     | EPO/XPS 4'x8'      | 4           |
| 5                     | Flute Filler       | 6           |
| 6                     | Fire Rated Mat     | 7           |
| 7                     | DensDeck/Securock  | 8           |
| 8                     | DensDeck Prime     | 9           |
| 9                     | Gypsum Board       | 10          |
| 10                    | Smooth Mod-Bit     | 11          |
| 11                    | Granulated Mod-Bit | 12          |
| 12                    | Smooth Built-Up    | 13          |
| 13                    | Graveled Built-Up  | 14          |
| 14                    | Perlite            | 15          |
| 15                    | Spray Foam         | 16          |
| 16                    | Tapered ISO        | 17          |
| 17                    | EPO/XPS 4'x4'      | 5           |
| 18                    | Tapered Rigid      | 18          |
| 19                    | Crickets/Other     | 19          |

| board_name          | underlayment_group_id | subtype | need_quote | sort | subtype_sort |
| ------------------- | --------------------- | ------- | ---------- | ---- | ------------ |
| Duro-Blue Slipsheet | 1                     | 1       | no         | 1    | 3            |
| Duro-Weave          | 1                     | 1       | no         | 2    | 5            |
| Geotextile          | 1                     | 1       | no         | 3    | 4            |
| Duro-Fold           | 1                     | 1       | no         | 4    | 1            |
| Ultra-Fold          | 1                     | 1       | no         | 5    | 2            |
| 1/2" ISO            | 2                     | 2       | no         | 1    | 1            |
| 1" ISO              | 2                     | 2       | no         | 2    | 2            |
| 1 1/2" ISO          | 2                     | 2       | no         | 3    | 3            |
| 2" ISO              | 2                     | 2       | no         | 4    | 4            |
| 2 1/2" ISO          | 2                     | 2       | no         | 5    | 5            |
| 2.7" ISO            | 2                     | 2       | no         | 6    | 6            |
| 3" ISO              | 2                     | 2       | no         | 7    | 7            |
| 3 1/2" ISO          | 2                     | 2       | no         | 8    | 8            |
| 4" ISO              | 2                     | 2       | no         | 9    | 9            |
| 1" Rigid            | 4                     | 3       | no         | 1    | 1            |
| 1 1/2" Rigid        | 4                     | 3       | no         | 2    | 2            |
| 2" Rigid            | 4                     | 3       | no         | 3    | 3            |
| 2 1/2" Rigid        | 4                     | 3       | no         | 4    | 4            |
| 2.7" Rigid          | 4                     | 3       | no         | 5    | 5            |
| 3" Rigid            | 4                     | 3       | no         | 6    | 6            |
| 3 1/2" Rigid        | 4                     | 3       | no         | 7    | 7            |
| 4" Rigid            | 4                     | 3       | no         | 8    | 8            |
| FR 10               | 6                     | 5       | no         | 1    | 1            |
| FR 50               | 6                     | 5       | no         | 2    | 2            |
| 1/4" Dens Deck      | 7                     | 5       | no         | 1    | 3            |
| 3/8" Dens Deck      | 7                     | 5       | no         | 2    | 4            |
| 1/4" Securock GFRB  | 7                     | 5       | no         | 3    | 8            |
| 3/8" Securock GFRB  | 7                     | 5       | no         | 4    | 9            |
| 1/2" Securock GFRB  | 7                     | 5       | no         | 5    | 10           |
| 5/8" Securock GFRB  | 7                     | 5       | no         | 6    | 11           |
| 1/4" DensDeck Prime | 8                     | 5       | no         | 1    | 5            |
| 1/2" DensDeck Prime | 8                     | 5       | no         | 2    | 6            |
| 5/8" DensDeck Prime | 8                     | 5       | no         | 3    | 7            |
| 5/8" F/C Sheet Rock | 9                     | 5       | no         | 1    | 12           |
| 1/2" HD ISO 4'x 4'  | 3                     | 7       | no         | 1    | 1            |
| 1" ISO 4'x 4'       | 3                     | 7       | no         | 2    | 2            |
| 1 1/2" ISO 4'x 4'   | 3                     | 7       | no         | 3    | 3            |
| 2" ISO 4'x 4'       | 3                     | 7       | no         | 4    | 4            |
| 2 1/2" ISO 4'x 4'   | 3                     | 7       | no         | 5    | 5            |
| 2.7" ISO 4'x 4'     | 3                     | 7       | no         | 6    | 6            |
| 3" ISO 4'x 4'       | 3                     | 7       | no         | 7    | 7            |
| 3 1/2" ISO 4'x 4'   | 3                     | 7       | no         | 8    | 8            |
| 4" ISO 4'x 4'       | 3                     | 7       | no         | 9    | 9            |
| 1/2" Rigid 4'x 4'   | 17                    | 8       | no         | 1    | 1            |
| 1" Rigid 4'x 4'     | 17                    | 8       | no         | 2    | 2            |
| 1 1/2" Rigid 4'x 4' | 17                    | 8       | no         | 3    | 3            |
| 2" Rigid 4'x 4'     | 17                    | 8       | no         | 4    | 4            |
| 2 1/2" Rigid 4'x 4' | 17                    | 8       | no         | 5    | 5            |
| 2.7" Rigid 4'x 4'   | 17                    | 8       | no         | 6    | 6            |
| 3" Rigid 4'x 4'     | 17                    | 8       | no         | 7    | 7            |
| 3 1/2" Rigid 4'x 4' | 17                    | 8       | no         | 8    | 8            |
| 4" Rigid 4'x 4'     | 17                    | 8       | no         | 9    | 9            |
| ISO Quote 4'x 8'    | 2                     | 2       | yes        | 99   | 10           |
| Rigid Quote 4'x 8'  | 4                     | 3       | yes        | 99   | 9            |
| ISO Quote 4'x 4'    | 3                     | 7       | yes        | 99   | 10           |
| Rigid Quote 4'x 4'  | 17                    | 8       | yes        | 99   | 10           |
| Flute Filler        | 5                     | 4       | yes        | 99   | 1            |
| Tapered Perlite     | 14                    | 6       | yes        | 99   | 1            |
| Tapered Crickets    | 19                    | 6       | yes        | 99   | 2            |
| Other               | 19                    | 6       | yes        | 99   | 3            |
| Tapered ISO         | 16                    | 6       | yes        | 99   | 4            |
| Tapered EPS         | 18                    | 6       | yes        | 99   | 5            |

### C.4 Roof systems

| roof_system_id | short_name  | long_name     | lap_over | needs_vents | is_insulation | mech_wall_fasteners | sort_order |
| -------------- | ----------- | ------------- | -------- | ----------- | ------------- | ------------------- | ---------- |
| 0              | insulations | Insulations   | 0        | 0           | 1             |                     | 0          |
| 1              | durolast    | Duro-Last     | 6        | 1           | 0             | 1                   | 1          |
| 5              | durofleece  | Duro-Fleece   | 3        | 0           | 0             |                     | 2          |
| 2              | durobond    | Duro-Bond     | 6        | 1           | 0             | 2                   | 3          |
| 3              | durotuff    | Duro-Tuff     | 6        | 1           | 0             |                     | 4          |
| 4              | duroroof    | Duro-Roof     | 6        | 1           | 0             |                     | 5          |
| 6              | durotech    | Duro-Tech TPO | 6        | 1           | 0             |                     | 6          |
| 7              | ndltpo      | Non-DL TPO    | 6        | 1           | 0             |                     | 7          |
| 8              | epdm        | EPDM Rubber   | 3        | 0           | 0             |                     | 8          |

### C.5 Install labor combos (`rdl_combos`)

#### Duro-Last / mechanical

_Canonical 10-column mechanical model. Base 10 hrs is per 2500 sf (engine adds /2500). This is the combo the engine-truth worked anchor uses: Wood@18in = 10*1*1.5125\*1 = 15.13 hrs._

Base: `{"tab_value": 28, "tab_multiplier": 1.5125, "tab_or_width_label": "Tab"}`

| deck         | multiplier |
| ------------ | ---------- |
| Wood         | 1          |
| Steel        | 1.064      |
| Gypsum       | 1.8        |
| Purlin       | 1.2        |
| Tectum       | 1.064      |
| Concrete     | 2          |
| Retrofit     | 1.25       |
| LWC/Other    | 1.52       |
| LWC/Steel    | 1.2        |
| LWC/Concrete | 2.3        |

| spacing_in | multiplier |
| ---------- | ---------- |
| 24         | 0.91       |
| 21         | 0.96       |
| 18         | 1          |
| 15         | 1.04       |
| 12         | 1.1        |
| 9          | 1.21       |
| 6          | 1.41       |

| label     | roof_section | underlayment |
| --------- | ------------ | ------------ |
| Roll Good | 4            | 4            |
| 500 sf    | 2.4          | 2.4          |
| 1000 sf   | 1.2          | 1.2          |
| 1500 sf   | 1            | 1            |
| 2000 sf   | 0.98         | 0.98         |
| 2500 sf   | 0.9          | 0.9          |
| 3000 sf   | 0.82         | 0.82         |

| mil | multiplier |
| --- | ---------- |
| 40  | 1          |
| 50  | 1.15       |
| 60  | 1.25       |

#### Duro-Last / adhesive

_Adhesive model. Underlayment column blank; only first 3 sheet-size rows carry values._

| label     | roof_section | underlayment |
| --------- | ------------ | ------------ |
| Roll Good | 4            |              |
| 500 sf    | 2.4          |              |
| 1000 sf   | 1.2          |              |
| 1500 sf   |              |              |
| 2000 sf   |              |              |
| 2500 sf   |              |              |
| 3000 sf   |              |              |

| mil | multiplier |
| --- | ---------- |
| 40  | 1          |
| 50  | 1.15       |
| 60  | 1.25       |

| substrate              | labor_per_1000_sqft |
| ---------------------- | ------------------- |
| Water Based Adhesive   | 5.215               |
| Solvent Based Adhesive | 6.95                |

#### Duro-Roof / mechanical

_Same 10-column mechanical model as Duro-Last but Tab=57 / TabMultiplier=1.25. No 'Roll Good' row in sheet-size grid (6 rows starting at 500 sf)._

Base: `{"tab_value": 57, "tab_multiplier": 1.25, "tab_or_width_label": "Tab"}`

| deck         | multiplier |
| ------------ | ---------- |
| Wood         | 1          |
| Steel        | 1.064      |
| Gypsum       | 1.8        |
| Purlin       | 1.2        |
| Tectum       | 1.064      |
| Concrete     | 2          |
| Retrofit     | 1.25       |
| LWC/Other    | 1.52       |
| LWC/Steel    | 1.2        |
| LWC/Concrete | 2.3        |

| spacing_in | multiplier |
| ---------- | ---------- |
| 24         | 0.91       |
| 21         | 0.96       |
| 18         | 1          |
| 15         | 1.04       |
| 12         | 1.1        |
| 9          | 1.21       |
| 6          | 1.41       |

| label   | roof_section | underlayment |
| ------- | ------------ | ------------ |
| 500 sf  | 2.4          | 2.4          |
| 1000 sf | 1.2          | 1.2          |
| 1500 sf | 1            | 1            |
| 2000 sf | 0.98         | 0.98         |
| 2500 sf | 0.9          | 0.9          |
| 3000 sf | 0.82         | 0.82         |

| mil | multiplier |
| --- | ---------- |
| 40  | 1          |
| 50  | 1.15       |
| 60  | 1.25       |

#### Duro-Tuff / mechanical

_Duro-Tuff mechanical: base labeled Width (=30) with multiplier 2.8. Section 2 is COMPLEXITY (not sheet size). No 40mil row._

Base: `{"tab_value": 30, "tab_multiplier": 2.8, "tab_or_width_label": "Width"}`

| deck         | multiplier |
| ------------ | ---------- |
| Wood         | 1          |
| Steel        | 1.064      |
| Gypsum       | 1.8        |
| Purlin       | 1.2        |
| Tectum       | 1.064      |
| Concrete     | 2          |
| Retrofit     | 1.25       |
| LWC/Other    | 1.52       |
| LWC/Steel    | 1.2        |
| LWC/Concrete | 2.3        |

| spacing_in | multiplier |
| ---------- | ---------- |
| 24         | 0.91       |
| 21         | 0.96       |
| 18         | 1          |
| 15         | 1.04       |
| 12         | 1.1        |
| 9          | 1.21       |
| 6          | 1.41       |

| mil | multiplier |
| --- | ---------- |
| 50  | 1.15       |
| 60  | 1.25       |

Complexity factors: `[{"label": "Open", "value": 0.9}, {"label": "Minor", "value": 0.98}, {"label": "Moderate", "value": 1}, {"label": "Medium", "value": 1.2}, {"label": "Heavy", "value": 2.4}, {"label": "Extreme", "value": 4}]`

#### Duro-Tuff / adhesive

_Duro-Tuff adhesive uses Complexity. 50/60mil only._

| mil | multiplier |
| --- | ---------- |
| 50  | 1.15       |
| 60  | 1.25       |

| substrate              | labor_per_1000_sqft |
| ---------------------- | ------------------- |
| Water Based Adhesive   | 5.215               |
| Solvent Based Adhesive | 6.95                |

Complexity factors: `[{"label": "Open", "value": 0.9}, {"label": "Minor", "value": 0.98}, {"label": "Moderate", "value": 1}, {"label": "Medium", "value": 1.2}, {"label": "Heavy", "value": 2.4}, {"label": "Extreme", "value": 4}]`

#### Duro-Bond / mechanical

_GENUINELY DIFFERENT MODEL: hours = memb\*(LayoutTime/2500)\*thickness + (#fasteners)\*SingleFastenerTimeByDeck[deck]. Reduced 7-deck set (no Gypsum/LWC-Other/Tectum). Sheet-size 5 rows._

Base: `{"sheet_layout_hours": 10}`

| label   | roof_section | underlayment |
| ------- | ------------ | ------------ |
| 500 sf  | 2            | 2.4          |
| 1000 sf | 1.1          | 1.2          |
| 1500 sf | 1            | 1            |
| 2000 sf | 1.1          | 0.98         |
| 2500 sf | 1.2          | 0.9          |

| mil | multiplier |
| --- | ---------- |
| 40  | 1          |
| 50  | 1.15       |
| 60  | 1.25       |

#### Duro-Fleece / adhesive

_Richest substrate list (6). Complexity section. Thickness 4 rows incl 50/60 Plus. On-screen label literally reads Mechanical Labor (app quirk)._

| mil     | multiplier |
| ------- | ---------- |
| 50      | 1.15       |
| 50 Plus | 1.15       |
| 60      | 1.25       |
| 60 Plus | 1.25       |

| substrate                       | labor_per_1000_sqft |
| ------------------------------- | ------------------- |
| Water Based Adhesive            | 5.215               |
| Duro-Fleece Adhesive(2-boxes)   | 5.215               |
| Duro-Fleece Adhesive(cartridge) | 5.215               |
| Duro-Grip Adhesive(CR-20)       | 5.8408              |
| OlyBond500 Bag-in-Box           | 5.215               |
| OlyBond500 SpotShot             | 5.215               |

Complexity factors: `[{"label": "Open", "value": 0.9}, {"label": "Minor", "value": 0.98}, {"label": "Moderate", "value": 1}, {"label": "Medium", "value": 1.2}, {"label": "Heavy", "value": 2.4}, {"label": "Extreme", "value": 4}]`

#### Duro-Tech TPO / mechanical

_Duro-Tech TPO (no legacy source). Base 27 h / 2500 sq ft = midpoint of the Roof Membrane Bid Calculator Reference 24-30 h (mechanically fastened TPO, wood deck, 10 ft roll, Open complexity). Deck multipliers from the guide table midpoints; roll-width (2.6/1.3/1.0) and fastener-spacing multipliers copied from Duro-Tuff; complexity 1.0/1.1/1.25/1.4/1.6/2.0 (guide 1.00 / 1.20-1.30 / 1.40-1.60+); 80 mil +7.5% handling. Calibrate against company production history._

Base: `{"tab_value": 30, "tab_multiplier": 2.8, "tab_or_width_label": "Width"}`

| deck         | multiplier |
| ------------ | ---------- |
| Wood         | 1          |
| Steel        | 1.05       |
| Gypsum       | 1.225      |
| Purlin       | 1.05       |
| Tectum       | 1.225      |
| Concrete     | 1.325      |
| Retrofit     | 1.225      |
| LWC/Other    | 1.225      |
| LWC/Steel    | 1.225      |
| LWC/Concrete | 1.325      |

| spacing_in | multiplier |
| ---------- | ---------- |
| 24         | 0.91       |
| 21         | 0.96       |
| 18         | 1          |
| 15         | 1.04       |
| 12         | 1.1        |
| 9          | 1.21       |
| 6          | 1.41       |

| mil | multiplier |
| --- | ---------- |
| 45  | 1          |
| 60  | 1          |
| 80  | 1.075      |

Complexity factors: `[{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}]`

#### Duro-Tech TPO / adhesive

_Duro-Tech TPO adhered (no legacy source). 13.2 h / 1000 sq ft = the guide 30-36 h / 2500 sq ft midpoint (33 h). Roll-width multipliers 2.6/1.3/1.0 apply as on Duro-Tuff. Calibrate._

| mil | multiplier |
| --- | ---------- |
| 45  | 1          |
| 60  | 1          |
| 80  | 1.075      |

| substrate                           | labor_per_1000_sqft |
| ----------------------------------- | ------------------- |
| TECH-Bond TPO Bonding Adhesive      | 13.2                |
| TECH-Bond TPO LVOC Bonding Adhesive | 13.2                |
| TECH-Bond TPO Spray Adhesive        | 13.2                |

Complexity factors: `[{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}]`

#### Non-DL TPO / mechanical

_Non-DL TPO, generic manufacturer (no legacy source). Base 27.5 h / 2500 sq ft = guide 25-30 h midpoint (mechanically fastened, wood, 10 ft roll, Open). Deck multipliers = guide midpoints; roll-width and fastener-spacing multipliers copied from Duro-Tuff; complexity guide 1.00 / 1.20-1.30 / 1.40-1.60+; 80 mil +7.5%. Manufacturer-specific fastening patterns and accessories: adjust per assembly._

Base: `{"tab_value": 30, "tab_multiplier": 2.8, "tab_or_width_label": "Width"}`

| deck         | multiplier |
| ------------ | ---------- |
| Wood         | 1          |
| Steel        | 1.05       |
| Gypsum       | 1.225      |
| Purlin       | 1.05       |
| Tectum       | 1.225      |
| Concrete     | 1.325      |
| Retrofit     | 1.225      |
| LWC/Other    | 1.225      |
| LWC/Steel    | 1.225      |
| LWC/Concrete | 1.325      |

| spacing_in | multiplier |
| ---------- | ---------- |
| 24         | 0.91       |
| 21         | 0.96       |
| 18         | 1          |
| 15         | 1.04       |
| 12         | 1.1        |
| 9          | 1.21       |
| 6          | 1.41       |

| mil | multiplier |
| --- | ---------- |
| 45  | 1          |
| 60  | 1          |
| 80  | 1.075      |

Complexity factors: `[{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}]`

#### Non-DL TPO / adhesive

_Non-DL TPO adhered: 14 h / 1000 sq ft = guide 32-38 h / 2500 midpoint (35 h). Calibrate._

| mil | multiplier |
| --- | ---------- |
| 45  | 1          |
| 60  | 1          |
| 80  | 1.075      |

| substrate                   | labor_per_1000_sqft |
| --------------------------- | ------------------- |
| Non-DL TPO Bonding Adhesive | 14                  |
| Non-DL TPO Spray Adhesive   | 14                  |

Complexity factors: `[{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}]`

#### EPDM Rubber / mechanical

_EPDM Rubber (no legacy source). Base 31 h / 2500 sq ft = guide 28-34 h midpoint (mechanically fastened EPDM, wood). 10 ft sheet = 1.0, 20 ft sheet = 0.85 (start). Deck multipliers = guide midpoints; fastener-spacing multipliers copied from the Duro-Last set; complexity guide 1.00 / 1.25 / 1.50+; 75 mil +5%, 90 mil +10%. Manufacturer securement systems (screws/plates, RUSS) vary: adjust._

Base: `{"tab_value": 120, "tab_multiplier": 1, "tab_or_width_label": "Width"}`

| deck         | multiplier |
| ------------ | ---------- |
| Wood         | 1          |
| Steel        | 1.05       |
| Gypsum       | 1.225      |
| Purlin       | 1.05       |
| Tectum       | 1.225      |
| Concrete     | 1.325      |
| Retrofit     | 1.225      |
| LWC/Other    | 1.225      |
| LWC/Steel    | 1.225      |
| LWC/Concrete | 1.325      |

| spacing_in | multiplier |
| ---------- | ---------- |
| 24         | 0.91       |
| 21         | 0.96       |
| 18         | 1          |
| 15         | 1.04       |
| 12         | 1.1        |
| 9          | 1.21       |
| 6          | 1.41       |

| mil | multiplier |
| --- | ---------- |
| 45  | 1          |
| 60  | 1          |
| 75  | 1.05       |
| 90  | 1.1        |

Complexity factors: `[{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}]`

#### EPDM Rubber / adhesive

_EPDM adhered: 13.6 h / 1000 sq ft = guide 30-38 h / 2500 midpoint (34 h). Calibrate._

| mil | multiplier |
| --- | ---------- |
| 45  | 1          |
| 60  | 1          |
| 75  | 1.05       |
| 90  | 1.1        |

| substrate             | labor_per_1000_sqft |
| --------------------- | ------------------- |
| EPDM Bonding Adhesive | 13.6                |
| EPDM Spray Adhesive   | 13.6                |

Complexity factors: `[{"label": "Open", "value": 1}, {"label": "Minor", "value": 1.1}, {"label": "Moderate", "value": 1.25}, {"label": "Medium", "value": 1.4}, {"label": "Heavy", "value": 1.6}, {"label": "Extreme", "value": 2}]`

#### Tab / roll-width multipliers (`mech_tab_multi`) and roll widths (`rdl_roll_good_width`), by roof_system_id

| roof_system_id | tab_spacing | multiplier | custom_multi |
| -------------- | ----------- | ---------- | ------------ |
| 1              | 28          | 1.5125     | 0            |
| 1              | 60          | 1          | 0            |
| 1              | 64          | 1          | 0            |
| 1              | 120         | 0.8        | 0            |
| 2              | 0           | 1          | 0            |
| 3              | 30          | 2.8        | 0            |
| 3              | 60          | 1.4        | 0            |
| 3              | 120         | 0.95       | 0            |
| 4              | 57          | 1.25       | 0            |
| 4              | 64          | 1.25       | 0            |
| 4              | 87          | 1.12       | 0            |
| 4              | 120         | 1          | 0            |
| 6              | 30          | 2.8        | 0            |
| 6              | 60          | 1.4        | 0            |
| 6              | 120         | 0.95       | 0            |
| 7              | 30          | 2.8        | 0            |
| 7              | 60          | 1.4        | 0            |
| 7              | 120         | 0.95       | 0            |
| 8              | 120         | 1          | 0            |
| 8              | 240         | 0.85       | 0            |

| roof_system_id | width_in | multiplier | custom_multiplier |
| -------------- | -------- | ---------- | ----------------- |
| 1              | 64       | 1          | 0                 |
| 3              | 30       | 2.6        | 0                 |
| 3              | 60       | 1.3        | 0                 |
| 3              | 120      | 1          | 0                 |
| 4              | 64       | 1          | 0                 |
| 5              | 60       | 1.3        | 0                 |
| 5              | 120      | 1          | 0                 |
| 2              | 30       | 1          | 0                 |
| 2              | 60       | 1          | 0                 |
| 2              | 120      | 1          | 0                 |
| 6              | 30       | 2.6        | 0                 |
| 6              | 60       | 1.3        | 0                 |
| 6              | 120      | 1          | 0                 |
| 7              | 30       | 2.6        | 0                 |
| 7              | 60       | 1.3        | 0                 |
| 7              | 120      | 1          | 0                 |
| 8              | 120      | 1          | 0                 |
| 8              | 240      | 0.85       | 0                 |

#### Sheet tab spacings offered (`mech_sheet_tab_spacing`) and adhered sheet multipliers (`rdl_adhered_sheet_multi`)

| roof_system_id | spacing |
| -------------- | ------- |
| 1              | 28      |
| 1              | 60      |
| 1              | 120     |
| 4              | 57      |
| 4              | 87      |
| 4              | 120     |

| multiplier | adhesive_id | sheet_label | roof_system_id | custom_multiplier |
| ---------- | ----------- | ----------- | -------------- | ----------------- |
| 4          | 1           | Roll Good   | 1              | 0                 |
| 2.4        | 1           | 500 sf      | 1              | 0                 |
| 1.2        | 1           | 1000 sf     | 1              | 0                 |
| 4          | 2           | Roll Good   | 1              | 0                 |
| 2.4        | 2           | 500 sf      | 1              | 0                 |
| 1.2        | 2           | 1000 sf     | 1              | 0                 |
| 1          | 1           | Roll Good   | 3              | 0                 |
| 1          | 2           | Roll Good   | 3              | 0                 |
| 1          | 1           | Roll Good   | 5              | 0                 |
| 1          | 2           | Roll Good   | 5              | 0                 |
| 1          | 3           | Roll Good   | 5              | 0                 |
| 1          | 4           | Roll Good   | 5              | 0                 |
| 1          | 5           | Roll Good   | 5              | 0                 |
| 1          | 6           | Roll Good   | 5              | 0                 |
| 1          | 7           | Roll Good   | 5              | 0                 |
| 1          | 8           | Roll Good   | 5              | 0                 |
| 1          | 9           | Roll Good   | 5              | 0                 |
| 1          | 11          | Roll Good   | 6              | 0                 |
| 1          | 12          | Roll Good   | 6              | 0                 |
| 1          | 13          | Roll Good   | 6              | 0                 |
| 1          | 14          | Roll Good   | 7              | 0                 |
| 1          | 15          | Roll Good   | 7              | 0                 |
| 1          | 16          | Roll Good   | 8              | 0                 |
| 1          | 17          | Roll Good   | 8              | 0                 |

### C.6 Fastener spacing from the pull test (`mech_fastener_lookup`)

Field spacing (in) for a roof system, design table (psf), pull test (lbs) and tab spacing; −1 = not offered.

| roof_system_id | design_table | pull_test | tab_spacing | membrane_thickness | field_spacing | perim_spacing | corner_spacing |
| -------------- | ------------ | --------- | ----------- | ------------------ | ------------- | ------------- | -------------- |
| 1              | 60           | 140       | 28          | -1                 | 12            | -1            | -1             |
| 1              | 60           | 150       | 28          | -1                 | 15            | -1            | -1             |
| 1              | 60           | 210       | 28          | -1                 | 18            | -1            | -1             |
| 1              | 60           | 450       | 28          | -1                 | 24            | -1            | -1             |
| 1              | 60           | 150       | 60          | -1                 | 6             | -1            | -1             |
| 1              | 60           | 225       | 60          | -1                 | 9             | -1            | -1             |
| 1              | 60           | 275       | 60          | -1                 | 12            | -1            | -1             |
| 1              | 60           | 350       | 60          | -1                 | 15            | -1            | -1             |
| 1              | 60           | 450       | 60          | -1                 | 18            | -1            | -1             |
| 1              | 60           | 150       | 64          | -1                 | 6             | -1            | -1             |
| 1              | 60           | 225       | 64          | -1                 | 9             | -1            | -1             |
| 1              | 60           | 275       | 64          | -1                 | 12            | -1            | -1             |
| 1              | 60           | 350       | 64          | -1                 | 15            | -1            | -1             |
| 1              | 60           | 450       | 64          | -1                 | 18            | -1            | -1             |
| 1              | 60           | 300       | 120         | -1                 | 6             | -1            | -1             |
| 1              | 60           | 450       | 120         | -1                 | 9             | -1            | -1             |
| 1              | 90           | 140       | 28          | -1                 | 6             | -1            | -1             |
| 1              | 90           | 175       | 28          | -1                 | 9             | -1            | -1             |
| 1              | 90           | 210       | 28          | -1                 | 12            | -1            | -1             |
| 1              | 90           | 275       | 28          | -1                 | 15            | -1            | -1             |
| 1              | 90           | 325       | 28          | -1                 | 18            | -1            | -1             |
| 1              | 90           | 225       | 60          | -1                 | 6             | -1            | -1             |
| 1              | 90           | 375       | 60          | -1                 | 9             | -1            | -1             |
| 1              | 90           | 450       | 60          | -1                 | 12            | -1            | -1             |
| 1              | 90           | 225       | 64          | -1                 | 6             | -1            | -1             |
| 1              | 90           | 375       | 64          | -1                 | 9             | -1            | -1             |
| 1              | 90           | 450       | 64          | -1                 | 12            | -1            | -1             |
| 1              | 90           | 450       | 120         | -1                 | 6             | -1            | -1             |
| 2              | 60           | 210       | -1          | 40                 | 10            | 12            | 14             |
| 2              | 60           | 250       | -1          | 40                 | 8             | 10            | 12             |
| 2              | 60           | 350       | -1          | 40                 | 6             | 8             | 10             |
| 2              | 75           | 210       | -1          | 40                 | 12            | 14            | 16             |
| 2              | 75           | 250       | -1          | 40                 | 10            | 12            | 14             |
| 2              | 75           | 325       | -1          | 40                 | 8             | 10            | 12             |
| 2              | 90           | 210       | -1          | 40                 | 14            | 16            | 18             |
| 2              | 90           | 250       | -1          | 40                 | 12            | 14            | 16             |
| 2              | 90           | 300       | -1          | 40                 | 10            | 12            | 14             |
| 2              | 90           | 350       | -1          | 40                 | 8             | 10            | 12             |
| 2              | 105          | 210       | -1          | 40                 | 16            | 18            | 20             |
| 2              | 105          | 275       | -1          | 40                 | 14            | 16            | 18             |
| 2              | 105          | 325       | -1          | 40                 | 12            | 14            | 16             |
| 2              | 105          | 350       | -1          | 40                 | 10            | 12            | 14             |
| 2              | 120          | 250       | -1          | 40                 | 16            | 18            | 20             |
| 2              | 120          | 275       | -1          | 40                 | 14            | 16            | 18             |
| 2              | 120          | 325       | -1          | 40                 | 12            | 14            | 16             |
| 2              | 120          | 400       | -1          | 40                 | 10            | 12            | 14             |
| 2              | 135          | 275       | -1          | 40                 | 16            | 18            | 20             |
| 2              | 135          | 350       | -1          | 40                 | 14            | 16            | 18             |
| 2              | 135          | 375       | -1          | 40                 | 12            | 14            | 16             |
| 2              | 150          | 300       | -1          | 40                 | 16            | 18            | 20             |
| 2              | 150          | 350       | -1          | 40                 | 14            | 16            | 18             |
| 2              | 165          | 375       | -1          | 40                 | 16            | 18            | 20             |
| 2              | 60           | 210       | -1          | 50                 | 10            | 12            | 14             |
| 2              | 60           | 250       | -1          | 50                 | 8             | 10            | 12             |
| 2              | 60           | 350       | -1          | 50                 | 6             | 8             | 10             |
| 2              | 75           | 210       | -1          | 50                 | 12            | 14            | 16             |
| 2              | 75           | 250       | -1          | 50                 | 10            | 12            | 14             |
| 2              | 75           | 325       | -1          | 50                 | 8             | 10            | 12             |
| 2              | 90           | 210       | -1          | 50                 | 14            | 16            | 18             |
| 2              | 90           | 250       | -1          | 50                 | 12            | 14            | 16             |
| 2              | 90           | 300       | -1          | 50                 | 10            | 12            | 14             |
| 2              | 90           | 350       | -1          | 50                 | 8             | 10            | 12             |
| 2              | 105          | 210       | -1          | 50                 | 16            | 18            | 20             |
| 2              | 105          | 275       | -1          | 50                 | 14            | 16            | 18             |
| 2              | 105          | 325       | -1          | 50                 | 12            | 14            | 16             |
| 2              | 105          | 350       | -1          | 50                 | 10            | 12            | 14             |
| 2              | 120          | 250       | -1          | 50                 | 16            | 18            | 20             |
| 2              | 120          | 275       | -1          | 50                 | 14            | 16            | 18             |
| 2              | 120          | 325       | -1          | 50                 | 12            | 14            | 16             |
| 2              | 120          | 400       | -1          | 50                 | 10            | 12            | 14             |
| 2              | 135          | 275       | -1          | 50                 | 16            | 18            | 20             |
| 2              | 135          | 350       | -1          | 50                 | 14            | 16            | 18             |
| 2              | 135          | 375       | -1          | 50                 | 12            | 14            | 16             |
| 2              | 150          | 300       | -1          | 50                 | 16            | 18            | 20             |
| 2              | 150          | 350       | -1          | 50                 | 14            | 16            | 18             |
| 2              | 165          | 375       | -1          | 50                 | 16            | 18            | 20             |
| 2              | 60           | 210       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 60           | 225       | -1          | 60                 | 10            | 12            | 14             |
| 2              | 60           | 275       | -1          | 60                 | 8             | 10            | 12             |
| 2              | 60           | 350       | -1          | 60                 | 6             | 8             | 10             |
| 2              | 75           | 210       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 75           | 225       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 75           | 300       | -1          | 60                 | 10            | 12            | 14             |
| 2              | 75           | 350       | -1          | 60                 | 8             | 10            | 12             |
| 2              | 75           | 450       | -1          | 60                 | 6             | 8             | 10             |
| 2              | 90           | 210       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 90           | 250       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 90           | 350       | -1          | 60                 | 10            | 12            | 14             |
| 2              | 90           | 400       | -1          | 60                 | 8             | 10            | 12             |
| 2              | 105          | 210       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 105          | 250       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 105          | 325       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 105          | 375       | -1          | 60                 | 10            | 12            | 14             |
| 2              | 105          | 450       | -1          | 60                 | 8             | 10            | 12             |
| 2              | 120          | 250       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 120          | 275       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 120          | 325       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 120          | 425       | -1          | 60                 | 10            | 12            | 14             |
| 2              | 135          | 275       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 135          | 325       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 135          | 375       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 135          | 450       | -1          | 60                 | 10            | 12            | 14             |
| 2              | 150          | 300       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 150          | 350       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 150          | 425       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 165          | 350       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 165          | 400       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 165          | 475       | -1          | 60                 | 12            | 14            | 16             |
| 2              | 180          | 375       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 180          | 450       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 195          | 400       | -1          | 60                 | 16            | 18            | 20             |
| 2              | 195          | 475       | -1          | 60                 | 14            | 16            | 18             |
| 2              | 210          | 425       | -1          | 60                 | 16            | 18            | 20             |
| 3              | 60           | 150       | 30          | -1                 | 12            | 6             | -1             |
| 3              | 60           | 175       | 30          | -1                 | 15            | 9             | -1             |
| 3              | 60           | 200       | 30          | -1                 | 18            | 9             | -1             |
| 3              | 60           | 250       | 30          | -1                 | 18            | 12            | -1             |
| 3              | 60           | 300       | 30          | -1                 | 18            | 15            | -1             |
| 3              | 60           | 350       | 30          | -1                 | 18            | 18            | -1             |
| 3              | 60           | 150       | 60          | -1                 | 6             | -1            | -1             |
| 3              | 60           | 225       | 60          | -1                 | 9             | -1            | -1             |
| 3              | 60           | 250       | 60          | -1                 | 9             | 6             | -1             |
| 3              | 60           | 275       | 60          | -1                 | 12            | 6             | -1             |
| 3              | 60           | 350       | 60          | -1                 | 15            | 9             | -1             |
| 3              | 60           | 425       | 60          | -1                 | 18            | 9             | -1             |
| 3              | 60           | 275       | 120         | -1                 | 6             | -1            | -1             |
| 3              | 60           | 425       | 120         | -1                 | 9             | -1            | -1             |
| 4              | 60           | 145       | 57          | -1                 | 6             | -1            | -1             |
| 4              | 60           | 215       | 57          | -1                 | 9             | -1            | -1             |
| 4              | 60           | 285       | 57          | -1                 | 12            | -1            | -1             |
| 4              | 60           | 360       | 57          | -1                 | 15            | -1            | -1             |
| 4              | 60           | 430       | 57          | -1                 | 18            | -1            | -1             |
| 4              | 60           | 500       | 57          | -1                 | 21            | -1            | -1             |
| 4              | 60           | 570       | 57          | -1                 | 24            | -1            | -1             |
| 4              | 60           | 215       | 87          | -1                 | 6             | -1            | -1             |
| 4              | 60           | 325       | 87          | -1                 | 9             | -1            | -1             |
| 4              | 60           | 435       | 87          | -1                 | 12            | -1            | -1             |
| 4              | 60           | 540       | 87          | -1                 | 15            | -1            | -1             |
| 4              | 60           | 650       | 87          | -1                 | 18            | -1            | -1             |
| 4              | 60           | 825       | 87          | -1                 | 21            | -1            | -1             |
| 4              | 60           | 300       | 120         | -1                 | 6             | -1            | -1             |
| 4              | 60           | 450       | 120         | -1                 | 9             | -1            | -1             |
| 4              | 60           | 600       | 120         | -1                 | 12            | -1            | -1             |
| 4              | 60           | 825       | 120         | -1                 | 15            | -1            | -1             |
| 4              | 75           | 180       | 57          | -1                 | 6             | -1            | -1             |
| 4              | 75           | 270       | 57          | -1                 | 9             | -1            | -1             |
| 4              | 75           | 360       | 57          | -1                 | 12            | -1            | -1             |
| 4              | 75           | 445       | 57          | -1                 | 15            | -1            | -1             |
| 4              | 75           | 535       | 57          | -1                 | 18            | -1            | -1             |
| 4              | 75           | 625       | 57          | -1                 | 21            | -1            | -1             |
| 4              | 75           | 715       | 57          | -1                 | 24            | -1            | -1             |
| 4              | 75           | 270       | 87          | -1                 | 6             | -1            | -1             |
| 4              | 75           | 405       | 87          | -1                 | 9             | -1            | -1             |
| 4              | 75           | 540       | 87          | -1                 | 12            | -1            | -1             |
| 4              | 75           | 675       | 87          | -1                 | 15            | -1            | -1             |
| 4              | 75           | 825       | 87          | -1                 | 18            | -1            | -1             |
| 4              | 75           | 375       | 120         | -1                 | 6             | -1            | -1             |
| 4              | 75           | 565       | 120         | -1                 | 9             | -1            | -1             |
| 4              | 75           | 750       | 120         | -1                 | 12            | -1            | -1             |
| 4              | 90           | 215       | 57          | -1                 | 6             | -1            | -1             |
| 4              | 90           | 325       | 57          | -1                 | 9             | -1            | -1             |
| 4              | 90           | 430       | 57          | -1                 | 12            | -1            | -1             |
| 4              | 90           | 535       | 57          | -1                 | 15            | -1            | -1             |
| 4              | 90           | 640       | 57          | -1                 | 18            | -1            | -1             |
| 4              | 90           | 825       | 57          | -1                 | 21            | -1            | -1             |
| 4              | 90           | 325       | 87          | -1                 | 6             | -1            | -1             |
| 4              | 90           | 485       | 87          | -1                 | 9             | -1            | -1             |
| 4              | 90           | 650       | 87          | -1                 | 12            | -1            | -1             |
| 4              | 90           | 825       | 87          | -1                 | 15            | -1            | -1             |
| 4              | 90           | 450       | 120         | -1                 | 6             | -1            | -1             |
| 4              | 90           | 825       | 120         | -1                 | 9             | -1            | -1             |
| 4              | 120          | 285       | 57          | -1                 | 6             | -1            | -1             |
| 4              | 120          | 430       | 57          | -1                 | 9             | -1            | -1             |
| 4              | 120          | 570       | 57          | -1                 | 12            | -1            | -1             |
| 4              | 120          | 715       | 57          | -1                 | 15            | -1            | -1             |
| 4              | 120          | 825       | 57          | -1                 | 18            | -1            | -1             |
| 4              | 120          | 435       | 87          | -1                 | 6             | -1            | -1             |
| 4              | 120          | 650       | 87          | -1                 | 9             | -1            | -1             |
| 4              | 120          | 825       | 87          | -1                 | 12            | -1            | -1             |
| 4              | 120          | 600       | 120         | -1                 | 6             | -1            | -1             |
| 4              | 150          | 545       | 87          | -1                 | 6             | -1            | -1             |
| 4              | 150          | 825       | 87          | -1                 | 9             | -1            | -1             |
| 4              | 150          | 825       | 120         | -1                 | 6             | -1            | -1             |
| 4              | 210          | 500       | 57          | -1                 | 6             | -1            | -1             |
| 4              | 210          | 750       | 57          | -1                 | 9             | -1            | -1             |
| 4              | 210          | 825       | 87          | -1                 | 6             | -1            | -1             |
| 6              | 60           | 150       | 30          | -1                 | 12            | 6             | -1             |
| 6              | 60           | 175       | 30          | -1                 | 15            | 9             | -1             |
| 6              | 60           | 200       | 30          | -1                 | 18            | 9             | -1             |
| 6              | 60           | 250       | 30          | -1                 | 18            | 12            | -1             |
| 6              | 60           | 300       | 30          | -1                 | 18            | 15            | -1             |
| 6              | 60           | 350       | 30          | -1                 | 18            | 18            | -1             |
| 6              | 60           | 150       | 60          | -1                 | 6             | -1            | -1             |
| 6              | 60           | 225       | 60          | -1                 | 9             | -1            | -1             |
| 6              | 60           | 250       | 60          | -1                 | 9             | 6             | -1             |
| 6              | 60           | 275       | 60          | -1                 | 12            | 6             | -1             |
| 6              | 60           | 350       | 60          | -1                 | 15            | 9             | -1             |
| 6              | 60           | 425       | 60          | -1                 | 18            | 9             | -1             |
| 6              | 60           | 275       | 120         | -1                 | 6             | -1            | -1             |
| 6              | 60           | 425       | 120         | -1                 | 9             | -1            | -1             |
| 7              | 60           | 150       | 30          | -1                 | 12            | 6             | -1             |
| 7              | 60           | 175       | 30          | -1                 | 15            | 9             | -1             |
| 7              | 60           | 200       | 30          | -1                 | 18            | 9             | -1             |
| 7              | 60           | 250       | 30          | -1                 | 18            | 12            | -1             |
| 7              | 60           | 300       | 30          | -1                 | 18            | 15            | -1             |
| 7              | 60           | 350       | 30          | -1                 | 18            | 18            | -1             |
| 7              | 60           | 150       | 60          | -1                 | 6             | -1            | -1             |
| 7              | 60           | 225       | 60          | -1                 | 9             | -1            | -1             |
| 7              | 60           | 250       | 60          | -1                 | 9             | 6             | -1             |
| 7              | 60           | 275       | 60          | -1                 | 12            | 6             | -1             |
| 7              | 60           | 350       | 60          | -1                 | 15            | 9             | -1             |
| 7              | 60           | 425       | 60          | -1                 | 18            | 9             | -1             |
| 7              | 60           | 275       | 120         | -1                 | 6             | -1            | -1             |
| 7              | 60           | 425       | 120         | -1                 | 9             | -1            | -1             |
| 8              | 60           | 275       | 120         | -1                 | 6             | -1            | -1             |
| 8              | 60           | 275       | 240         | -1                 | 6             | -1            | -1             |
| 8              | 60           | 425       | 120         | -1                 | 9             | -1            | -1             |
| 8              | 60           | 425       | 240         | -1                 | 9             | -1            | -1             |

### C.7 Parapet labor (`labor_parapet`, hours per 50 ft)

| deck_type         | wall_height_band | no_drill_no_cant | no_drill_canted | predrill_no_cant | predrill_canted |
| ----------------- | ---------------- | ---------------- | --------------- | ---------------- | --------------- |
| Wood              | 0"-30"           | 2.25             | 3.375           | 3.5              | 5.25            |
| Wood              | 31"-48"          | 4.5              | 6.75            | 7                | 10.5            |
| Wood              | 49"-72"          | 6.75             | 10.13           | 10.5             | 15.75           |
| Wood              | 73"-99"          | 9                | 11.475          | 14               | 17.85           |
| Wood              | 100"+            | 9                | 11.475          | 14               | 17.85           |
| Structural Metal  | 0"-30"           | 2.5              | 3.75            | 3.55             | 5.325           |
| Structural Metal  | 31"-48"          | 5                | 7.5             | 7.1              | 10.65           |
| Structural Metal  | 49"-72"          | 7.5              | 11.25           | 10.65            | 15.98           |
| Structural Metal  | 73"-99"          | 10               | 12.75           | 14.2             | 18.105          |
| Structural Metal  | 100"+            | 10               | 12.75           | 14.2             | 18.105          |
| Metal Retrofit    | 0"-30"           | 2.6              | 3.9             | 3.55             | 5.325           |
| Metal Retrofit    | 31"-48"          | 5.2              | 7.8             | 7.1              | 10.65           |
| Metal Retrofit    | 49"-72"          | 7.8              | 11.7            | 10.65            | 15.98           |
| Metal Retrofit    | 73"-99"          | 10.4             | 13.26           | 14.2             | 18.105          |
| Metal Retrofit    | 100"+            | 10.4             | 13.26           | 14.2             | 18.105          |
| Concrete          | 0"-30"           | 4                | 6               | 5.25             | 7.875           |
| Concrete          | 31"-48"          | 8                | 12              | 10.5             | 15.75           |
| Concrete          | 49"-72"          | 12               | 18              | 15.75            | 23.625          |
| Concrete          | 73"-99"          | 16               | 20.4            | 21               | 26.775          |
| Concrete          | 100"+            | 16               | 20.4            | 21               | 26.775          |
| Gypsum            | 0"-30"           | 3.5              | 5.25            | 5.25             | 7.875           |
| Gypsum            | 31"-48"          | 7                | 10.5            | 10.5             | 15.75           |
| Gypsum            | 49"-72"          | 10.5             | 15.75           | 15.75            | 23.625          |
| Gypsum            | 73"-99"          | 14               | 17.85           | 21               | 26.775          |
| Gypsum            | 100"+            | 14               | 17.85           | 21               | 26.775          |
| LWC over Steel    | 0"-30"           | 3                | 4.5             | 5.25             | 7.875           |
| LWC over Steel    | 31"-48"          | 6                | 9               | 10.5             | 15.75           |
| LWC over Steel    | 49"-72"          | 9                | 13.5            | 15.75            | 23.625          |
| LWC over Steel    | 73"-99"          | 12               | 15.3            | 21               | 26.775          |
| LWC over Steel    | 100"+            | 12               | 15.3            | 21               | 26.775          |
| LWC over Concrete | 0"-30"           | 4.5              | 6.75            | 5.65             | 8.475           |
| LWC over Concrete | 31"-48"          | 9                | 13.5            | 11.3             | 16.95           |
| LWC over Concrete | 49"-72"          | 13.5             | 20.25           | 16.95            | 25.425          |
| LWC over Concrete | 73"-99"          | 18               | 22.95           | 22.6             | 28.815          |
| LWC over Concrete | 100"+            | 18               | 22.95           | 22.6             | 28.815          |
| LWC over Other    | 0"-30"           | 4                | 6               | 5                | 7.5             |
| LWC over Other    | 31"-48"          | 8                | 12              | 10               | 15              |
| LWC over Other    | 49"-72"          | 12               | 18              | 15               | 22.5            |
| LWC over Other    | 73"-99"          | 16               | 20.4            | 20               | 25.5            |
| LWC over Other    | 100"+            | 16               | 20.4            | 20               | 25.5            |
| Tectum            | 0"-30"           | 3                | 4.5             | 4.5              | 6.75            |
| Tectum            | 31"-48"          | 6                | 9               | 9                | 13.5            |
| Tectum            | 49"-72"          | 9                | 13.5            | 13.5             | 20.25           |
| Tectum            | 73"-99"          | 12               | 15.3            | 18               | 22.95           |
| Tectum            | 100"+            | 12               | 15.3            | 18               | 22.95           |
| Purlin Fastened   | 0"-30"           | 2.6              | 3.9             | 4.5              | 6.75            |
| Purlin Fastened   | 31"-48"          | 5.2              | 7.8             | 9                | 13.5            |
| Purlin Fastened   | 49"-72"          | 7.8              | 11.7            | 13.5             | 20.25           |
| Purlin Fastened   | 73"-99"          | 10.4             | 13.26           | 18               | 22.95           |
| Purlin Fastened   | 100"+            | 10.4             | 13.26           | 18               | 22.95           |

### C.8 Curb labor

Setup minutes per curb: `[{"id": 1, "setup_minutes": 8}]`

| deck_type         | minutes | setup_minutes |
| ----------------- | ------- | ------------- |
| Wood              | 7.5     |               |
| Metal Retrofit    | 7.5     |               |
| Concrete          | 10.5    |               |
| Gypsum            | 10.5    |               |
| LWC over Steel    | 7.5     |               |
| LWC over Concrete | 10.5    |               |
| LWC over Other    | 9       |               |
| Tectum            | 7.5     |               |
| Purlin Fastened   | 7.5     |               |
| Structural Metal  | 7.5     | 7.5           |

| curb_type     | multiplier |
| ------------- | ---------- |
| Open          | 1.1        |
| Closed        | 1          |
| Closed w/ Top | 1.1        |
| Scupper       | 4          |
| Metal Scupper | 3          |

### C.9 Underlayment mechanical layout labor

Underlayment Times > Layout & Mechanical sub-tab. EDITABLE inputs only. Per app header: 'Labor = Layout Time + (Time for One Fastener by Deck Type) * # Fasteners in 2500 SqFt'. Editable green cells are (a) the single shared per-deck fastening-time row in Minutes/Fastener, and (b) each product's Layout Time in Hours/2500SqFt.

| underlayment        | layout_hours_per_2500sqft |
| ------------------- | ------------------------- |
| 1/4" Dens Deck      | 23.419                    |
| 1/2" HD ISO 4'x 4'  | 8.5525                    |
| 1/2" ISO            | 7.775                     |
| 1/2" Rigid 4'x 4'   | 8.5525                    |
| 1" ISO              | 8.775                     |
| 1" ISO 4'x 4'       | 9.6525                    |
| 1" Rigid            | 8.775                     |
| 1" Rigid 4'x 4'     | 9.6525                    |
| 1/2" DensDeck Prime | 20                        |
| 1/2" Securock GFRB  | 20                        |
| 1/4" DensDeck Prime | 18                        |
| 1/4" Securock GFRB  | 18                        |
| 1 1/2" ISO          | 9.775                     |
| 1 1/2" ISO 4'x 4'   | 10.753                    |
| 1 1/2" Rigid        | 9.775                     |
| 1 1/2" Rigid 4'x 4' | 10.753                    |
| 2" ISO              | 10.775                    |
| 2" ISO 4'x 4'       | 11.853                    |
| 2" Rigid            | 10.775                    |
| 2" Rigid 4'x 4'     | 11.853                    |
| 2.7" ISO            | 12.775                    |
| 2.7" ISO 4'x 4'     | 13.393                    |
| 2.7" Rigid          | 12.775                    |
| 2.7" Rigid 4'x 4'   | 13.393                    |
| 2 1/2" ISO          | 11.775                    |
| 2 1/2" ISO 4'x 4'   | 12.953                    |
| 2 1/2" Rigid        | 11.775                    |
| 2 1/2" Rigid 4'x 4' | 12.953                    |
| 3" ISO              | 13.775                    |
| 3" ISO 4'x 4'       | 14.053                    |
| 3" Rigid            | 13.775                    |
| 3" Rigid 4'x 4'     | 14.053                    |
| 3/8" Dens Deck      | 31.82                     |
| 3/8" Securock GFRB  | 31.82                     |
| 3 1/2" ISO          | 14.775                    |
| 3 1/2" ISO 4'x 4'   | 15.153                    |
| 3 1/2" Rigid        | 14.775                    |
| 3 1/2" Rigid 4'x 4' | 15.153                    |
| 4" ISO              | 15.775                    |
| 4" ISO 4'x 4'       | 16.253                    |
| 4" Rigid            | 15.775                    |
| 4" Rigid 4'x 4'     | 16.253                    |
| 5/8" DensDeck Prime | 25                        |
| 5/8" F/C Sheet Rock | 25                        |
| 5/8" Securock GFRB  | 25                        |
| Duro-Blue Slipsheet | 2                         |
| Duro-Fold           | 6.9                       |
| Duro-Weave          | 2                         |
| FR 10               | 3.5                       |
| FR 50               | 5.6                       |
| Geotextile          | 2.65                      |
| Ultra-Fold          | 6.9                       |

| count | per_sqft | selected |
| ----- | -------- | -------- |
| 5     | 0.15625  | yes      |
| 6     | 0.1875   |          |
| 8     | 0.25     |          |
| 10    | 0.3125   |          |
| 12    | 0.375    |          |
| 14    | 0.4375   |          |
| 16    | 0.5      |          |
| 18    | 0.5625   |          |
| 20    | 0.625    |          |

| deck            | minutes_per_fastener |
| --------------- | -------------------- |
| Wood            | 0.342                |
| Steel           | 0.462                |
| Gypsum          | 1.3                  |
| Tectum          | 0.858                |
| Concrete        | 2.185                |
| LWC / Other     | 1.3                  |
| LWC / Steel     | 2.185                |
| LWC / Concrete  | 0.858                |
| Metal Retrofit  | 0.462                |
| Purlin Fastened | 0.462                |

### C.10 Tear-off labor (hours per 100 sq ft, by tear-off type and deck)

Tearoff Times tab. Custom values entered in Hours per 100 sqft; a 0 value means Bid-Advantage uses its default (hover-to-view). All Labor(Hrs) cells are green/editable. Legacy screen is a flat list of Roof Deck x Tear Off Type x Labor(Hrs); pivoted here to tearoff_type rows x deck columns. Metal Retrofit and Purlin Fastened decks are all 0 (use default). Tear Off Type names are the full legacy names (DataAccess Management.DBLoadRefTables, ExistingRoofID 1-14; the legacy admin grid showed them truncated).

| tearoff_type                        | Wood   | Gypsum | Tectum | Concrete | LWC over Other | LWC over Steel | Metal Retrofit | Purlin Fastened | Structural Metal | LWC over Concrete |
| ----------------------------------- | ------ | ------ | ------ | -------- | -------------- | -------------- | -------------- | --------------- | ---------------- | ----------------- |
| Ballasted Single Ply(EPDM)          | 1.2438 | 1.2438 | 1.2438 | 1.2438   | 1.2438         | 1.2438         | 0              | 0               | 1.2438           | 1.2438            |
| Fully Adhered Single Ply            | 1.3743 | 1.4724 | 1.4724 | 2.4876   | 1.4724         | 1.4724         | 0              | 0               | 1.2438           | 1.4724            |
| Mechanically Fastened Single Ply 7' | 1.7676 | 1.8657 | 1.8657 | 3.2724   | 1.8657         | 1.8657         | 0              | 0               | 1.6362           | 1.8657            |
| Mechanically Fastened SP 5' centers | 2.1924 | 2.2905 | 2.2905 | 4.1238   | 2.2905         | 2.2905         | 0              | 0               | 2.0619           | 2.2905            |
| Single Ply Adhered over BUR < 2"    | 2.88   | 1.8657 | 1.8657 | 1.6362   | 1.8657         | 1.8657         | 0              | 0               | 1.6362           | 1.8657            |
| Single Ply M F 7' over BUR < 2"     | 3.2724 | 2.2581 | 2.2581 | 2.0295   | 2.2581         | 2.2581         | 0              | 0               | 2.0295           | 2.2581            |
| Single Ply MF 5' over BUR < 2"      | 3.6981 | 2.6838 | 2.6838 | 2.4543   | 2.6838         | 2.6838         | 0              | 0               | 2.4543           | 2.6838            |
| BUR < 2"                            | 2.4876 | 1.4724 | 1.4724 | 1.2438   | 1.4724         | 1.4724         | 0              | 0               | 1.2438           | 1.4724            |
| BUR < 4"                            | 4.1238 | 2.2905 | 2.2905 | 2.0619   | 2.2905         | 2.2905         | 0              | 0               | 2.0619           | 2.2905            |
| BUR < 6"                            | 5.76   | 3.4362 | 3.4362 | 2.88     | 3.4362         | 3.4362         | 0              | 0               | 2.88             | 3.4362            |
| Spray URET < 3"                     | 4.1238 | 2.2905 | 2.2    | 1.2438   | 2.2905         | 2.2905         | 0              | 0               | 2.0619           | 2.2905            |
| URET < 3" BUR < 2"                  | 5.76   | 3.4362 | 3.4    | 2.0619   | 3.4362         | 3.4362         | 0              | 0               | 2.88             | 3.4362            |
| URET < 6" BUR < 2"                  | 6.9    | 4.6    | 4.6    | 2.88     | 4.6            | 4.6            | 0              | 0               | 3                | 4.6               |
| URET < 9" BUR < 2"                  | 8      | 5.8    | 5.8    | 3.2      | 5.8            | 5.8            | 0              | 0               | 4                | 5.8               |

### C.11 Setup and inspection

Setup minimum hours: `[{"id": 1, "minimum_hours": 16}]`; steps (roof sq ft up to → hours per sq ft):

| sqft   | multiplier |
| ------ | ---------- |
| 6000   | 0.003      |
| 20000  | 0.003      |
| 100000 | 0.003      |

Inspection (roof sq ft from → hours):

| sqft   | hours |
| ------ | ----- |
| 0      | 5     |
| 5001   | 7     |
| 10001  | 10    |
| 20001  | 13    |
| 50001  | 16    |
| 100001 | 19    |
| 150001 | 23    |

### C.12 Accessory labor (`accessory_labor`)

#### `accessory_others` — Accessory Others

| Description                            | Labor(Hrs) |
| -------------------------------------- | ---------- |
| 30" x 60" White - Walk Pad             | 0.5        |
| 60" x 60" White - Walk Pad             | 0.5        |
| 30" x 60" Gray - Walk Pad              | 0.5        |
| 60" x 60" Gray - Walk Pad              | 0.5        |
| 30" x 60" Safety - Walk Pad            | 0.5        |
| 60" x 60" Safety - Walk Pad            | 0.5        |
| White Parapet Wall Vent                | 0.5        |
| Tan Parapet Wall Vent                  | 0.5        |
| Gray Parapet Wall Vent                 | 0.5        |
| 30" x 60" Tan - Walk Pad               | 0.5        |
| 60" x 60" Tan - Walk Pad               | 0.5        |
| 30"X 60" Safety Fully Skirted Walk Pad | 0.65       |
| 30"X 60" White Fully Skirted Walk Pad  | 0.65       |

#### `corners` — Corners

| Description               | Labor(Hrs) |
| ------------------------- | ---------- |
| Inside 6" x 6"            | 0.1667     |
| Inside 6" x 18"           | 0.1667     |
| Outside 6" x 6"           | 0.1667     |
| Outside 6" x 18"          | 0.2222     |
| Outside 18" x 12"         | 0.3333     |
| Outside Butterfly 6" x 6" | 0.2222     |

#### `drain_boots` — Drain Boots

| Description    | Labor(Hrs) |
| -------------- | ---------- |
| 2" Drain Boot  | 0.5        |
| 2½" Drain Boot | 0.5        |
| 3" Drain Boot  | 0.5        |
| 3½" Drain Boot | 0.5        |
| 4" Drain Boot  | 0.5        |
| 4½" Drain Boot | 0.5        |
| 5" Drain Boot  | 0.5        |
| 5½" Drain Boot | 0.5        |
| 6" Drain Boot  | 0.5        |
| 6½" Drain Boot | 0.5        |
| 7" Drain Boot  | 0.5        |
| 7½" Drain Boot | 0.5        |
| 8" Drain Boot  | 0.5        |

#### `drain_roof_types` — Drain Roof Types

| Description | Area Prep Labor(Hrs) | Reinstallation Labor (Hrs) |
| ----------- | -------------------- | -------------------------- |
| None        | 0                    | 0.25                       |
| Single Ply  | 0.25                 | 0.25                       |
| BUR         | 0.5                  | 0.5                        |
| GS BUR      | 0.75                 | 0.75                       |

#### `drip_edges` — Drip Edges

| Description         | Labor(Hrs) |
| ------------------- | ---------- |
| Drip Edge 2"        | 0.0275     |
| Drip Edge 2" Corner | 0.2        |
| Drip Edge 4"        | 0.0275     |
| Drip Edge 4" Corner | 0.2        |

#### `fascia_bars` — Fascia Bars

| Description    | PreDrill Labor(Hrs) | NoDrill Labor (Hrs) |
| -------------- | ------------------- | ------------------- |
| 1¾" Fascia Bar | 0.0374              | 0.0187              |
| 4" Fascia Bar  | 0.0395              | 0.0197              |

#### `gravel_stops` — Gravel Stops

| Description           | NoDrill Labor (Hrs) |
| --------------------- | ------------------- |
| Gravel Stop 2"        | 0.0275              |
| Gravel Stop 2" Corner | 0.2                 |
| Gravel Stop 4"        | 0.0275              |
| Gravel Stop 4" Corner | 0.2                 |

#### `membrane_accs` — Membrane Accs

| Description                       | Labor (Hrs) |
| --------------------------------- | ----------- |
| ARP (SqFt)                        | 0           |
| T-Patch                           | 0.1         |
| 1' of Stripping w/ 6"oc Fasteners | 0.04        |

#### `pipe_stack_usages` — Pipe Stack Usages

| Description | Multiplier |
| ----------- | ---------- |
| Plumbing    | 0.5        |
| Hot Stack   | 1          |
| Pitch Pan   | 1.5        |

#### `strainers` — Strainers

| Description             | Labor(Hrs) |
| ----------------------- | ---------- |
| 3" - 4" PVC Drains      | 0          |
| 3"-5" Black Leaf Grates | 0.25       |
| Dome Strainer           | 0.5        |
| 2" Drain Adapter        | 0.25       |

#### `termination_bars` — Termination Bars

| Description | PreDrill Labor(Hrs) | NoDrill Labor (Hrs) |
| ----------- | ------------------- | ------------------- |
| Term Bar    | 0.035               | 0.0175              |

#### `two_piece_metals` — Two Piece Metals

| Description            | Labor (Hr/Ft) | Corner Labor(Hr/Piece) |
| ---------------------- | ------------- | ---------------------- |
| 3" 2-Piece Compression | 0.043         | 0.2                    |
| 4" 2-Piece Compression | 0.043         | 0.2                    |
| 5" 2-Piece Compression | 0.043         | 0.2                    |
| 6" 2-Piece Compression | 0.043         | 0.2                    |
| 7" 2-Piece Compression | 0.043         | 0.2                    |
| 8" 2-Piece Compression | 0.043         | 0.2                    |

#### `vents` — Vents

| Description | Labor(Hrs) |
| ----------- | ---------- |
| Vents       | 0.5        |

#### `washers` — Washers

| Description         | Labor(Hrs) |
| ------------------- | ---------- |
| 1/2" Conduit Washer | 0.3333     |
| 3/4" Conduit Washer | 0.3333     |
| 1" Conduit Washer   | 0.3333     |

### C.13 Shipping, settings, markup

| material_threshold | shipping_cost |
| ------------------ | ------------- |
| 0                  | 800           |
| 5001               | 975           |
| 7500               | 1050          |
| 10000              | 1100          |
| 15001              | 1200          |
| 20001              | 1300          |
| 40001              | 2000          |
| 80001              | 2600          |
| 120001             | 3300          |
| 170000             | 4000          |

Company settings: `{"company_name": "JBK, Inc", "master_elite": true, "labor_display": "man_hours", "sales_tax_rate": 0.0625, "shipping_method": "stepped", "shipping_percent": 0, "hours_per_man_day": 9}`

| name    | is_default | hourly_rate | markup_type  | markup_amount | include_per_diem | include_commission |
| ------- | ---------- | ----------- | ------------ | ------------- | ---------------- | ------------------ |
| Default | yes        | 45          | gross_profit | 35            | no               | no                 |
