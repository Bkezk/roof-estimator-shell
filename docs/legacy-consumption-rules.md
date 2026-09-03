# Legacy Bid-Advantage: fastener spacing, consumption rules, and Field Tab Spacing

Extracted 2026-09-03 from the shipped application files — `BidAdvantage.DataAccess.SqlScript.xml`
(the app's own DB bootstrap script; all seed rows copied verbatim into
`supabase/migrations/20260903010000_legacy_fastener_adhesive_tables.sql`) and the decompiled IL of
`DataAccess.dll` / `Estimator.exe` (method names cited per rule). **Nothing here is inferred from
behavior**; every formula was read from the disassembly. Items the source does not contain are
flagged at the end.

Legend: RS = RoofSystemID (1 = durolast, 2 = durobond, 3 = durotuff, 4 = duroroof, per the seeded
`legacy_roof_system` table). Deck IDs per `global_DeckType` (1 Wood, 2 Structural Metal,
3 Metal Retrofit, 4 Concrete, 5 Gypsum, 6 LWC/Steel, 7 LWC/Concrete, 8 LWC/Other, 9 Tectum,
10 Purlin Fastened).

---

## 1. Pull test → fastener on-center spacing

**Data**: `MechFastenerLookup` (186 rows, seeded as `mech_fastener_lookup`). Key:
`(RS, MembraneThickness, DesignTable, TabSpacing, PullTest)` → `(FieldSpacing, PerimSpacing,
CornerSpacing)` in inches. `-1` means "any" in key columns and "not permitted" in value columns.

**Algorithm** — `cMechanicalSystem.UniversalFastenerSpacing(thickness, designTable, tabSpacings[],
pullTest, columnOffset, out result)` (DataAccess, rva 0x313cc):

1. Filter rows to `MembraneThickness ∈ {thickness, -1}`. No rows → error **-5**.
2. Filter to `DesignTable == designTable` (exact). No rows → error **-1**.
3. Filter to `TabSpacing ∈ {…tabSpacings, -1}` (the caller passes `[FieldLap]` for field,
   `[PerimeterLap]` for perim). No rows → error **-2**.
4. Walk the remaining rows in table order; skip every row whose `PullTest` is **greater than** the
   entered pull-test value (or negative), leaving error **-3** if none qualifies; the **first row
   with `PullTest ≤ entered value` wins**, and the result is column `FieldSpacing + columnOffset`
   (offset 0 = field, 1 = perimeter, 2 = corner). A winning value of `-1` still returns failure
   (that combination is not permitted).

**Ordering caveat (port requirement)**: the loading query
(`Select … From MechFastenerLookup Where ManufacturerID = <m> AND RoofSystemID = <rs>`, string at
US token 0x70007a62) has **no ORDER BY** — the app relies on the clustered PK order
(`…, TabSpacing ASC, PullTest DESC`). With PullTest descending, "first row ≤ entered" = the
**largest threshold the measured pull test satisfies** (e.g. RS1, DT60, tab 28, pull test 300 →
thresholds 450/210/150/140 → 210 wins → 18" o.c.). A port MUST sort `PullTest DESC` explicitly.

**How deck type factors in**: it does not. `MechFastenerLookup` has no deck column; deck type
affects *labor* (`MechDeckTypeMulti`), fastener *subtype eligibility* (§2.6), and system
compatibility — never the spacing itself. The inputs are exactly: roof system, membrane thickness
(only Duro-Bond rows discriminate: 40/50/60), the wind design table (`RoofSection.DesignTable`,
psf: 60–210 by 15s), tab spacing (= Field/Perimeter Lap), and the pull-test lbs
(`RoofSection.PullTest`, XML default 350).

Callers verified: `frmHome.TestForEnhancement`, `frmRoofSection` (offset 0 with `FieldLap`;
`CustomFieldLap ≠ -1` overrides), `RoofSystem.MechFieldLaborRate`, and the perim path (offset 1
with `PerimeterLap`) in DataAccess. Engine impact: our `customFieldFastenerSpacing` inputs can now
be auto-derived; the manual override stays (the app itself has custom overrides).

There is also a **legacy Duro-Last-only** table the DL row-style path references:
`SELECT Weight, PullTestID, FastenerSpacing, [28TabMultiplyer], [60TabMultiplyer],
[120TabMultiplyer] FROM lookup_FastenerSpacing` — its rows live in the MySQL DB (NOT in
SqlScript.xml) and are **not captured** (flagged below).

---

## 2. Consumption / auto-quantity rules (the red "needed" quantities)

Mechanism (frmAccFasteners.InitializeTotals/UpdateTotals, Estimator.exe): per deck-family bucket
the app computes *needed* counts, subtracts what the estimator has already added from the
catalog, and shows the remainder — **red when > 0, green when ≤ 0**. Sealants work the same way
via `Sealant.CalcQty` (needed) vs `Quantity` (entered).

### 2.1 Edge metals & bars — screws
- **Termination bar** (`TermBar.Fasteners`, rva 0x2561a), **fascia bar** (`FaciaBar.Fasteners`),
  **drip edge / gravel stop** (`GenericEdges.Fasteners`, length incl. scrap):
  `fasteners = Ceiling(totalLengthFt / 10 × 21)` — **21 fasteners per 10-ft bar** (~5.7" o.c.).
- **Two-piece metal** (`TwoPieceMetals.Fasteners`): sizes {0,2,3} →
  `Ceiling(len/10 × 42)`; other sizes → `Ceiling(len/10 × 63)` (42 or 63 per 10 ft — base+cover).
- Fastener totals array (Accessories.GetEdgingFastenerTotals): [termBars, fascia size 3,
  fascia size 4, dripEdges, gravelStops, parapetEdge, twoPiece].

### 2.2 Membrane fastening — screws & plates
- Screws needed = `RoofSection.MembraneFasteners` (field + perim row-style counts —
  `DuroLastFunctions.DLRowStyleFastenersField/Perim`, already ported in our engine §2).
- **Plates = 1 per membrane screw.** They count as **Poly Plates** normally; when the
  field attachment is `durobondmech`, the needed plates are **Induction Plates** and the count is
  the *underlayment* fastener count (Duro-Bond welds the membrane to the insulation plates).
- **Parapet deck fasteners** (`Parapet.get_DeckFasteners`, rva 0x427b6):
  `ToInt32(AdjustedLength)` — **1 per foot of parapet length**; they add to both the screw and
  poly-plate needed counts. Parapet membrane **edge/tab fasteners** (`Parapet.get_EdgeFasteners`):
  Duro-Last mech with vertical > 30": `Ceiling(AdjustedLength / In2Ft(12) × calcTabCount)`
  (good-tabs path: `Round(AdjustedLength / In2Ft(15) × TabCount)`); vertical ≤ 30" → 0.

### 2.3 Insulation attachment — screws & plates
`RoofSection.UnderlaymentLayerFieldFasteners` / `…PerimFasteners` (rva 0x4d23c / 0x4d00c), per
mechanically-attached layer (`durolastmech`), area = field or perimeter area:

| membrane attachment over it | board SubType 1 | SubType 7 or 8 | all other boards |
|---|---|---|---|
| mechanical | `Round(Ceil(area × 0.08))` | `Round(area/16) × 4` | `Round(area/32) × 5` |
| adhered / Duro-Bond | (same 0.08 path) | `Round(area/16) × 5` (field) / `×8` (perim) | `Round(area/32) × 10` (field) / `×16` (perim) |

i.e. the default is **5 fasteners per 4×8 board** (32 sq ft), doubled (and more at the perimeter)
when the insulation must hold the whole adhered/induction assembly. Custom densities
(`UCustomFastenersDensity`) override as fasteners/sq ft. **Insulation plates = 1 per insulation
screw.** (Board SubType meanings live in `ref_UnderlaymentTypes` in MySQL — not captured;
7/8 are per-16-sq-ft boards, i.e. 4×4.)

### 2.4 Adhesives (incl. solvent-based) — units
Tables seeded this commit: `legacy_adhesive` (10 adhesives with unit types & ribbon spacings),
`adhesive_coverage_deck` (sq ft/unit by deck), `adhesive_coverage_underlayment` (sq ft/unit by
board group), `adhesive_wall_coverage` (350/300 sq ft/unit), `adhesive_ribbon_spacing` (labor
multiplier 1 / 1.1 / 1.2 at 12" / 6" / 4" ribbons), `adhesive_labor_per_ksqft`,
`adhesive_allowed_under`, `underlayment_group`.

- **Membrane adhesive** (`RoofSection.MembraneAdhesive`, rva 0x4d800), full-coverage adhesives
  (FieldSpacing = -1, e.g. Water Based ID 1, **Solvent Based ID 2**):
  `units = (AreaField + AreaPerimeter + AreaCorner) / coverage`, where coverage =
  `LookupCoverageRate(kind, key, adhesive)` — kind 0 keyed by deck (bottom layer), kind 1 keyed
  by the underlayment group it adheres to, kind 2 wall coverage.
- **Underlayment adhesive** (`RoofSection.UnderlaymentAdhesive`, rva 0x4d470): per adhered layer,
  `units = area / coverage(surface below) × (customSpacing ? 12/spacing : 1)`; boards flagged
  `AdhesiveNeedsQuoteAdhesiveUnits` take a quoted unit count instead.
- **Parapet wall adhesive** (`Parapet.get_WallAdhesive`): `WallPlusTopSqFt / wallCoverage`.
- **Aggregation** (`AdheredSystems.AggregateCalcQtys`, rva 0x2be28): per adhesive, sum
  membrane + all layers + all parapets across the estimate, then **`Ceiling` once to whole
  units**. ⚠ Premise correction for our engine: Phase 9d prices fractional units per layer; the
  legacy app ceilings the per-adhesive total at estimate level. Fix when wiring (Phase 6 will
  verify).
- **Adhesive labor** confirmed: `adhesive_labor_per_ksqft` (a.k.a. AdhesiveCoverage.DefaultLabor,
  `RSAdhesiveCoverage.get_HoursPerKSqFt`) is **hours per 1,000 sq ft**, resolving the flagged
  §3.3 scale question — our `underlaymentAdhesive` hrs/1000 model matches the binary.

### 2.5 Sealants & mastics (`Sealants.RecalcParents`, rva 0x22208)
- **Duro-Caulk by color** (RefIDs 12–15 zone): per DL color,
  `tubes = Ceiling(termBarLF(color) + fasciaCoverLF(color)) / 12` — **1 tube per 12 LF**.
- **Drains**: + `1 tube per drain` (added to the White/Gray bucket, index 2).
- **Washers**: + `Ceiling(0.25 × washerQty)` — **1 tube per 4 washers**.
- **Pipe stacks**: per-color tube counts from `PipeStacks.SealantAmount`
  (`SealantLinealFt = linealDiameter × qty` feeds it; per-size multiplier in
  `PipeStackSize.SealantMultiplyer` — MySQL values not captured).
- **Strip mastic** (RefID 9): per bar `RoundToNextTen(Ceil(len × 1.03))` (3% scrap, round up to
  10 ft; applied twice in the summation — once in `GetStripMasticLen`, once in the caller), then
  `rolls = Ceiling(totalFt / 350)` — **350 LF per unit**.
- **Pitch pocket filler** (RefID 10): pipe stacks with Usage ID 3 contribute
  `(qty + (isOpen ? 1 : 0)) × rate` with rate by size: >15" → 4, >11" → 3, >8" → 2, else 1;
  plus `Σ PitchPan.Qty × PitchPan.FillerAmount`.
- **Duro-Roof seam sealant** (RefID 19): over Duro-Roof sections only,
  `seamLF = FieldWidth/In2Ft(FieldLap) × FieldLength + PerimEnhWidth/(PerimSpacing/12) ×
  (PerimLF + CornerLF)`; `CalcQty = Round(seamLF / 30 / 5)`.
- Capstone parapets (option ID 2): `Ceiling(Ceil(length)/40)` units per parapet.

### 2.6 Which catalog items satisfy which "needed" bucket (UpdateTotals)
Special ref_Fasteners IDs: **255** → Poly Plates, **256** → parapet-only fasteners,
**257** → Insulation Plates, **303** → Induction Plates (display names live in the MySQL
`ref_Fasteners` — not captured). Every other fastener line counts against the screw bucket only
when its `Subtype` is allowed for the section's deck family:

| deck family (bucket) | allowed subtypes |
|---|---|
| Wood (1) | drill point, spade, xhd |
| Structural Metal / Metal Retrofit / Purlin (2,3,10) | drill point, spade, purlin, xhd |
| Gypsum / LWC-Other / Tectum (5,8,9) | ntb, auger |
| Concrete (4) | concrete screw, nail |
| LWC/Concrete (7) | concrete screw, nail, ntb, auger |
| LWC/Steel (6) | drill point, spade, purlin, xhd |

---

## 3. Field Tab Spacing (the section-screen "60" vs the admin "28 × 1.5125")

`RoofSection.FieldLap` — the section screen's Field Tab Spacing, XML default 60 — is the membrane
sheet's **tab (fastening-row) spacing in inches**. The valid choices per roof system are
`RSSheetTabSpacing` (seeded as `mech_sheet_tab_spacing`): Duro-Last 28 / 60 / 120; Duro-Roof
57 / 87 / 120. One value drives BOTH:

1. **Fastener rows / quantities**: it is the `TabSpacing` key into `MechFastenerLookup` (§1) and
   the row-pitch in the row-style fastener count (rows ≈ width / tab spacing — already in our
   engine §2), so it determines how many fastener rows exist and which o.c. spacing is permitted.
2. **Labor**: `MechTabMulti` maps it to the labor multiplier — the admin screen's "28 → 1.5125"
   is exactly the RS1 row (28 → 1.5125, 60 → 1.0, 64 → 1.0, 120 → 0.8; Duro-Tuff 30 → 2.8,
   60 → 1.4, 120 → 0.95; Duro-Roof 57/64 → 1.25, 87 → 1.12, 120 → 1.0). Loaded per system in the
   `cMechanicalSystem` ctor alongside `MechOnCenterMulti` (o.c. → multiplier) and
   `MechDeckTypeMulti`. Cross-checked against our seeded `rdl_combos` (live query, 2026-09-03):
   deck multipliers and on-center multipliers are identical to the binary; the tab set is NOT —
   our combo carries only the screenshot's base row (28 → 1.5125) while the binary also defines
   60 → 1.0, 64 → 1.0, 120 → 0.8 for RS1. GAP: the web estimator has no tab-spacing picker, so a
   60- or 120-tab sheet would today price at the 28-tab multiplier; the full values above are
   what to wire.

So neither "drives" the other: 60 (the section value) selects the sheet's tab pitch; 28 with
multiplier 1.5125 is a *different selectable pitch* whose labor premium the admin screen edits.
`CustomFieldLap ≠ -1` overrides the section value in every lookup.

---

## Not captured (do not invent — needs live MySQL or a captured bid)
- `lookup_FastenerSpacing` rows (legacy DL Weight/PullTestID table with per-tab multipliers).
- `ref_Fasteners` / `ref_Sealants` display names for the special IDs (255/256/257/303; sealant
  RefIDs 9/10/12–15/19) and per-box quantities (`Fastener.RoundUnitsToBoxes/ReqBoxes` reads
  box sizes from the catalog).
- `ref_UnderlaymentTypes.SubType` meanings (which boards are SubTypes 1/7/8).
- `PipeStackSize.SealantMultiplyer` values and pitch-pan `FillerAmount` values.
- The adhered-membrane ribbon-spacing branch of `MembraneAdhesive` for spacing ≠ -1 adhesives
  (OlyBond/Millennium: field 12" / perim 6" defaults are in `legacy_adhesive`) and the `durogrip`
  special path — traced only partially.
- Term/fascia/edge *auto-lengths* (`GetRoofEdgeLength`/`GetParapetLength`/`GetCurbEdgeLength` —
  which roof edges feed each bar type) — present in IL, not yet transcribed.
