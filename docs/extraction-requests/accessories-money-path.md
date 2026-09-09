# Extraction request §12 — Accessories money path (frmAccessories + all 21 sub-screens)

**To the decompiler session:** please extract, IL-exact, the complete money path for the legacy
Accessories tab. We have full layout captures of all 21 screens in the left tree; what we need is
every formula, ref-table, and billing route so the web build can implement without inference.
Deliverables in the usual format: a `git format-patch` appendix to `docs/legacy-money-parity.md`
(§12) plus a walkthrough report. Where a value comes from a ref table we cannot see in IL, say so
explicitly and give the table/column names so we can capture it from the licensed app's UI.

Observed anchors from the user's captures (one test bid, footer reading
**Material Cost $264.25 / Total Labor 3.78 h / Labor Cost $169.88**) — please make the extracted
formulas reproduce these:

- **Drip Edge (2" tab)**: Roof Edges: 1 → Calculated Total: 1, Adj. Total Length: 10 ft,
  Fasteners Needed: **21**, Labor link 0.28 h.
- **Fasteners → Wood deck**: Items Required header **Fasteners: 925, Poly Plates: 925**,
  Insul. Plates: 0, Induction Plates: 0.
- **Vents**: White Vent = 7, Labor link **3.5 h (100%)**.
- **Conduit Washers / Corners / Pipe Stacks / Drains / Walk Pads**: all zero in the captures.

## A. Shared frame semantics (applies to every screen)

1. **Billing routes**: for each screen, which `dTotals`/`dMaterial` slot the material lands in and
   which labor bucket the hours land in (crew labor at $/hr? separate?). Same slot map convention
   as §8/§10.
2. **The "Labor: X h. (100%)" hyperlink**: exact dialog fields and formula. Is the percentage a
   multiplier on a computed base-hours figure, and where is the base stored/overridden? What does
   a plain "0 h." link (no %) mean (Corners, Conduit Washers, Membrane Acc. ARP row)?
3. **"Extra" columns (green)**: confirm they are user-entered additive quantities; whether Extra
   units price at the same rate as Calc Qty and whether they contribute labor.
4. **Green vs white cells**: confirm green = editable, white = computed/readonly, per grid.
5. **The "Accessories Summary" hyperlink** at top: what the summary window shows and whether it
   has any inputs that affect money.

## B. Edge Terminations (Term Bar, 1-3/4" Fascia, 4" Fascia, Gravel Stop, Drip Edge, Base & Snap Cover)

1. **Counts header** ("Roof Edges: N", "Parapets: N", Term Bar also "Curbs: N"): the exact query
   that derives each count. Which roof-section edge Termination selections map to which screen
   (full termination-option-ID → screen mapping table), which parapet Termination sub-tab
   selections count as "Parapets", and which curb term options count as "Curbs" on Term Bar.
2. **The parapet Termination sub-tab itself**: we have not built it yet. Please extract its full
   model — fields, options, defaults from Setup, and how each option feeds (a) these accessory
   counts and (b) any direct money (it looks prerequisite to "Parapets: N").
3. **Calculated Total**: formula per screen. Source length (raw edge length vs AdjustedLength,
   any ×1.03), piece length divisor per product (10 ft sticks?), rounding function
   (Ceil? bankersRound?), and per-color splitting for Gravel Stop / Drip Edge (2" and 4" tabs).
4. **Additional Required**: confirm pure user input in pieces; price basis per piece vs per LF,
   and exactly which catalog Description each screen/color/drill-mode buys
   (No Drill vs Pre-Drill on Term Bar; W/T/G columns; "(Additional added as White)" note on the
   vinyl fascia rows — confirm additional pieces always price as White).
5. **Adj. Total Length**: formula (pieces × piece length? includes Additional?).
6. **Fasteners Needed**: formula per screen — the Drip Edge anchor is 10 ft → 21. Give spacing
   per screen/product, the rounding, and whether Additional pieces add fasteners.
7. **Fastener grid** (Metal Anchors / 1½" Collated Screws / 1¼" Hex Head / 1½" Roofing Nails /
   1½"–3" Spade / 1 5/8" #12 Stainless; Base & Snap Cover header "Compression or Snap Cover"):
   how the needed count auto-distributes to a default row (what picks the default — wall type,
   deck type, Setup?), whether user edits redistribute, and each row's catalog link + price basis
   (per fastener vs per box) + labor if any.
8. **Term Bar specifics**: Peel Stop rows (their counts source + catalog rows), the per-column
   Sub-Totals, and the **Use Strip Mastic** checkbox — its formula and where the mastic quantity
   bills (does it feed Sealants → "Strip Mastic (Pail)" Calc Qty?).
9. **Fascia specifics**: Metal cover quantity + Inside/Outside Corners fields — sources, catalog
   rows, price basis; vinyl cover W/T/G quantities.
10. **Gravel Stop specifics**: per-color Calculated Total + Additional + Corners (outside only)
    — corner count source and catalog rows; Metal Cover field.
11. **Base & Snap Cover specifics**: per-size tabs 3"–8" with "(N ft)" captions — the LF input
    per size, its Calculated Total derivation (from which terminations?), Metal Snap Cover group
    (Cover checkbox + qty, Inside, Outside) semantics and catalog rows.
12. **Labor**: base-hours formula per screen (the 0.28 h at 10 ft Drip Edge anchor; per LF? per
    piece?), and per-screen rate constants.

## C. Flashing & Other Accessories

1. **Corners**: does anything auto-populate the six corner rows (Inside 6"×6" … Outside Butterfly
   6"×6") from section/parapet corner data, or all user-entered? Catalog rows + labor formula.
   Why a single "White" column (colored corners priced elsewhere?).
2. **Pipe Stacks**: the Usage dropdown's full option list (we saw "Plumbing"), Open/Closed and
   Size lists per usage, Color list; the catalog row each (size, open/closed, color) combination
   buys; "Individual Pipe Stack Labor" default hours and the Total Labor formula; whether Usage
   affects money or is descriptive.
3. **Conduit Washers**: catalog rows for ½"/¾"/1" and the labor formula for its "0 h. (100%)"
   link (base hours per washer?).
4. **Roof Drains & Boots**: full field semantics — Qty; Existing Roof (None/Single Ply/BUR/GS
   BUR) money/labor effect; the "Reuse Existing D…" (truncated) checkbox; Drain Boot Size list +
   catalog rows; Drain Ring Size ("2" Drain Rings") + rows; "Individual Drain Labor" default;
   the entries list; and the **Drain Accessories** strainer grid (3"-4" PVC Drains 0.00 h,
   3"-5" Black Leaf Grates 0.25 h, Dome Strainer 0.50 h, 2" Drain Adapter 0.25 h) — price rows +
   confirm Hours/Unit multiplies quantity into labor.
5. **Walk Pads**: input model and formula (LF/SF → pads or rolls, rounding), catalog row, labor.

## D. Calculated Items

1. **Panduit Straps**: Calc Qty formulas for 3/8"×14", 3/8"×20", and the Panduit Tool row (what
   triggers a tool), Boxes column conversion (straps per box; is Boxes the billed unit?), Extra
   handling.
2. **Sealants**: per-row Calc Qty formula — Strip Mastic (Pail) 1129, Pitch Pocket Filler 10.2 oz
   1121 / 30 oz 1122, SB-240 Mastic 5-gal 1123, Duro-Caulk Plus White/Tan/Gray/Bronze
   1136/1138/1134/1135, Tab Sealer 1119T. Which upstream inputs drive each (Term Bar strip
   mastic? curb counterflash sealant-tube note from §8.3? tab systems → Tab Sealer?). Also the
   "Show Discontinued Sealants" flag semantics.
3. **Adhesives**: per-row Calc Qty formula — Water Based 1111, Solvent Based 1112…, Duro-Fleece
   2-box 1107 / cartridge 1106, Duro-Grip CR-20 1109, OlyBond500 Bag-in-Box 1108 / SpotShot 1106,
   Millenium One Step 1105, PG1 Boxes 1130, PG1 Drums. How section membrane/underlayment
   attachment choices + coverage rates drive these, and how this relates to the §10.7
   QuoteAdhesiveUnits path (no double-billing).
4. **Membrane Acc.**: formulas for ARP (SqFt) (relation to the §8.6 parapet ARP already billed —
   is this display-only or extra?), T-Patch, and 1' of 10" DL 40mil White Stripping; each row's
   Labor link semantics.
5. **Vents**: quantity source per color (user-entered vs derived — the capture shows White = 7),
   catalog rows, and the labor formula (3.5 h at qty 7 suggests 0.5 h/vent — confirm from IL).

## E. Fasteners & Related

1. **Parapet Wall-Tabs and Steel Plates**: "Fasteners Needed" formula (from parapet wall-tab
   attachment — tab spacing, wall lengths?), which wall types default to which fastener row,
   the **Masonry Bits** grid formula (bits per N fasteners? by wall type?), "Steel Plates
   Needed" formula and the 3" Square Steel DL row.
2. **For Roof Sections & Insulation** (Wood / Metal-Metal Retrofit & Purlin / Gypsum-Tectum & LW /
   Concrete / LW Over Concrete / LW Over Steel):
   - How each roof section's deck type routes its fastener demand to one of the six screens.
   - The **Items Required** formulas: Fasteners, Poly Plates, Insul. Plates, Induction Plates —
     presumably from membrane securement counts (§1/§5 zone math) + insulation layer fastening
     (§10 density math); confirm exactly which counts flow here and reproduce the Wood anchor
     (925/925).
   - **Default row selection**: which size/type row the computed count lands in (fastener length
     from total board stack thickness? deck-specific type — Spade vs Drill Point vs XHD vs Auger
     vs NTB vs Nail vs Concrete Screw vs Purlin), and what happens when the user types other rows.
   - **Plates grid** (2" Poly / 3" Square Steel / 3" Insulation / 2" Barbed Steel / Metal Cleat /
     Induction Welding): distribution rules per deck + attachment method.
   - **Driver Tips** (2" P3 Style Long, 2" Square Drive #3): formula (tips per N fasteners?).
   - **Masonry Bits** grids (Concrete / LW screens): formula.
   - Catalog rows + price basis (per fastener vs per box/pail) for every row on all six screens.
3. Confirm whether these fastener screens **bill** material/labor or are purchasing-list-only —
   the footer Material Cost moved with them in the captures, so presumably they bill; give the
   route.

## F. Ref tables

For every screen above, list the ref tables and columns involved (descriptions, part numbers,
prices, spacing constants, hours/unit), and flag any whose *values* are data we must capture from
the licensed app UI rather than the binary. We will screenshot those from BAManager as before.
