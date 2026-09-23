# Legacy Bid-Advantage: exact money-path rules (final extraction pass, 2026-09-04)

Read from the decompiled IL of `DataAccess.dll` (+ `BAManager.exe` for admin-grid labels); method
rvas cited. Companion to `docs/legacy-consumption-rules.md`. Every formula below is transcribed,
not inferred; open items are flagged, not guessed.

## 1. Membrane price-row selection (Roll Goods vs 28"/60"/120" Tabs)

**Category codes** (proven from `frmMain.LoadDLMembranePriceDGV` in BAManager, which builds the
admin grid rows): `lookup_DuroLastPrices.Category` **5 = Roll Goods, 1 = 28" Tabs, 4 = 60" Tabs,
2 = 120" Tabs, 3 = Parapets**.

**Selection** — `DuroLastSystem.MembraneCost_4_0_230` (rva 0xcb08; `MaterialCost` dispatches on
FormulasVersion, rva 0xcac8):

- If `section.SheetSize.Description == RoofSystem.SheetSizeList[0].Description` (the first sheet
  size — our seeded combo's first label is **"Roll Good"**):
  `cost = MembraneWithOverlap × price(thickness, Category 5, color)`. Done.
- Otherwise (a real sheet size), the membrane is priced by ZONE at TAB tiers. Zone material
  quantities are SHARES of MembraneWithOverlap (`RoofSection.get_MaterialTotalField/Perim/Corner`,
  rva 0x4bab4/0x4bad8/0x4b63c): `MaterialTotalX = (AreaX / AreaTotal) × MembraneWithOverlap`.
  - Field: `lap = CustomFieldLap ≠ -1 ? CustomFieldLap : FieldLap`. If `lap ∉
    RSSheetTabSpacing(roof system)` → `share × CustomFieldSqftCost` (manual $/sqft). Else
    `lap ≥ 120 → Category 2; lap ≥ 60 → Category 4; lap ≥ 24 → Category 1` (below 24: unpriced).
  - Perimeter: **only when `CustomPerimeterLap(0) ≠ -1`** (a raw array read, rva 0x477b8 — no
    fallback; the saved-bid default is -1, so unmarked/default sections skip perim-zone pricing
    entirely — a legacy quirk, ported verbatim). Tiers: not-in-list → CustomPerimSqFtCost;
    `≥ 60 → Category 4; ≥ 24 → Category 1` — **no 120 tier for perim**.
  - Corner: same shape on `CustomCornerLap(0)`; `≥ 60 → 4; ≥ 24 → 1`.
  - **Negative-share carry**: each zone subtracts a running credit `carry` first
    (`share −= carry; carry = 0; if share < 0 { carry = |share|; share = 0 }`) — a zone driven
    negative (AreaField can go negative when zones exceed the section) credits the next zone.
- Default quick-bid sections (no perim sides, no corners): fieldShare = 1, so a tab-sheet
  section prices the full MembraneWithOverlap — but at the TAB tier, not roll goods. CORRECTION
  (adversarial review): the pre-series "always roll goods" was therefore NOT exact for default
  sections on sheet sizes; with the seeded prices a default "1500 sf" / 28-lap Duro-Last section
  repriced ~+9.8% when the tier wiring landed (pinned by test, deliberate). HUMAN GATE RESOLVED
  (2026-09-04): the web default section is aligned to legacy — sheetsizeid 4 is "1500 sf"
  (1-based list), which already matched; the default lap moved 28 → 60.
  Tab-tier zone pricing is DuroLastSystem logic; the other systems' own MaterialCost
  implementations are transcribed in §7.1 (Duro-Roof shares the zone logic with a 57" mid
  threshold; Bond/Tuff/Fleece are flat single-price lookups).

## 2. Curb membrane material (`Curb.Cost`, rva 0x32e3c)

Curbs bill membrane as a **self-contained prefab-wrap model hardcoded in code** — it does NOT use
`lookup_DuroLastPrices`. Components:

- Wrap rate $/sqft, hardcoded by thickness × BAColor id 1..4 — **PROVEN (2026-09-04): ids are
  1 = Tan, 2 = Gray, 3 = White, 4 = Dark Gray** (see §7.2; the earlier web-port assumption
  1 = White was wrong). Capture-era prices by id: 40mil → 0.3481/0.3481/0.3481/0.3544;
  50mil → 0.45/0.45/0.45/0.471875; 60mil → **Tan 0.5625 / Gray 0.5625 / WHITE 0.5437 /
  Dark Gray 0.5906**. Terra Cotta (5) / Rock-Ply (6) / other thickness → rate 0.
- Dimension rounding: `increment6(x) = max(6, roundUpToMultipleOf6(x))`,
  `increment2(x) = max(2, roundUpToMultipleOf2(x))` (inches).
- Style 1 (`CurbStyle.ID` 1): `base = 4.8081 × 1.7819`;
  `A' = inc6(dimA); B' = inc6(dimB); C' = max(12, inc6(dimC)); D' = inc6(dimD)`;
  `wrapSqFt = (2A' + 2B') × (C' + D') / 144`;
  `cost = ((wrapSqFt × rate) + 0.3099 + base) × 2.6047 × qty`.
- Style 2: same with `base = 6.2651 × 1.7819`.
- Style 5: `base = 10.9275 × 1.7819`; `C' = inc6(dimC) < 12 ? 24 : 2×inc6(dimC)`;
  `wrapSqFt = (A' + 2D' + C') × (B' + 2D' + C') / 144` — **CORRECTED 2026-09-09**: the earlier
  transcription (and the port built on it) read the first factor as `2A'+2B' + (2D'+C')`; the
  IL loads dims[0] through increment6 exactly once in this block, with no ×2 and no B' in the
  first factor (re-read of rva 0x32e3c, offsets 201567→201780). Fixed red-first in the same
  series. Multiplier ×2.17777.
- Styles 3 and 4: `cost = -1` (quote required — the app shows these as needs-quote).
- Style 6: `inc2` dims; `wrapSqFt = (2A'+2B') × 30 / 144`; `cost = ((wrapSqFt × rate) + 0.3099 +
  4.8081×1.7819) × 3.04`; if `inc2(dimC) > 18`: `+ ((inc2(dimC)−18) × 2A' + 2B')/144 × 0.3484 ×
  3.04` (verbatim); × qty.
- Style 7 (Metal Scupper) falls outside the 1..6 switch: wrap material = **$0** (the metal
  scupper itself is a quoted/non-DL metal item, not a membrane wrap).
- The final `Round(cost, 8)` is the METHOD tail — it applies to **every** style's result (styles
  1/2/5/6 and the −1 quote markers pass through it), not just style 6 (corrected 2026-09-09).
- Related quantities: `LinealFt = Round((dimA+dimB)/6, 8)` (= footprint perimeter, ft);
  `TotalFt = Round((ΣdimA..D)/12, 8)`; `PolyethyleneSqF = Round(LinealFt × (dimC+dimD) × 5/48 ×
  qty, 8)` when hasPlastic; `SF_ISO = LinealFt × qty` when hasInsulation;
  `ISO_Labor = Round(0.25 + LinealFt × 0.0167 × qty, 2)` (the 0.25 h is per ENTRY, only the
  per-foot part scales with qty — corrected 2026-09-21 from the IL, §22.12);
  `ISO_Fasteners = Ceil(Ceil(LinealFt × qty)/3)`.

The web app's "curb membrane not auto-computed" flag is settled: the legacy amount comes from
these constants (2020-vintage baked-in pricing). PORTED (2026-09-04) in `curb-wrap.ts` — style
picker + C/D dims on the Curbs step; styles 3/4 warn quote-required; style-less older bids stay
manual. The color order is the PROVEN BAColor mapping above (§7.2) — the port's original
White-first assumption was falsified and fixed (60mil White 0.5437 / Gray 0.5625).

## 3. Parapet membrane material & WallPlusTopSqFt

- `Parapet.get_WallPlusTopSqFt` (rva 0x419ba) = **`Length × (Vertical + WallTop) / 12`** (wall
  adhesive basis — vertical + top only, no skirt/cant/drop).
  `WallSqFt = Length × Vertical/12`; `TotalWallSqFT = Length × (Vertical+Drop+Cant+WallTop)/12`.
- Membrane material (`get_MembraneCost`, rva 0x42570):
  `Round(AdjustedSqFt × price(thickness, Category 3 = PARAPETS tier, color), 2)` — the **Parapets
  price row**, not roll goods.
  - `AdjustedLength` (rva 0x42140) = `Pieces ≥ 1 ? Length + 1 + Pieces : 0` (1 ft overlap + 1 ft
    per piece).
  - `AdjustedHeight` (rva 0x420ac), non-Duro-Tuff: `In2Ft(Ceil(Skirt+Cant+Vertical+WallTop+Drop))`
    — the full girth in inches, ceiled to a whole inch, in feet. (Duro-Tuff:
    `Ceil(girth/6)/2` — 6-inch increments.)
  - `AdjustedSqFt` (rva 0x4217c), non-Duro-Tuff: `AdjustedHeight × AdjustedLength`. Duro-Tuff:
    `Ceil(Ft2In(AdjustedHeight)/24) × 30 × AdjustedLength` — UNITS VERDICT (2026-09-04, re-read
    of the full chain): there is **NO In2Ft/÷12 anywhere in it**. `Ft2In(x) = Round(x × 12)`
    (rva 0x41290), the division is by the bare 24, the multiply by the bare 30, then directly
    × AdjustedLength (ft) and × the $/sqft Parapets price. Verbatim legacy output is therefore
    panels × 30 × ft — dimensionally 12× the "30 inches billed per 24-inch panel" reading. The
    web port's ×2.5 ft conversion is the physically sensible interpretation but produces 1/12 of
    the legacy number; exact penny-parity with old Review sheets requires the verbatim ×30.
    ⚠ HUMAN GATE + validation-bid check: either legacy overbilled Duro-Tuff parapet membrane
    12×, or its Parapets price row absorbed the scale — decide verbatim-vs-corrected before
    validating a Duro-Tuff bid.
- Web-engine divergences settled: parapet girth × length was priced at roll goods with no
  Ceil/AdjustedLength; legacy uses the Parapets tier, whole-inch girth, and length+1+pieces.
- PORTED (2026-09-04): profile-dims entry (Skirt/Cant/Vertical/WallTop/Drop; girth = sum), the
  exact WallPlusTopSqFt wall-adhesive basis, and the Duro-Tuff 24"-panel variant (30" billed per
  24" panel, converted to feet for the sqft basis — the one units resolution applied to the
  verbatim formula). Dim-less older bids keep entered girth + the full-girth adhesive stand-in.

## 4. §2.2 geometry: corners, cornerAdj, and the 30 constant

- `corner0–3` are **boolean per-corner marks** (`IsPerimCorner(i)`, corner i between adjacent
  sides). There is no per-corner size input:
  `CornerTotalLength = Σ marked corners × PerimEnhancementWidth` (rva 0x4b5f0) — each marked
  corner contributes one enhancement-width of length; `AreaCorner = CornerTotalLength ×
  enhWidth` = (#corners) × enhWidth².
- `cornerAdj`: `PerimSideLengthMinusCorners_4_0_230(i)` (rva 0x4b69c) = side i's
  `PerimSideLength − enhWidth per ADJACENT marked corner` (both ends). `PerimTotalLength` = Σ of
  those; `AreaPerimeter = PerimTotalLength × enhWidth`; `AreaField = AreaTotal − AreaPerimeter −
  AreaCorner` (_230).
- Axis conventions DISAGREE between functions (both verbatim): `FieldLength` (rva 0x4bafc)
  subtracts enhWidth for perim sides 0/2 from **Length**, while `DLRowStyleFastenersField`
  subtracts its side-0/2 strips from **Width**. Ported each as-is; do not reconcile.
- The DLRowStyle bare `30`: statically determinable as **feet** — the strip array it overwrites
  is subtracted from Length/Width in feet (same typing as the enhancement-width strips). Whether
  a 30-ft carve-out is *intended* still needs a validation bid, but the units are settled.

## 5. Freight basis (`ReviewCalc.Recalculate`, rva 0x4550c)

- **Basis = `dMaterial[20]` = MaterialTotalBeforeTax = Σ dMaterial[0..19]** — ALL material (DL,
  underlayment, accessories, metals, and the six non-DL categories). NOT M0, not membrane-only.
  Premise correction to the web engine, which billed freight on M0.
- Stepped mode (`ShippingCalcMode == 1`): walk the freight table from the LARGEST threshold down;
  first row with `basis > threshold` (STRICT — equal falls to the smaller row) → `freight =
  GoodSingle(cost)`. No row (basis ≤ smallest threshold) → 0.
- Percent mode: `freight = GoodSingle(ShippingCalcPercent × basis)` — the stored value is
  multiplied RAW (no ÷100): legacy stores a fraction. Our admin seed has 0 (unset) so the
  screenshot can't arbitrate the entry convention; the web admin field divides by 100 — keep,
  but the admin screen must store what the estimator enters consistently (flagged).
- `TotalShipping = MaterialFreight + ExtraShipping` (rva 0x47175) ✓ as ported.

## 6. ReviewCalc sweep — LaborSubtotal membership & routing

`dLabor[i, 0|1]` = (dollars, hours). Assignments (Recalculate):
[1] roof sections, [2] parapets, [3] curbs, [4] accessories — `CalcLaborCost(hours)` at the CREW
rate; **[5] metals = `GoodSingle(Metals.LaborCost)` — dollars at each line's OWN rate** (hours in
col 1); [6..9] underlayment layers at crew rate; **[14..19] the six non-DL categories
(Wall+Edge Blocking, Deck Materials, Sheet Metals, Masonry, Custom, +1) — dollars at each line's
OWN rate**; [21] tear-off at crew rate; **[22] = LaborSubtotal1 = Σ[0..21]** (then GoodSingle).
`LaborSubtotal2 = dLabor[upperBound]` = **subcontractors + services ONLY** (each item's labor
AND material cost).

Settled premises for the web engine:
- **Metals labor belongs in LaborSubtotal1** (direct labor, own-rate dollars; its HOURS join
  LS1 hours → TotalManDays → per-diem and $/man-day markup). Currently routed to services (LS2).
  Grand total is unchanged by the row move alone (rows 10+11 both sum into TotalSub1); the money
  difference is via man-days.
- **Non-DL category labor** (sheet metal work, blocking, deck materials, masonry, custom) also
  belongs in LS1 at own rates — same man-days effect. Subs/services stay LS2 (and legacy counts
  their MATERIAL in LS2 too, not in OtherMaterial — the web app models subs/services as non-DL
  lines whose material goes to OtherMaterial; divergence flagged, low impact since both reach
  TotalSub1 pre-markup).
- Discount stacking: `dTotals[4] = M0 + (prepay?[1]) + (stdSize?[2]) + (volume?[3])` — three
  independent additive toggles ✓ matches the port.
- Per-diem: `dTotals[17] = PerDiem × TotalManDays` with the in/out-of-markup branches ✓ matches;
  the man-days BASIS gains metals + non-DL hours per the routing above.
- Bonus finding — **underlayment board material carries a waste factor** (`RoofSection.
  UnderlaymentCost`, rva 0x4bcc4): `length × width × 1.03 × $/sqft` for every board EXCEPT the one
  named "Geotextile", which bills × **1.06**. CORRECTED 2026-09-21 (§22.12): the first reading had
  the two factors swapped — the IL is `CompareString(Name, "Geotextile"); brtrue → 1.03 path`,
  i.e. the branch is taken when the name is NOT Geotextile; a legacy Review screen confirms it
  (4x8 ISO at ×1.03). The web engine bills area × waste × price with 1.06 keyed on the exact
  board name "Geotextile" (case-insensitive).

## 7. Final round (2026-09-04): non-DL-family membrane pricing, BAColor, Duro-Tuff units

### 7.1 Non-Duro-Last membrane MaterialCost implementations (transcribed exactly)
- **Duro-Bond** (`DuroBondSystem.MembraneCost_4_0_230`, rva 0xbc58; _229 identical):
  `cost = MembraneWithOverlap × lookup_DuroBondPrices[key = MembraneType.Thickness].Price` —
  a flat thickness-keyed single price. No color, no tiers, no zones, no sheet-size branch.
- **Duro-Tuff** (`DuroTuffSystem.MaterialCost`, rva 0xf9b0 — no version dispatch): guard
  `ShortName == 'durotuff'`, then
  `cost = MembraneWithOverlap × lookup_DuroTuffPrices[key = Thickness].Price`. Flat, like Bond.
- **Duro-Fleece** (`DuroFleeceSystem.MembraneCost_4_0_230`, rva 0xbd94; _229 identical):
  `cost = MembraneWithOverlap × lookup_DuroFleecePrices[key = MembraneType.ID].Price` — keyed by
  the MEMBRANE TYPE id (the four variants 50mil / 60mil / 50mil Plus / 60mil Plus), not by
  thickness. A bid model carrying only thickness cannot reach the "Plus" rows (flagged).
- **Duro-Roof** (`DuroRoofSystem.MembraneCost_4_0_230`, rva 0xd764): the SAME zone-share logic
  as Duro-Last §1 — same `lookup_DuroLastPrices` categories, same CustomFieldSqftCost/zone-lap
  skip rules and negative-share carry — with three differences: there is **NO roll-good sheet
  branch** (every Duro-Roof section prices by zones), the middle threshold is **57** not 60
  (field, perim AND corner: ≥120 → Cat 2, ≥57 → Cat 4, ≥24 → Cat 1 — Duro-Roof's 57" tab maps
  to the 60"-Tabs price row), and the whole membrane cost is multiplied by **1.05** at the end
  (the surcharge applies to custom-$ zones too).
- Data note: the seeded admin membrane screen carries these families' rows verbatim
  ("Duro-Bond - 40/50/60", "Duro-Tuff - 50/60", "Duro-Fleece - 50mil[/Plus]/60mil[/Plus]") with
  a single price in the White column — the admin-editable equivalents of the legacy flat lookup
  tables.

### 7.2 BAColor: id → color (PROVEN, twice over)
`eDLColorsID` / `eDLColorsIndex` enum field order in the DataAccess metadata: **Tan, Gray,
White, DarkGray, TerraCotta, RockPly** (ids/indices 1..6). Independently,
`DuroLastFunctions.GetCurrentColorPriceIndex` (rva 0xa7108) maps id → lookup_DuroLastPrices
column: 1→3 (TanPrice), 2→4 (GrayPrice), **3→2 (Price — the base/White column)**, 4→5
(DarkGrayPrice), 5→6 (TerraCotta), 6→7 (RockPly). Both agree: **1 = Tan, 2 = Gray, 3 = White,
4 = Dark Gray**. The web port's assumed 1 = White was FALSIFIED — at 60mil the curb wrap rates
for White (0.5437) and Gray (0.5625) were swapped (fixed red-first in the same series). The
PipeStackSize price switch is consistent (case 3 loads m_dWhitePrice).

### 7.3 Duro-Tuff parapet AdjustedSqFt units — see the verdict inline in §3 (no ÷12 exists in
the IL chain; verbatim legacy = 12× the physical reading; human gate before validation).

Still live-DB, uncaptured (for the record): `lookup_Decktimes` contents and live gutter
prices.

Input conventions & follow-ups from the adversarial review:
- `perimLengthFt` is expected CORNER-ADJUSTED (legacy PerimTotalLength subtracts an enhancement
  width per adjacent marked corner); the zone shares and fastener areas both consume it as such.
- `ParapetInput.pieces`: UI input added on the Parapets step (default 1 → length + 2 ft).
- Hour breakdowns (sidebar + CSV) now list the own-rate hours (metals + categorized
  non-DL) that join man-days — "Metals & non-DL" row.
- Stored bids.grand_total goes stale for live-priced (unfrozen) bids after any reprice — known
  property of the snapshot design, listed for the validation pass.

Not settled here (unchanged flags): ribbon-spacing membrane-adhesive branch, `lookup_Decktimes`
(`SELECT TabSpacing, DeckType, FastenerSpacing, Value, CustomValue FROM lookup_Decktimes` —
Azure SQL, see §9), sheet
`NumSheetsReq`, subs/services material row placement at validation.

## 8. Screens round (2026-09-09): curb styles/terminations, parapet tabs & options, per-item labor

Source instruments: DataAccess.dll resolved disassembly (`Management` ref-data ctor at
lines ~86200–86700, `Curb`/`Parapet`/`Parapets` classes, NDL collections), Estimator.exe
disassembly (`frmCurbs` / `frmParapets` / `frmLaborPopUp` handlers), user-string decode via
dnfile. All reference lists below are HARDCODED in the binary (no DB read) unless flagged.

### 8.1 Curb styles — one selection drives BOTH labor and wrap

`Management.oRefCurbStyles` is a hardcoded 7-element array, ids 1..7:
**1 Open, 2 Closed, 3 Open Canted, 4 Closed Canted, 5 With Top, 6 Scupper, 7 Metal Scupper.**

The five toolbar thumbnails on `frmCurbs` map (button → style id → large-image index):
openButton → 1 → img 0; closedButton → 2 → img 1; topButton → **5** → img 3;
scupperButton → 6 → img 4; metalScupperButton → 7 → img 5. The two CANTED variants are not
buttons — they are context-menu items (`mnuOpenCanted` → 3, `mnuClosedCanted` → 4, both showing
img 2).

Every selector sets ONE property, `Curb.Style`, and that single style id drives BOTH sides:
- **Material** — `Curb.Cost` switches on `Style.ID` 1..6 (§2): 3/4 → −1 quote, 7 → $0 wrap.
- **Labor** — `Curb.BaseHours` multiplies by `oLookupCurbTypes[Style.ID]` (below).
The web app's two independent pickers (wrap style + labor curb type) are a split the legacy app
does not have: the admin "curb types" (Open / Closed / Closed w/ Top / Scupper / Metal Scupper)
are the `lookup_CurbTypes` rows keyed by these SAME style ids. ⚠ HUMAN GATE (UI change): collapse
to one style selection deriving both, mapping 1→Open, 2→Closed, 5→Closed w/ Top, 6→Scupper,
7→Metal Scupper; canted 3/4 quote the wrap and need a decision on which labor row they use
(their `lookup_CurbTypes` rows do not exist — the multiplier grid has no canted entries, so canted styles carry no labor multiplier, consistent with being quote-required; see §9.1).

Style side-effects in the form: selecting **With Top (5)** forces termination = None and disables
the termination group (`grpTerm.Enabled = !topButton.Checked` — terminations only disabled for
With Top); **Scupper (6)** and **Metal Scupper (7)** force termination = Scupper-Fascia Bar (1).

### 8.2 `Curb.BaseHours` (rva 0x333a4) — exact transcription

`lookup_CurbTimes` is keyed by `DeckType.ID`; columns (per the SqlScript ALTERs: stock cols +
`CustomHrsPerLinealFt` + `CustomBase`): col 1 = stock hrs/lineal-ft, col 3 = stock base
hrs/curb, col 4 = custom hrs/LF override, col 5 = custom base override. `lookup_CurbTypes` is
keyed by `CurbStyle.ID`: col 1 = stock multiplier, col 2 = custom multiplier. Custom wins when
> 0. Stock values originate in the Azure DB but are ALREADY captured and seeded (§9.1) — the web app's seeded curb labor tables are
the live-capture equivalents).

```
perLF   = CurbTimes[deck].custom4 > 0 ? custom4 : col1
hrs     = perLF × ((dimA + dimB) × 2 / 12) × qty          // footprint perimeter ft × qty
base    = CurbTimes[deck].custom5 > 0 ? custom5 : col3
hrs    += base × qty
mult    = CurbTypes[styleId].custom2 > 0 ? custom2 : col1
hrs    ×= mult
hrs    += PolyethyleneSqF / 400 + ISO_Labor                // §2 quantities
// termination labor — ONLY the Lift options, added ONCE (not × qty):
if TermOption ∈ {2 (Lift & Tuck), 3 (Lift & T-Bar)}:
    LF = LinealFt = (dimA + dimB) / 6
    if 12 < LF ≤ 32: hrs += 1 + LF × 0.020833
    elif LF > 32:    hrs += 1 + LF × 0.041667              // ≤ 12 ft: nothing
Curb.ManHours = Round(BaseHours × (1 + AdjustLabor/100), 8)
```

### 8.3 Curb termination options — ids, material, labor

`frmCurbs.optNone_CheckedChanged` maps the radio group to `Curb.TermOption`:
**0 None, 1 Scupper-Fascia Bar 1¾", 2 Lift & Tuck, 3 Lift & T-Bar, 4 No Lift & T-Bar,
5 No Lift & Counter Flash.**

Priced effects per option:
- **0 None / 2 Lift & Tuck** — no hardware. Option 2 adds the lift labor above; option 0 nothing.
- **3 Lift & T-Bar / 4 No Lift & T-Bar** — term-bar footage `Round((2A+2B+12)/12 × qty, 4)` ft
  into the term bar's **no-drill** length split (`TermBar.GetCurbEdgeLength`, §wiring docs);
  option 3 also adds the lift labor.
- **1 Scupper-Fascia Bar 1¾"** — fascia-bar footage, same `(2A+2B+12)/12 × qty` formula, onto
  the 1¾" fascia bar (`FaciaBar.Size == 3`) **in the curb's own color**
  (`FaciaBar.GetCurbEdgeLengthByColor`). No extra labor line (the bar's own labor rate applies).
- **5 No Lift & Counter Flash** — `SheetMetals.RecalcParents`: inches = Σ over such curbs of
  `(A + B) × qty × 2`, Round 2dp, fraction rounded UP to the next 0.25, ÷ 12 → Round 2dp ft,
  `Ceil` → CalcQty on the "Curb Counterflashing" sheet-metal item (rate DB-resident).

### 8.4 Parapet termination / blocking / capstones / ARP (frmParapets tabs)

**Termination**: `cboTermType` holds the hardcoded `Management.oRefTerminations` catalog —
Empty(1) then **2 T-Bar, 3 1¾" Fascia, 4 4" Fascia, 5 2" Gravel Stop, 9 4" Gravel Stop,
6 2" Drip Edge, 10 4" Drip Edge, 11 3" / 7 4" / 12 5" / 8 6" / 13 7" / 14 8" 2-pc Metal**.
Selecting one enables the **Length** input (`TermLength`), defaulting to the wall Length,
editable — it is the FOOTAGE of that termination product. Routing by `Termination.ID`:
- id 2 → term bar footage by color (`RoofColorToTermBarColor(parapet.Color)`), and when
  `WallType == 1` the same footage ALSO lands in the no-drill split
  (`TermBar.GetParapetLength`).
- ids 3/4 → fascia bar of that size in the parapet's color (`GetParapetLengthByColor` matches
  `Termination.ID == FaciaBar.m_iSize`).
- ids 5/9/6/10 → gravel stop / drip edge accumulators (`GenericEdgeItem.CalcParapetLength`).
- ids 7/8/11–14 → the matching 2-pc metal size (`TwoPieceMetal.GetParapetLength`).
`Parapet.AutoModLengths`: when the wall Length changes by Δ, TermLength shifts by Δ (cleared —
and the termination reset to Empty — if it would go ≤ 0).
Separate flag **UseTermBarOnBase** (CheckBox1): adds wall Length ft of term bar (color 3) via
`TermBar.GetParapetBaseLength`, split no-drill/pre-drill by WallType like above.

**Wood Blocking**: `chkWood` → `HasBlocking`; the length box (`txtWoodLength` →
`BlockingLength`) **persists but never prices** — its only consumers are WriteXML /
Insert/UpdateRow. Pricing uses the wall Length: `Parapets.BlockingLinealFt = Σ Length where
HasBlocking`, and `WallBlockings.RecalcParents` (the 'TopOfParapet' NDL collection, LABOR-ONLY —
`TotalCost = LaborCost`) sets its single item's `CalcQty = Ceil(BlockingLinealFt × 1.03)`.
Rates DB-resident.

**Capstones**: `Management.oRefCapstoneOptions` = Empty, **1 Remove Only, 2 Remove &
Reinstall**. CapstoneLength defaults to wall Length, editable, and DOES price:
`Masonry.RecalcParents` sets remove-item `CalcQty = Ceil(Σ CapstoneLength[id=1] / 2)` and
reinstall-item `CalcQty = Ceil(Σ CapstoneLength[id=2] / 2)` (Masonry NDL rates DB-resident,
RefID 1 = remove / 2 = install). Additionally (§ prior wiring round) option 2 adds sealant
tubes `Ceil(Ceil(length)/40)`. **§14 correction (2026-09-10):** RefID 2 (the "install"
index) is the **Mortar Mix** row, not "Replace Capstones" — the installer ledger patched
LaborPerUnit on ndlMasonryID 1 and 2 only, and the live seed carries labor on Remove Only
(0.1 h) and Mortar Mix (0.3 h) with Replace Capstones at 0; "Replace Capstones" is a manual
row. Also: `WallBlockings.TotalCost = LaborCost` is only the dialog's footer — ReviewCalc
bills the wall-blocking MATERIAL into dMaterial[14] (see §14.3).

**ARP**: `Management.oRefARPs` = Empty + sizes **12/18/24/30 in** (ids 1–4). ARPLength defaults
to wall Length, editable. `Parapet.ARPSqFt = (Size + 6)/12 × (ARPLength == Length ?
AdjustedLength : ARPLength)` — NOTE: no 1.03 factor (roof-SECTION ARP has ×1.03; parapet ARP
does not), and the ==Length case bills the padded AdjustedLength. Parapet ARP is an **add-on**:
`MembraneAccs.RecalcParents` item 1 ("ARP (SqFt)") `CalcQty = Ceil(sections ARPSqFt) +
Ceil(parapets ARPSqFt)`; parapet MembraneCost still bills the FULL AdjustedSqFt (no ARP
deduction — `NonARPSqFt` feeds only the Review sq-ft display lines). This differs from roof
sections, where ARP sq ft IS subtracted from the membrane. ARP unit price: MembraneAcc ref
(bootstrap default $1.11/pack of 1; dealer price DB-resident).

### 8.5 Parapet membrane options — the parapet's OWN mil & color (PROVEN)

`Parapet.GetCurrentColorPriceIndex` (rva 0x42448) switches on **`Parapet.get_Color`** — the
parapet's own color — with the identical id→column map as the bid-level lookup (1 Tan→3,
2 Gray→4, 3 White→2, 4 DarkGray→5, 5 TerraCotta→6, 6 RockPly→7). `LookupParpetMembranePrice`
(rva 0x4249c) walks `lookup_DuroLastPrices` matching col0 == **`Parapet.MembraneType.Thickness`**
(the parapet's own mil) and col1 == Category **3** (Parapets tier — ALWAYS category 3, whatever
the parapet's roof-system family), returning that row's color column. `MembraneCost =
Round(AdjustedSqFt × that price, 2)`. The frmParapets "Membrane Options" expander exposes
per-parapet Roof System / Mil / Color / Attached-With combos. **The web engine pricing every
parapet at the bid-default mil/color is therefore wrong whenever a parapet's own selection
differs** (wired this round: per-parapet mil/color override).

Per-parapet **Attachment** changes:
- Tab layout (`Parapet.Recalculate`): attachment `'durolastmech'` → intermediate tabs at 25"
  (vert' > 30), 23"/28" (vert' > 53/59), 23"/28" (vert' > 83/89); `'durobondmech'` → no
  intermediate tabs; `AdheredSystem` → one tab at 60" when vert' > 59. (vert' = `Round6Inch`,
  rva 0x421e0, re-read 2026-09-10: `v > 30 AND Round(v/6)×6 == 30` → v as-is; else `v > 102`
  → 102; else `Round((v+2)/6)×6` — so v ≤ 30 is ALSO rounded (the earlier "≤30 → as-is" was
  wrong; harmless for the thresholds since no v ≤ 30 rounds above 30).) The remaining height +
  wrap fills the last tab. **`CalcTabCount` model** (`Parapet.Recalculate`, rva 0x41df8): the
  6-slot tab array is filled slot 0 = `Round6Inch(Skirt)` (0 if no skirt), slot 1 = Cant when
  `ParapetStyle.HasCant` (then `c = 1`, else `c = 0`), slots `1+c`, `2+c`, `3+c` = the
  intermediate tabs by attachment as listed, slot `4+c` = 0, slot 5 = 0; then it scans slot
  `4 − c` down to 0 for the first non-zero value, sets `m_iCalcTabCount` = that slot index and
  writes `RemainingPlusWrap` into the slot after it. So `CalcTabCount` = number of tab rows
  above the skirt slot, **cant included** (Duro-Last mech, 36" vertical, no cant → 1; with cant
  → 2; 60" → 2 / 3; 90" → 3 / 4). `TabCount` is the same field (recalculating first when the
  tabs are stale). Quirk: the `AdheredSystem` branch writes slot `1+c` only when vert' > 59, so
  a stale value from an earlier recalc can survive there; the two mech branches always
  overwrite. `EdgeFasteners` calls `Parapet.Recalculate` unconditionally first, so user-edited
  TabA–F never reach the fastener count.
- `EdgeFasteners` (rva 0x42588), by roof-system ShortName:
  durolast: vert ≤ 30 → 0; mech → `Ceil(AdjustedLength / In2Ft(12) × CalcTabCount)`; else
  `Round(AdjustedLength / In2Ft(15) × TabCount)`. durotuff: mech →
  `Round(Ceil(AdjustedHeight/24) × AdjustedLength / In2Ft(15))`; else
  `Round(Floor(Cant+Vertical)/60 × AdjustedLength / In2Ft(15))`. durobond:
  `Round(AdjustedLength / 1.5 × AdjustedHeight / 2)`. durofleece:
  `Round((Cant+Vertical)/60 × AdjustedLength / In2Ft(15))`. → joins the edging-fastener totals
  (`Accessories.GetEdgingFastenerTotals` slot 5).
- `WallAdhesive` (rva 0x42768): ONLY when the attachment is an `AdheredSystem` —
  `WallPlusTopSqFt / RoofSystem.LookupCoverageRate(2, 0, adhesive)` gallons, summed per
  adhesive across matching parapets then `Ceil` once (`AdheredSystems.AggregateCalcQtys`).
- `BaseManHours` (rva 0x42814): `lookup_ParapetTimes` key = `[WallType, DeckType.ID,
  Cant > 0 ? 1 : 0, Vertical]`; value col 5 (CustomValue) when > 0 else col 4; hours =
  `(value / 50) × AdjustedLength + Polyethylene/100 × 0.25`. Mechanical attachment uses the
  parapet's WallType in the key; every other attachment keys WallType = **4** (fixed).
  Stock values DB-resident. `ManHours = BaseManHours × (1 + AdjustLabor/100)`.
- `DeckFasteners` (= ToInt32(AdjustedLength)) — CORRECTED 2026-09-10: it IS consumed, by
  `frmAccFasteners.InitializeTotals` (Estimator.exe), where it adds 1 screw + 1 poly plate per
  foot of parapet to the parapet's deck bucket on the fasteners-by-deck screens (§12.5). The
  earlier "dead code" reading only searched DataAccess.dll.

### 8.6 Parapet wall styles & flags

`Management.oRefParapetStyles` — 4 hardcoded styles; ctor order (id, name, HasSkirt, HasCant,
HasVertical, HasWallTop, HasDrop):
**1 Basic (skirt+vertical), 2 Canted (+cant), 3 Basic with Drop (+wallTop+drop),
4 Canted with Drop (all).** Selecting a style icon (`tsParapetStyle`, Tag = the style object)
enables/disables + clears the Cant / Drop / WallTop inputs. The style has NO direct price
term — it affects money only through which dims are enterable and `HasCant` (tab layout +
`Cant > 0` in the labor key). Drawing otherwise.

**"Use Slipsheet:"** is `chkPlastic` → `Parapet.UsePlastic`. Priced:
`Polyethylene = AdjustedHeight × Length × 1.25` sq ft (AdjustedHeight is the family-dependent
one, so Duro-Tuff uses its half-foot-ceil height) → material via `NDLOthers.RecalcParents`
plastic item `CalcQty = Ceil(parapets poly + curbs poly)` (rate DB-resident) **and** labor
`0.25 h / 100 sq ft` inside BaseManHours (wired this round). (`Parapets.PolyethyleneLabor`
exists but has no consumers — the labor rides in BaseManHours.)

**"Wall Type"** combo: index 0 **'Wood or Metal' → WallType 1**, index 1 **'Brick or
Concrete' → WallType 4** (default; the parapet default-XML carries walltypeid=4). Effects:
WallType 1 routes term-bar footage (termination id 2 + UseTermBarOnBase) into the NO-DRILL
length split (wood/metal walls need no pre-drilling; the term-bar item carries separate
adjustlabornodrill/adjustlaborpredrill rates — DB-resident), and WallType is the first key of
the mechanical-attachment labor lookup.

### 8.7 Per-item labor links ("Labor: X h (Y%)")

Curbs, parapets (and corners / drains / pipe stacks — same pattern, AdjustLabor columns in each
user_ table) store a per-item **AdjustLabor** percent delta, default 0. The link label shows the
item's base hours and `(100 + AdjustLabor)%`. Clicking opens `frmLaborPopUp` seeded with
`BaseHours`/`BaseManHours`: the user edits either the percent or the target hours (two-way:
hours = base × pct/100), uncapped (`m_fMaxPercent` = float.Max in this mode; percent below 100
allowed). OK → `item.AdjustLabor = Round(pct) − 100`. Composition: the multiplier wraps the
item's ENTIRE base hours — including the curb ISO/poly/lift-termination adders and the parapet
poly labor — as `ManHours = Base × (1 + AdjustLabor/100)` (curb result Round 8dp), BEFORE
collection sums and the estimate-level labor templates/adjustments. `Parapets.set_AdjustLabor`
(set-all) exists but is never called by either app — per-item is the only live path.

### 8.8 Wired this round vs flagged

Wired (red-first, this series): style-5 wrap first-factor fix + all-styles Round8 (§2
correction); per-parapet mil/color membrane pricing; curb `termOption` lift-labor adder;
parapet `useSlipsheet` labor adder; per-item `adjustLaborPct` on curbs and parapets;
`CURB_TYPE_BY_STYLE_ID` mapping export (engine behavior unchanged — UI collapse is a human
gate); parapet matrix labor moved to the AdjustedLength basis (§8.5 — the adversarial pass
caught the engine still billing raw Length; walkthrough check: a 100 ft 1-piece wall shows
102 ft of labor in the legacy link). None of the new input fields are UI-reachable yet — the
web session wires the screens. Termination/blocking/capstone/ARP quantity routing documented above; their PRICING needs
the DB-resident NDL/hardware rates (term bar, fascia bar, counterflash, masonry, top-of-parapet
blocking, plastic, ARP dealer price) — flagged with the other live-DB items (§9).

## 9. DB capture round (2026-09-09): storage architecture correction + installer-seed recovery

**Premise correction.** Earlier notes above called the uncaptured tables "MySQL-resident". The
decompiled client contradicts that: `MySql.Data.dll` ships in the folder but nothing connects
through it. The legacy app uses two stores:

- **Azure SQL Server** `BidAdvantage` (`tcp:<name>.database.windows.net,1433`, embedded shared
  `bacustomer@…` login) — the `[dbo].[…]` T-SQL schema in `SqlScript.xml`; every `ref_*` and
  `lookup_*` reference/pricing table lives here. It is the vendor's shared backend, not a
  per-customer DB.
- **Local Access `main.mdb`** (Jet OLEDB 4.0) — per-estimate working data (`user_Curbs`,
  `user_Parapets`, `user_TermBars`, `user_ndl*`, …); no reference prices.

So the capture tooling is SQL Server's (`sqlcmd`/`bcp`/SSMS export) or Access export — not
`mysqldump`. Exact column lists recovered from the app's own queries:
`lookup_Decktimes(TabSpacing, DeckType, FastenerSpacing, Value, CustomValue)`;
`lookup_CurbTypes(CurbTypeID, Multiplyer, CustomMultiplier)` (canted styles = ids 3, 4);
`lookup_CurbTimes(DeckTypeID, HrsPerLinealFt, MinutesToInstall, Base, CustomHrsPerLinealFt, CustomBase)`;
`lookup_ParapetTimes(WallType, DeckType, Canted, Vertical, Value, CustomValue)`;
`ref_TermBars`/`ref_FasciaBars`/`ref_ndl` (`SELECT *`; ref_ndl is one table, rows tagged by NDL
category + `RefID` — masonry remove=1/install=2, top-of-parapet blocking, counterflash sheet-metal,
plastic). These have zero seed rows in the client installer, so their VALUES live only in the Azure
DB — but see §9.1: they were already captured from the admin screens and seeded into the web app.

### 9.1 Capture status (corrected 2026-09-09) — these rates are ALREADY seeded

Correction to the flags scattered through §8 (and the first draft of §9): the term-bar / fascia /
counter-flashing / masonry / wall-blocking / deck-time / parapet-time rates are NOT an open capture
gap. They were captured in the 2026-08-31 admin-screen batch (≈90 `BAManager.exe` screenshots in the
owner's Drive) and are already seeded in the web app. Every inline "rate DB-resident" / "uncaptured"
note in §8 should be read against this table — the rate originates in the Azure DB, and it is already
in a migration:

| Legacy table / screen | Web table (migration) | Sample seeded value (verify vs screenshot before trusting to the penny) |
|---|---|---|
| `lookup_CurbTimes` + `lookup_CurbTypes` (Curb Labor) | `labor_curb_deck` / `labor_curb_type` / `labor_curb.setup_minutes` | VERIFIED 2026-09-09 vs screenshot: setup 8; Wood 7.5 … Concrete 10.5; Open 1.1 / Closed 1 / Closed w/ Top 1.1 / Scupper 4 / Metal Scupper 3. Canted styles 3/4 have NO row (no multiplier → quote-required, consistent with `Curb.Cost` = −1). |
| `lookup_ParapetTimes` (Parapet Labor) | `labor_parapet` | full deck × height-band × drill/cant matrix (Wood 0″–30″ = 2.25 h … Concrete 100″+ = 16 h). |
| `lookup_Decktimes` (Roof Deck / Membrane Labor) | `rdl_combos` | re-modeled as the 10-hr base × deck × tab × fastener-spacing × sheet-size × thickness multiplier set (fastener spacing 24″→0.91 … 6″→1.41). |
| `ref_TermBars` (Term Bar) | `pricing_catalog` accessory_labor `termination_bars` | Term Bar pre-drill 0.035 h/ft, no-drill 0.0175 h/ft. |
| `ref_FasciaBars` (Fascia Bars) | `pricing_catalog` accessory_labor `fascia_bars` | 1¾″ pre-drill 0.0374 / no-drill 0.0187; 4″ 0.0395 / 0.0197. |
| `ref_ndl` counter-flash (Sheet Metal Work) | `pricing_catalog` `non_dl:sheet_metal_work` | Curb Counter Flashing $4.00/ft, 0.0167 h/ft, $45/h (+ ~20 other sheet-metal items). |
| `ref_ndl` masonry (Masonry) | `pricing_catalog` `non_dl:masonry` | Remove Only 0.1 h, Mortar Mix 0.3 h, Replace Capstones (labor set). |
| `ref_ndl` top-of-parapet (Parapet Wall Blocking) | `pricing_catalog` `non_dl:parapet_wall_blocking` | 2×4 w/ 8″ ISO $0.57/ft, 0.04 h/ft, $40/h. |
| gutters / downspouts / two-piece / sealants / stacks / fasteners | `metals_gutters` seed (`20260909200000…`) + catalog | from the §9 installer-seed CSVs. |

Genuinely still blank (shop-specific "enter your price" fields — empty in the source too, NOT missed
captures): Masonry **mortar-mix** and **replacement-capstone** prices ($0), gutter **labor-per-foot**
($0), and a few **roof-edge wood-blocking** rows ($0). These are set in the admin later (the seeded
rows carry a `_locked` flag that pins identity, not the price value). What remains is an ENGINEERING
task — having the engine consume these already-seeded rates to auto-price each item — not a
data-capture gap.

**Engine wiring status (2026-09-09).** The engine now auto-prices, from bid geometry, via
`admin.autoRates` (exact-Description rows out of the seeded screens; `buildNdlAutoRates`):

- **Curb counter flashing** (termination option 5, §8.3): Σ(A+B)×qty×2 in → Round 2dp →
  fractional inch UP to the next ¼" → ÷12 → Round 2dp → Ceil, on "Curb Counter Flashing"
  (Sheet Metal Work). Material → OtherMaterial; labor at $45/h own-rate → LS1 + man-days.
- **Parapet wood blocking** (§8.4): Ceil(Σ blocked-wall Length × 1.03) on '2" x 4" W/ 8" ISO'
  (Parapet Wall Blocking) — LABOR-ONLY (legacy TotalCost = LaborCost; material price ignored).
  **Superseded by §14**: the labor-only reading was the dialog footer; ReviewCalc bills the
  material too. The §14 module bills material + labor; this older path survives only for
  frozen snapshots without the non_dl screens.
- **Capstone masonry** (§8.4): remove = Ceil(Σ option-1 CapstoneLength/2) on "Remove Only";
  reinstall = Ceil(Σ option-2 /2) on "Replace Capstones" (verbatim: option-2 walls feed reinstall
  ONLY). **Superseded by §14**: the reinstall index is RefID 2 = Mortar Mix (see §8.4 note). Option-2 sealant tubes (Ceil(Ceil(len)/40)) stay an ordering quantity — the sealant
  item/rate join is not modeled.
- **ARP material** (§8.6): CalcQty = Ceil(Σ section ARP) + Ceil(Σ parapet ARP) × the
  "ARP (SqFt)" Membrane Accs price → M0. Parapet ARP = ((size+6)/12) ×
  (ARPLength==Length ? AdjustedLength : ARPLength) — no ×1.03, no membrane deduction.

Still NOT auto-priced: the **slipsheet/curb polyethylene material** — the legacy NDLOthers
plastic item has no seeded row anywhere in the web catalogs (only "polyisocyanurate" text
matches a plastic/poly search), so its sq ft stays an ordering quantity; and the termination
hardware/footage items held in §8 (price basis unproven).

**Recovered from the installer seed (capture-era defaults, delivered as CSV outside the repo).**
`SqlScript.xml` seeds much of the exceptional-metals/accessory pricing with real values:
`ref_AccGutters` (60), `ref_MetalsGutters` (12), `ref_AccDownSpouts` (6), `ref_MetalsDownSpouts` (2),
`ref_TwoPieceMetal` (1 — 3" 2-Piece Compression), `ref_GenericEdge` (4 gravel-stop corners),
`ref_Sealants` (12), `ref_Stacks` (12), `ref_Fasteners` (10), `lookup_TearoffLabor` (28), and
`MembraneAcc` — which **confirms the ARP dealer default `PricePerPack` = 1.11**. These are ship-time
defaults; the live Azure rows win if the vendor updated prices, so seed from them and reconcile.

### 9.2 Underlayment parent-type grouping (2026-09-09)

The legacy Underlayment screen's "Select Insulation Type" panel (parent tiles → that parent's
options) is now mirrored: `underlayment_board_group` maps each of the 52 priced boards to its
`underlayment_group` parent, name-exact against the price screen and corroborated by the
2026-08-31 estimator captures — the tile panel (Slip Sheets / 8'x4' ISO / Other Rigid / Fire
Rated / Flute Filler / 4'x4' ISO / Other Rigid 4'x4' / Tapered-Other) and the expanded
"Other Rigid 4'x4'" list (½"–4" Rigid 4'x4'), which pins "Rigid"-named boards to the EPO/XPS
groups. DensDeck/Securock, DensDeck Prime, and Gypsum boards group under their eponymous
verbatim `underlayment_group` rows (their tile placement wasn't captured in that shot's state).
NOT seeded as pickable options (quote-only in legacy, no price rows): "Rigid Quote 4'x4'" and
the Tapered/Other dropdown (Tapered Perlite / Tapered Crickets / Other / Tapered ISO / Tapered
EPS); Flute Filler has no priced boards. If a captured bid or a lookup_Underlayments extraction
later contradicts a placement, the seed row is a one-line fix.

## 10. Underlayment screen — menu tree, catalog, enhancement options, attachment (IL-exact, 2026-09-09)

Instruments: `Estimator.exe` `frmUnderlayment` / `frmUnderlaymentAdv`; `DataAccess.dll`
`Underlayment` / `RoofSection`. Supersedes the provisional, screenshot-inferred §9.2 for the
*mechanism* (board→tile and board→group are DB columns, not name inferences).

### 10.1 Insulation-type tiles → context menus (target 1)

Each of the 8 "Select Insulation Type" tiles is a **classic WinForms `ContextMenu` + `MenuItem`
(NOT `ContextMenuStrip`/`ToolStripMenuItem`), and the tree is FLAT** — one level, no parent items
/ no `DropDownItems`. Tile button → its menu (rvas): `btnSlip`→`mnuSlipSheets` (0xab974),
`btnRigid`→`mnuRigidISO` (0xab9d8), `btnOther`→`mnuOtherRigid` (0xaba3c),
`btnFlute`→`mnuFluteFiller` (0xabaa0), `btnFire`→`mnuFireRated` (0xabb04),
`btnQuote`→`mnuCustomQuote` (0xabb68), `btn4x4ISO`→`mnu4x4ISO` (0xabbcc),
`btn4x4Rigid`→`mnu4x4Rigid` (0xabc30).

Menus are built EMPTY in InitializeComponent and populated at runtime in **`frmUnderlayment_Load`
(rva 0xaed5c)**: each menu `.MenuItems.Clear()`, then a single loop over
`Management.oRefUnderlayments[i]`:
```
mi = new MenuItem( u.ToString() )          // Text = Underlayment.Name (Description)
switch (u.SubType):                        // 1..8 → exactly one tile:
  1→mnuSlipSheets  2→mnuRigidISO  3→mnuOtherRigid  4→mnuFluteFiller
  5→mnuFireRated   6→mnuCustomQuote 7→mnu4x4ISO     8→mnu4x4Rigid
mi.MergeOrder = i                          // index back into oRefUnderlayments
mi.Click += MenuItem_Click
```
So a board's TILE is strictly its `SubType` (1–8); the item's label is its `Name`; and
`MergeOrder` carries the catalog index the leaf handler assigns. (Internal button names are the
2020 field names; the live UI labels can differ — e.g. "8'x4' ISO", "4'x4' ISO", "Tapered/Other".
The label is cosmetic; placement is `SubType`.)

Tile button behavior (each `btn*_Click`): if its menu holds **>1** items → `ContextMenu.Show` at
point (0,48); if **exactly 1** item → `MenuItem.PerformClick` it directly (no popup). ⚠ BUG:
`btn4x4Rigid_Click` (0xabc30) single-item branch performs `mnu4x4ISO`'s item, not
`mnu4x4Rigid`'s (copy-paste error) — harmless only while 4×4 Rigid has ≠1 item.

Leaf handler **`MenuItem_Click` (rva 0xabcfc)** — also the `btnNone1` Click handler:
- **sender is a `Button`** → clear the layer for every selected section: `layer.Underlayment =
  null; layer.CustomQuoteID = -1; section.RowStatus = 2`. (This is the "None" button path.)
- **sender is a `MenuItem`** → `u = oRefUnderlayments[mi.MergeOrder]`.
  - If `u.NeedQuote`: `u.SubType == 4` → `HandleFluteFiller(MergeOrder, 1)` (rva 0xaf64c); else
    `HandleGetQuote(MergeOrder, 1)` (rva 0xafba8) and `forcePopAddAdhesive = 0`. If the handler
    returns non-null the click is fully handled (skip the assign below).
  - Assign to each selected section's current layer: `layer.Underlayment = u`; if
    `!u.NeedQuote` → `layer.CustomQuoteID = -1`.
  - Then re-validate the NEXT layer's adhesive attachment against the new board's group (see §10.4).

Runtime `Underlayment` model (DataRow ctor rva 0xadb00; XML ctor 0xad964; WriteXML 0xadb9c) —
attributes/fields, all from the DB row: `id`, `name`, `subtype`, `sort`, **`adhesivegroupid`**
(= `get_AdhesiveSubgroup` — the single group id), `thickness` (`RealThickness`), `sqftcosts`,
`layout` labor, **`needquote`** (stored bool — the ONLY quote flag; there is no per-menu-item
price prompt), and three admin-editable flags `managable` (price), `managablemechlabor`,
`managableadheredlabor`.

### 10.2 Catalog + groups (target 2)

**Live source** (Management load, decoded from the `oRefUnderlayments` fill loop): the query is
`SELECT * FROM ref_UnderlaymentTypes ORDER BY Description`, and the columns actually read are:
`UnderlaymentTypeID, Description, SubType, SortOrder, `**`AdhesiveGroupID`**`, RealThickness,
CostPerSqFt, CustomLayoutLabor, ManagementEditable, ManageMechLabor, ManageAdheredLabor,
NeedQuote`. So **board→tile = `SubType`** and **board→group = `AdhesiveGroupID`**, both single
columns on the live table.

⚠ **PREMISE CORRECTION — the installer seed cannot verify the current catalog.** The
`SqlScript.xml` `ref_UnderlaymentTypes` INSERT uses an OLDER schema:
`ManagementEditable, Description, Subtype, CostPerSqFt, RealThickness, Type1..Type10, SortOrder,
CustomType1..CustomType10` — no single `AdhesiveGroupID`, no `NeedQuote`/`ManageMechLabor`/
`ManageAdheredLabor`/`UnderlaymentTypeID`, and the `Type1..Type10` columns the live load doesn't
read. It also seeds only `SubType` 1/5/7/8 (30 rows) — tiles Rigid ISO(2), Other Rigid(3), Flute
Filler(4), Custom Quote(6) are EMPTY in it, and boards the live app shows (plain Dens Deck, 5/8"
F/C Sheet Rock, Tapered/Mod-Bit/Built-Up families) are absent. The live Azure `ref_UnderlaymentTypes`
is authoritative; capture `SubType` + `AdhesiveGroupID` together per board there (admin
Decktype/Underlay grid or a `SELECT`).

**Group list — VERIFIED row-by-row.** Legacy `UnderlaymentGroup` (19 rows, `SqlScript.xml`) is an
EXACT match to the web `underlayment_group` seed (id, description, sort — after the N-prefix fix
migration re-seed): 1 Slip Sheets(1), 2 ISO 4'x8'(2), 3 ISO 4'x4'(3), 4 EPO/XPS 4'x8'(4),
5 Flute Filler(6), 6 Fire Rated Mat(7), 7 DensDeck/Securock(8), 8 DensDeck Prime(9),
9 Gypsum Board(10), 10 Smooth Mod-Bit(11), 11 Granulated Mod-Bit(12), 12 Smooth Built-Up(13),
13 Graveled Built-Up(14), 14 Perlite(15), 15 Spray Foam(16), 16 Tapered ISO(17), 17 EPO/XPS 4'x4'(5),
18 Tapered Rigid(18), 19 Crickets/Other(19).

**Board→group provisional mapping — CONFIRMED (no mismatch).** The provisional Dens Deck/Securock→7,
DensDeck Prime→8, 5/8" F/C Sheet Rock→9 is consistent with the group list (7 = "DensDeck/Securock",
8 = "DensDeck Prime", 9 = "Gypsum Board"; F/C = fire-code gypsum → Gypsum Board) and already matches
the `underlayment_board_group` seed. Only caveat: full per-board confirmation for every live board
(especially the tiles the installer seed omits) still requires the live `AdhesiveGroupID` column;
the group *targets* are correct, the open item is completeness of the board list.

Installer capture-era catalog (30 rows, for reference; `Description | SubType | RealThickness`):
DensDeck Prime ¼/½/⅝ (5), Securock GFRB ¼/⅜/½/⅝ (5), ISO 4'×4' ½HD/1/1½/2/2½/2.7/3/3½/4 (7),
ISO Quote 4'×4' (7, NeedQuote), Duro-Weave (1), Rigid 4'×4' ½/1/1½/2/2½/2.7/3/3½/4 (8),
Rigid Quote 4'×4' (8, NeedQuote). (Note SubType 5 = Fire Rated tile holds both DensDeck Prime and
Securock in this old seed — another reason to prefer the live `SubType`.)

### 10.3 Enhancement Options (target 3)

The "Enhancement Options" link `llblAdvOptions_LinkClicked` (0xae748) → `ShowUnderlayAdvancedOptions`
(0xae750) opens **`frmUnderlaymentAdv`** modally. The panel's green "<- Using Custom Enhancement"
label (`TestForEnhancement`, 0xae678) lights when a selected section has `UUseMechCustomSettings`
OR `UUseAdheredCustomSettings`.

Form inputs (`frmUnderlaymentAdv` InitializeComponent 0x1de00; `LoadForUnderlaymentPage` 0x1fdd0):
- `cboRoofSection` — which section the settings apply to; `chkApplyToAll` applies to all selected.
- `chkFasteners` — master enable for custom mechanical fastening; `chkFasteners_CheckedChanged`
  (0x20544) enables/disables the six textboxes and the radios.
- Fastener density: `tbFieldPerSqFt`/`tbFieldPer4x8`, `tbPerimPerSqFt`/`tbPerimPer4x8`,
  `tbCornerPerSqFt`/`tbCornerPer4x8` — per-sqft OR per-4'×8' board (a 4×8 = 32 sqft; the two are
  kept in sync by the `*_Validated` handlers). Radios `rbField12`/`rbField6`, `rbPerim6`/`rbPerim4`
  are default-spacing presets.
- Adhesive: custom ribbon spacing (`CheckUsingAdhesiveCustomSpacing`) → `CustomAdhesiveSpacing`.
- `btnOK_Click` (0x1809b) commits into the section(s): `UUseMechCustomSettings`,
  `UUseAdheredCustomSettings`, `UCustomFastenersDensity[0..2]`, `UCustomAdhesiveSpacing[0..]`.

How each value feeds the calc (code-exact; `UCustomFastenersDensity` is indexed **[0]=field,
[1]=perimeter, [2]=corner**, fasteners per sq ft):
- **Fastener counts** — `RoofSection.UnderlaymentFasteners` (0x4cf40) sums, over up to 4 layers,
  `UnderlaymentLayerFieldFasteners` (0x4d23c) + `UnderlaymentLayerPerimFasteners` (0x4d00c). Each
  fires only when the layer's own attachment is `cMechanicalSystem`.
  - Field: field-attach mech → SubType1 `Round(Ceil(AreaField×0.08))`; else non-custom SubType7/8
    `Round(AreaField/16)×4`, else `Round(AreaField/32)×5`; **custom
    `Round(UCustomFastenersDensity[0]×AreaField)`**. Field-attach NOT mech → non-custom SubType7/8
    `Round(AreaField/16)×5` else `Round(AreaField/32)×10`; custom same as above.
  - Perim: perim-attach mech → SubType1 `Round(Ceil(AreaPerimeter×0.08))`; else non-custom
    SubType7/8 `Round(AreaPerimeter/16)×4` else `Round(AreaPerimeter/32)×5`; **custom
    `Round([1]×AreaPerimeter) + Round([2]×AreaCorner)`**. Perim-attach NOT mech → non-custom
    SubType7/8 `Round((AreaPerimeter+AreaCorner)/16)×8` else `/32×16`; custom same.
  - DuroBond field/perim add via `DuroLastFunctions.DuroBondFasteners*` when the attachment
    short-name is `durobondmech`.
- **Adhesive units** — `RoofSection.UnderlaymentAdhesive` (0x4d470), only for `AdheredSystem`
  layers with a `NextLowerUnderlay`: if `board.AdhesiveNeedsQuoteAdhesiveUnits` → `+
  QuoteAdhesiveUnits` (manual). Else per zone: `AreaField / RoofSystem[insulations].
  LookupCoverageRate(field, uLayer, nextLower.AdhesiveSubgroup, adheredSystem) ×
  IIf(UUseAdheredCustomSettings, 12.0 / UCustomAdhesiveSpacing[0], 1)` (+ same shape for
  perimeter). So custom adhesive spacing enters as a **`12 / spacing`** coverage multiplier
  (default ×1); spacing is ribbon on-center inches.
- **Labor**: the enhancement form changes fastener COUNTS / adhesive UNITS (and the material +
  fastening labor that scale with them). It applies no separate labor multiplier of its own.

### 10.4 Attachment-method dropdown population (target 4)

`LoadAttachment` (0xadd24) / `CommitAttachedWith` (0xae3c0) fill `cbAttachedWith` per selected
board with: "N/A (No Underlayment)" (no board), "None", the DuroBond options ("Section Fastened
w/ Durobond", "1+ Sections Use DuroBond"), the mechanical system (`durolastmech`), then each
`AdheredSystem` in `oRefAdheredSystems` offered **only when
`RoofSystem('insulations').AcceptableUnderlayGroups(adheredSystem).Contains(board.AdhesiveSubgroup)`**
(and the board's group is not quote-only for that system without units). So eligibility is fully
data-driven by the board's `AdhesiveGroupID` × the adhesive→group allow-list.

That allow-list and its coverage are tables we ALREADY have seeded: `underlayment_group`,
`adhesive_allowed_under` (= AcceptableUnderlayGroups / `AdhesivesAllowedUnder`),
`adhesive_coverage_underlayment`, and deck eligibility `AdhesiveAllowedDeckType` — all in
`20260903010000_legacy_fastener_adhesive_tables.sql`, plus `underlayment_board_group`
(`20260909220000`). The ONLY per-board inputs still uncaptured are each live board's `SubType`
(tile) and `AdhesiveGroupID` (group) — capture both from live `ref_UnderlaymentTypes` per §10.2,
and every tile placement + attachment-eligibility list falls out of data already present.
`MenuItem_Click`'s tail (0xabcfc) uses the same allow-list to drop a now-invalid adhesive on the
next layer after a board change.

### 10.5 Live tile contents — CAPTURED (2026-08-31 estimator batch, decoded 2026-09-09)

The §10.2 open item (per-board SubType) is closed for every PRICED board: the estimator batch
photographed each tile's open menu — Slip Sheets (121934), 8'x4' ISO (121946), Other Rigid 8'x4'
(122002), Fire Rated (122032), Flute Filler quote dialog (122049), 4'x4' ISO (122117), Other
Rigid 4'x4' (122200), Tapered/Other (122216). Findings, now seeded as
`underlayment_board_group.subtype/subtype_sort` (migration 20260909230000, applied live):

- **Fire Rated (SubType 5)** holds FR 10/FR 50 AND the whole DensDeck / DensDeck Prime /
  Securock GFRB / 5/8" F/C Sheet Rock families (12 boards) — confirming the installer-seed hint;
  the picker tiles now match. (Their ADHESIVE groups stay 7/8/9 in `underlayment_group_id` —
  a separate axis, unchanged.)
- Slip Sheets: Duro-Fold, Ultra-Fold, Duro-Blue Slipsheet, Geotextile, Duro-Weave (menu order).
- 8'x4' ISO: ½"–4" ISO + "ISO Quote 4'x 8'"; 4'x4' ISO: ½" HD–4" + "ISO Quote 4'x4'";
  Other Rigid 8'x4': 1"–4" Rigid + "Rigid Quote 4'x8'"; Other Rigid 4'x4': ½"–4" + quote.
- **Flute Filler** opens the §10.1 HandleFluteFiller QUOTE DIALOG (captured): S.F of Sections,
  quote name, labor total (hours/days), Lump Sum vs Piece (pieces × cost/piece) — no board menu.
- Tapered/Other: the five quote entries (Tapered Perlite/Crickets/ISO/EPS, Other).

Still NOT modeled: the quote entries themselves (ISO/Rigid Quote, Tapered/*, Flute Filler) —
they need the custom-quote layer flow (name + manual $ + labor), a future UI feature.

### 10.6 Custom-quote layers — IMPLEMENTED (2026-09-09), semantics partly flagged

The NeedQuote entries are pickable: the ten quote rows are seeded
(`underlayment_board_group.need_quote`, migration 20260910000000, applied live) into their
captured tiles, and clicking one opens a quote dialog mirroring the captured HandleFluteFiller
form (§10.5): quote name, S.F of selected sections (display), labor Total Amount with
Hours/Days, Lump Sum vs Piece (pieces × cost/piece), and the Material & Labor Cost preview.
Ok writes a `quote` object onto the section's layer; the engine bills it VERBATIM: material =
lump sum (or pieces × cost/piece), NO ×1.06 waste, into underlayment material (dTotals[6]);
labor = entered hours (days × hours-per-man-day) into underlayment labor at the crew rate.
Quote layers bill no auto fasteners/adhesive; an adhered membrane over a quote top board warns
"needs a quote" (legacy manual QuoteAdhesiveUnits is not modeled).

⚠ The five flags below are now RESOLVED by IL extraction — see §10.7 for the exact transcription.
Net: (a) labor CONFIRMED (days × HoursPerDay, crew `Estimate.LaborRate`); (b) material bucket
CORRECTED — it is `dMaterial[5]` (the per-category underlayment MATERIAL slot), not `dTotals[6]`,
verbatim LumpSum, no waste (normal underlayment ×1.06, Geotextile ×1.03); (c) CORRECTED — the
"Calculate Pieces" link DOES have a formula (opens `frmFluteFillerCalc`, a geometry calculator),
and LumpSum = Pieces × PerPiece; (d) the generic dialog is `frmULQuote`, identical to the Flute
dialog EXCEPT it has no pieces calculator; (e) CORRECTED — `QuoteAdhesiveUnits` IS a real modeled
path (groups 16/18/19, entered via `frmULCustomAdhesiveUnits`, billed verbatim). Details in §10.7.

### 10.7 Quote-layer money semantics — IL-exact (2026-09-09)

Extraction that resolves the §10.6 flags. A "quote" board (`Underlayment.NeedQuote`) does not price
by formula — the estimator captures a manual `QuoteUL` object and bills it verbatim.

**Dialogs (target 1).** `MenuItem_Click` routes `SubType==4` (Flute Filler) to `HandleFluteFiller`
(0xaf64c) and every other NeedQuote board to `HandleGetQuote` (0xafba8). The two handlers are
otherwise IDENTICAL: build a `QuoteUL`, gather the selected sections' existing `CustomQuoteID`s, and
if a quote already spans the selection pop `frmQuoteDecision.DisplayDialog` (return 6 = merge into
the existing quote — sums `LumpSum` and `LaborUnits`, converting the existing days→hours via
`×Settings.HoursPerDay`; 7 = start a new quote; else cancel). They differ ONLY in the editor form:
- `HandleFluteFiller` → **`frmULFlute.DoPopup`**.
- `HandleGetQuote` → **`frmULQuote.DoPopup`**.

Both editor forms carry the same fields: `txtName`; a **Lump Sum vs Piece** radio pair
(`rdoLump`/`rdoQuote`) with `txtLump` (lump $) and `txtPieces` × `txtPerPiece`; a labor `txtLabor`
with an **Hours vs Days** radio pair (`rdoHours`/`rdoDays`); and a live "Total Cost" =
`QuoteUL.LaborCost + LumpSum`. In Piece mode `LumpSum = Pieces × PerPiece` (set on every
pieces/per-piece keystroke). Defaults: a new quote's `IsDays` = `Settings.UseManDays`.
**The only difference:** `frmULFlute` has the **"Calculate Pieces"** link (`pieceCalcLink`), absent
from `frmULQuote`.

**"Calculate Pieces" (target 1)** — `pieceCalcLink_LinkClicked` opens **`frmFluteFillerCalc`**
(`calculateButton_Click`, rva 0x24a00). Inputs: `tbFFLength` (flute-filler piece length, ft),
`tbRidgetoRidge` (ridge-to-ridge / flute width, in), `plusTextBox` (optional waste %), over the
selected sections. Per section (all in inches; `secLen`,`secWid` = Round(Length/Width)×12,
`ff = tbFFLength×12`, `r2r = tbRidgetoRidge`):
```
across   = Round(ff / r2r)                       // strips across the ridge-to-ridge width
rows     = Round(secWid/ff + (1 − frac(secWid/ff)))   // rows along width, partial rounded up
trim     = frac(secWid/ff) ≥ 0.5 ? Round((1 − frac(secWid/ff)) × across) : 0
totalPieces += Round(across × rows − trim)
```
Displayed as `labelPieces = Σ totalPieces`, and with the waste %:
`labelPiecesPlus = Ceil(totalPieces × (1 + plus/100))`. It is a helper — the value the quote uses is
whatever ends up in `txtPieces` (`QuoteUL.Pieces`); the calculator does not itself write the layer.

**QuoteUL model + persistence (target 2).** Fields: `ID`, `Name`, `LumpSum`, `Pieces`, `PerPiece`,
`LaborUnits`, `IsDays`, `LaborCost`, `AdhesiveContainers`; persisted lowercase as
`lumpsum, pieces, perpiece, laborunits, isdays, adhesivecontainers` (+ name/id), stored in
`Estimate.CustomQuotes` (an id→QuoteUL map). The layer stores only `CustomQuoteID` (−1 = none;
`UsingQuote` ⇔ ≠ −1) and its own `QuoteAdhesiveUnits`; setting a layer's Underlayment or
AttachmentSystem resets both. `LaborUnits`↔`LaborCost` are kept in sync at the crew rate:
`set_LaborUnits(u)` → `LaborCost = u × LaborRate` (hours) or `u × HoursPerDay × LaborRate` (days);
`LaborRate = Estimate.LaborRate`, `HoursPerDay = Settings.HoursPerDay`.

**Where the money lands (target 2).**
- MATERIAL — `RoofSection.UnderlaymentCost` (0x4bef0) accumulates into `m_dUnder_cost[SubType−1]`:
  non-quote board = `Length × Width × (Name=="Geotextile" ? 1.03 : 1.06) × SqFtCost.SmartValue`;
  **quote board (`UsingQuote`) = `+ CustomQuotes[CustomQuoteID].LumpSum` — verbatim, NO waste
  factor.** Each quote id counted once across the selection (dedup set). `ReviewCalc.Recalculate`
  (0x4550c) folds `RoofSections.UnderlaymentCost` into **`dMaterial[5]`** (the underlayment MATERIAL
  slot, per roof-system offset) via `GoodSingle`. (So §10.6's "dTotals[6]" was the wrong index; it
  is the `dMaterial[5]` underlayment slot — the same bucket normal underlayment material uses.)
- LABOR — `RoofSection.UnderlaymentQuoteHours` (0x4cba8): for each layer/SubType, if the board is
  NeedQuote and `UsingQuote`, it forces the quote `IsDays = 0` (normalise to hours) and adds
  `CustomQuotes[CustomQuoteID].LaborUnits` into `m_dUnder_labor[SubType−1]`. Those hours flow through
  the standard underlayment-labor path into `dLabor[5]` and thence ManHours at `Estimate.LaborRate`
  — i.e. quote labor is billed as plain crew hours, days already converted ×HoursPerDay. Quote
  layers add no automatic fastener counts.

**QuoteAdhesiveUnits (target 3).** `Underlayment.AdhesiveNeedsQuoteAdhesiveUnits` =
`{16, 18, 19}.Contains(AdhesiveGroupID)` — i.e. groups **16 Tapered ISO, 18 Tapered Rigid,
19 Crickets/Other** (the irregular/tapered surfaces the app can't auto-cover). When an adhered layer
sits over such a board, `RoofSection.UnderlaymentAdhesive` (0x4d470) skips the coverage-rate formula
and bills `+ layer.QuoteAdhesiveUnits` (the raw container count) instead. Those units are entered in
**`frmULCustomAdhesiveUnits`** (a per-section grid; `PopulateDGV` / `btnFinish_Click` →
`UnderlaymentLayer.set_QuoteAdhesiveUnits`), NOT in the quote dialog. So the web note "manual
QuoteAdhesiveUnits not modeled" should become: model a per-layer `quoteAdhesiveUnits` integer,
prompt for it only when the board's group ∈ {16,18,19} under an adhered attachment, and add it
verbatim to the adhesive-unit total.

**§10.7 implementation status (2026-09-09).** All three corrections are wired: (1) quotes now
carry a shared ID — one quote applied to several sections bills ONCE (legacy CustomQuotes dedup;
id-less quotes from older saves bill per occurrence), and re-quoting a layer offers the
frmQuoteDecision Merge (sums LumpSum + labor hours, days converted) vs Start-new choice;
(2) the Flute Filler dialog carries the verbatim frmFluteFillerCalc "Calculate pieces" helper
(piece length ft / ridge-to-ridge in / waste %, `fluteFillerPieces`); (3) per-layer
`quoteAdhesiveUnits`: an adhered layer over a board whose AdhesiveGroupID ∈ {16,18,19} skips the
coverage formula and bills the raw container count verbatim (entered on the attachment panel;
missing containers warn). Material/labor buckets were already correct (our materialUnderlayment
IS the legacy dMaterial[5] underlayment slot; the §10.6 prose said "dTotals[6]" because that is
this port's name for the same slot in the money chain).

### 11. Estimate Review ledger — captured + rebuilt (2026-09-09)

The legacy Review screen (shots 124824 Cost view / 124849 Labor view) is the three-column ledger:
Purchases | Labor & Services | Totals, with the bottom Cost/Labor radio flipping the middle
column between $ and man-hours, "Use" checkboxes on the three discounts, and click-to-edit cells
(Shipping (Other) green cell, Dollar Markup / Markup percentage links, Per-Diem, and the stats
block: Total Man Days, price/labor per roof & membrane sqft, roof/parapet/membrane areas).
The web Review step now mirrors it: `review-ledger.ts` ATTRIBUTES the engine's billed amounts to
the legacy rows (per-tile insulation from the build-loop breakdown, non-DL rows mapped
Wood Blocking = Roof Edge + Parapet Wall Blocking / Roof Decking = Structural Deck / Sheet Metal /
Masonry / Custom Apps / Other, auto items on their rows, fixed subcontractor rows HVAC / Sheet
Metal / Masonry / Guttering) — tests assert every group sums to the engine aggregates
(M0, materialUnderlayment, otherMaterial, LS1 $ + hours, LS2). Non-grid knobs (warranty picker,
labor rate, adjust %s, templates, tax exempt, high wind) live behind the ledger's Settings
toggle. Known display deviations from the capture: an explicit "Adhesives" row under Duro-Last
purchases (estimate-level whole-unit adhesives have no legacy row name), a single Amount column
(the capture shows two identical ones), and Services rows appear only when data exists (the
legacy fixed Crane/Landfill/Dumpster/Vacuum/Set Up Charge list is a services screen we have not
captured).

### 11.1 Walkthrough follow-ups (2026-09-09, from claude/parity-walkthrough report)

Closed in this pass beyond the first fix batch: Panduit's `Price/Part` and Drain Boots'
`+ for Color` price columns are now recognized (`+ for Color` is the colored variant's FULL
price — $20.90 white / $21.90 color — so it yields a "— Color" item, not an adder); the Bids
list total is labeled "(last saved)". NOT seeded: the third installer Membrane Accs row
("1' of Stripping w/ 6\"oc Fasteners") — the installer marks it `ShowInEstimator = 0`, so
legacy deliberately hid it from the estimator; adding it to the pickable screen would surface
what legacy suppressed. Revisit only if a live capture shows it in the legacy admin grid.
Remaining §6 structural gaps (accessory calculated screens, parapet Termination/Wall Type,
per-section overrides, Setup defaults, Reports/Export, plain gutter styles) are tracked there.

## 12. Accessories tab — the complete money path (IL-exact, 2026-09-10)

Answers `docs/extraction-requests/accessories-money-path.md` from the decompiled
`DataAccess.dll` (data + math) and `Estimator.exe` (`frmAccTerminations`, `frmAccFasteners`,
`frmAccessory1/2/5`, `frmAccReview`). Every formula below is transcribed from the named method;
where a value is a ref-table column it is named so the licensed app's admin grid can be
screenshotted. Notation: `R10(x)` = `DACommon.RoundToNextTen` (rva 0x41238): 0 → 0; x an exact
multiple of 10 → x; otherwise `n = Ceil(x)`, result `n + 10 − (n mod 10)` — so 11 → 20, 10.3 →
20, 1.03 → 10 **and 9.27 → 20, 19.57 → 30** (when Ceil lands on a multiple of ten the legacy still
adds a full ten; corrected 2026-09-18, §22.5 — the first transcription read it as "Ceil up to the
next multiple of 10", which gave 10 / 20 there). `In2Ft(i)` = `Round(i/12, 2)`. `Round(x, n)` is
VB/.NET `Math.Round` (banker's).
`f32` marks a single-precision multiply (`ldc.r4 1.03` = 1.0299999713897705).

### 12.0 Prediction ledger (registered before reading the IL, scored after)

| # | prediction | result |
|---|---|---|
| P1 | drip-edge labor = raw length × NonPreDrillLaborFactor (0.0275) → 0.275 h | HELD — but on the ten-rounded length (§12.2), not the raw one |
| P2 | drip-edge material = 10 ft × $8.40/ft = $84.00 | HELD |
| P3 | fasteners = `Ceil(len/10 × 21)` = 21 | HELD (len is the ten-rounded 10 ft) |
| P4 | "Calculated Total: 1" = one 10-ft piece | **MISS** — it is 1 FOOT of roof edge (`TotalRoofEdgeLength`, feet); the capture's edge was a 1-ft side (section B, 1×1), which R10(Ceil(1.03)) turns into 10 ft |
| P5 | Wood "Fasteners 925 / Poly 925" = row-style membrane screws of sections A+B | HELD — 55×100 quick-bid, 64" lap, 15" oc → 924, plus 1×1 → 1; plates 1-per-screw |
| P6 | Vents "White = 7" is user-entered | **MISS** — derived: `Ceil(area/1000)` per mechanically-attached section, by section color (A 5500 sf → 6, B 1 sf → 1) |

Footer reconciliation (all four anchors on the same bid): material $180.25 (7 × $25.75 White
Vent) + $84.00 = **$264.25** ✓; hours 3.5 + 0.275 = 3.775 → shown **3.78 h** ✓; labor cost
3.775 × $45 = $169.875 → **$169.88** ✓ (so the footer bills the unrounded hours at the crew rate).
Prices/rates used: White Vent $25.75 and Drip Edge 2" White $8.40/ft (captured admin grids, live
in `pricing_catalog`), vent labor 0.5 h, Drip Edge 2" no-drill 0.0275 h/ft (`accessory_labor`).

### 12.1 Shared frame (A)

**Billing route.** `ReviewCalc.Recalculate`: `dMaterial[4] = Accessories.TotalCost` (the Review
"Duro-Last › Accessories" purchase row, inside M0 → discounts, tax, freight basis) and
`dLabor[4] = CalcLaborCost(Accessories.ManHours)` at the CREW rate (`Estimate.LaborRate`), hours
in col 1 → LaborSubtotal1 → man-days. Nothing on this tab bills at an own rate or into LS2.

`Accessories.TotalCost` (rva 0x10a8c) = AccOthers + Corners + DripEdges + Drains +
**Fasteners.TotalBoxCost** + FasciaBars + GravelStops + **Panduits.TotalBoxCost** + PipeStacks +
Sealants + **AdheredSystems** + Strainers + TermBars + TwoPieceMetals + Vents + Washers +
MembraneAccs. `Accessories.ManHours` (rva 0x10940) = PipeStacks + Strainers + Corners + Drains +
TermBars(no-drill + pre-drill) + AccOthers + DripEdges + FasciaBars + TwoPieceMetals +
GravelStops + Vents + Washers + MembraneAccs. **Fasteners, Panduit, Sealants and Adhesives carry
no labor** — pure material.

**Labor link.** Every "Labor: X h. (Y%)" opens `frmLaborPopUp` seeded with the item's BASE hours
and its `AdjustLabor`; OK stores `Round(pct) − 100` (§8.7). Composition everywhere:
`ManHours = BaseHours × (1 + AdjustLabor/100)` (drip/gravel/fascia/term bar: `Round(…, 4)`).
`Management.FormatLaborStr` prints "(N%)" only when the adjust argument ≠ −2; a plain "0 h." means
the caller passed −2 = no adjustable labor on that row (Membrane Acc "ARP (SqFt)"). Which object
the link edits differs per screen (table in §12.2/§12.3).

**Extra / "Additional" columns (green).** User-entered, stored per item; they price at the same
unit rate as the calculated quantity (`Cost = price × (calc + extra)` on every class) and DO add
labor where the class has labor (vents, corners, generic-edge corners, two-piece extras). Units:
edge-bar "Additional Required" is **feet**; corners/clips/covers are **pieces**; grids are
pieces/units/feet as labelled. Green = editable (`CellType 1`, `LightGreen` in `FillLists`),
white = computed read-only.

**Accessories Summary** (`frmAccReview.UpdateList` over `Accessories.AccessoriesReviewTable`):
read-only Qty / Name / UnitCost / TotalCost / Labor list. No inputs.

### 12.2 Edge Terminations (B)

**Common length pipeline.** Each bar family scans (a) every present roof section's four sides:
`Termination(side).ID == <this product's id>` → `Convert.ToInt32(TerminationWidth(side))` (the
per-side termination footage; roof edges are always the NO-DRILL split), (b) curbs (term bar and
1¾" fascia only), (c) parapets with `TermOption.ID == id` → `ToInt32(TermLength)`, split by
`WallType == 1` → no-drill else pre-drill. Termination ids (hardcoded `oRefTerminations`, §8.4):
2 T-Bar · 3 1¾" Fascia · 4 4" Fascia · 5 2" Gravel Stop · 9 4" Gravel Stop · 6 2" Drip Edge ·
10 4" Drip Edge · 11/7/12/8/13/14 = 3"/4"/5"/6"/7"/8" 2-pc Metal.

Color keys: `TermBar.RoofColorToTermBarColor` and the generic-edge switch map the section /
parapet / curb color **Tan→1, Gray→2, White→3, Dark Gray→2, Terra Cotta→1, Rock Ply→2** (the W/T/G
columns; dark gray buys gray, terra cotta buys tan). Fascia `GetTotalLengthByColor` folds the same
way and adds `GetExtraLength` (both Additional boxes) to WHITE — the "(Additional added as
White)" note.

**Term bar** (`TermBar`, one object per `ref_TermBars` row = per color).
- Counts (`UpdateScreenTB`): Roof Edges = Σ `GetRoofEdgeLength` (all sides with id 2, colour
  match); Curbs = Σ curbs with `TermOption ∈ {3 Lift & T-Bar, 4 No Lift & T-Bar}` and colour match:
  `Round((2·A + 2·B + 12)/12 × qty, 4)` ft per curb (A,B inches) — no-drill; Parapets = Σ
  `TermLength` of parapets with `TermOption.ID == 2` and colour match (`WallType 1` → no-drill,
  else pre-drill). All three are feet.
- Base term bar (`GetParapetBaseLength`, WHITE bar only, color 3): parapets with `UseTermBarOnBase`
  add `Round(Length)` ft — WallType 1 → no-drill, else pre-drill. These are the "Parapets" boxes
  in the No-Drill/Pre-Drill columns (`tbParaNoDrill/PreDrill`).
- **"Peel Stop" rows are dead UI** — `tbPSNoDrill/PreDrill` are written from locals that are never
  assigned (always 0).
- Calculated Total per color (W/T/G) = `NoDrillLength` / `PredrillLength` accumulators (feet).
  Additional (W/T/G/Dark Gray/Terra Cotta, per drill column) → `AdditionalNoDrillLength` /
  `AdditionalPreDrillLength` (feet) on the bar of that color (dark gray and terra cotta bars exist
  only as Additional).
- Sub-totals: `TotalNoDrillLength = R10(Ceil(f32 1.03 × (Σ noDrill + Σ addlNoDrill)))`, same for
  pre-drill (base-bar footage included).
- Adj. Total Length = Σ bars `GetTotalLength(true,false)` = `R10(f32 1.03 × (roof + curb + parapet
  + base + addlPre + addlNoDrill))` per bar.
- **Material** `TermBar.Cost` = `GetTotalLength(true,false) × ref_TermBars.Price` — price is PER
  FOOT of the ten-rounded, 3%-scrapped length. Summed over bars with length > 0.
- **Fasteners** `TermBar.Fasteners` = `Ceil(GetTotalLength(false,false)/10 × 21)` — NOTE the
  base-bar footage is EXCLUDED here (arg `includeBase = false`) while Cost includes it.
- **Labor** per drill split: `Round(R10(f32 1.03 × (len + addl)) × rate × (1 + adj/100), 4)` with
  rate = `CustomPredrillLaborFactor` if > 0 else `PredrillLabor` (and the NonPredrill pair);
  `TermBars.OnRecalculate` sums per-bar hours then `Round(…, 2)`. The BILLED variant
  (`get_ManHoursPreDrill/NoDrill`) omits the base-bar footage; the labor-link BASE variant
  (`get_BaseManHours*`) includes it — the link's seed and the billed hours diverge when
  `UseTermBarOnBase` is set (legacy inconsistency, transcribed as-is).
- Strip Mastic: checkbox → `txt = GetTotalLength(false,false)`, stored on **bar[0] only**
  (`StripMasticLength`, editable); Sealants then consume `GetStripMasticLen = R10(f32 1.03 ×
  StripMasticLength)` — see §2.5 of legacy-consumption-rules (350 LF per pail).
- Ref: `ref_TermBars` (TermBarID, Description, Color, PartNumber, Price, PredrillLabor,
  NonPredrillLabor, CustomPreDrillLaborFactor, CustomNonPreDrillLaborFactor) — captured
  (`accessory_labor` "Termination Bars": 0.035 / 0.0175 h/ft).

**Fascia bars** (`FaciaBar`, one per `ref_FasciaBars` row; `Size` 3 = 1¾", 4 = 4"; colourless
bar, colour lives in the covers).
- Counts: roof sides with `Termination.ID == Size` (no-drill); curbs with `TermOption == 1
  (Scupper/Fascia Bar 1¾")` onto the **Size 3** bar only, `Round((2A+2B+12)/12 × qty, 4)` ft
  (no-drill); parapets with `TermOption.ID == Size`, WallType 1 → no-drill else pre-drill.
- Sub-totals ND / D = raw `NoDrillLength` / `PreDrillLength` (feet). Additional Required ND / D =
  `OtherNoDrillLength` / `OtherPreDrillLength` (feet).
- `GetTotalLength = R10(f32 1.03 × (calc + otherND + otherD))`; Adj. Total Length shows it.
- **Material** `FaciaBar.Cost = GetTotalLength × Price` (per foot) `+ cFaciaMetalCovers.Cost +
  cFaciaVinylCovers.Cost`.
- **Vinyl covers** (checkbox `chkSFV`): on check, the three colour boxes are PREFILLED with
  `GetTotalLengthByColor(c) − MetalCoverLength(c)` where `GetTotalLengthByColor` (0x16f80) is
  **`R10(f32 1.03 × (roof_c + curb_c + parapet_c [+ both Additional boxes on White]))`** — the
  ten-rounded, scrapped colour length, not raw feet (corrected §22.5; Tan sums colours 1+5, Gray
  2+4+6), editable; `WhiteCost = R10(whiteQty) × WhiteVinylCoverPrice` (per foot, ten-rounded, NO 1.03),
  same for Tan/Gray. Unchecking zeroes them.
- **Metal covers** (`chkSFM`): prefill White = `GetTotalLengthByColor(3) − vinylWhiteQty`; Tan /
  Gray typed. `cFaciaMetalCovers.Cost = R10(Σ colour qty) × MetalCoverPrice + insideQty ×
  InsideCornerPrice + outsideQty × OutsideCornerPrice` (corners are pieces, unrounded).
- **Fasteners** = `Ceil(GetTotalLength/10 × 21)`; slot map §12.5.
- **Labor** per drill split: `Round(R10(f32 1.03 × (len + other)) × rate × (1 + adj/100), 4)`,
  rates `CustomPreDrillLaborFactor > 0 ? custom : PreDrillLaborFactor` (idem NonPreDrill). Covers
  and corners add no labor. Link edits the bar's own adjust (ND and D separately).
- Strip mastic: checkbox → `StripMasticLength = GetTotalLength(false)`, `GetStripMasticLen =
  R10(f32 1.03 × it)`.
- Ref: `ref_FasciaBars` (FasciaBarID, Description, PartNumber, Price, Size, PreDrillLaborFactor,
  NonPreDrillLaborFactor, Custom*, {White,Tan,Gray}VinylCover{PartNumber,Price},
  MetalCover{PartNumber,Price}, InsideCorner{PartNumber,Price}, OutsideCorner{PartNumber,Price}) —
  **cover/corner prices NOT in the installer seed; capture the admin "Facia Bars/Vinyl Covers"
  grid** (rates are seeded: 0.0374/0.0187 and 0.0395/0.0197 h/ft).

**Drip edge and gravel stop** (`GenericEdges` group 6 / 5; each `GenericEdge` = one bar
`BaseItem` + `Corners`(SubType 35) + `Clips`(40) + `Cover`(55) + `InsideCorners`(45) +
`OutsideCorners`(50), assembled from `ref_GenericEdge WHERE EdgeGroup = g ORDER BY EdgeGroup,
EdgeSize, EdgeSubType`; a row whose `EdgeSubType` is NOT one of 30/35/40/45/50/55 starts a new
bar and its SubType IS the termination id — 6/10 drip, 5/9 gravel; SubType 30 rows are read but
attached to nothing).
- Counts: Roof Edges = Σ sides with `Termination.ID == SubType` (ft, by colour); Parapets = Σ
  `TermLength` with `TermOption.ID == SubType` (WallType/deck split only affects the drill
  accumulators; `CalcParapetLength` indexes `oRoofSections[i]` with the PARAPET index i to read
  `DeckType.Predrill` — a legacy indexing quirk, transcribed). Curbs never feed these.
- "Calculated Total" = roof + parapet FEET (drip edge one box; gravel stop per colour W/T/G).
  "Additional Required" = `ExtraByColor` on the bar, FEET. "Corners" = `Corners`(35) pieces per
  colour; gravel stop also has `Cover`(55) qty (Metal Cover checkbox), `InsideCorners`(45) and
  `OutsideCorners`(50) pieces.
- Adj. Total Length = `BaseItem.GetTotalLengthWithScrap` = Σ colours `R10(Ceil(f32 1.03 ×
  (calc_c + extra_c)))` — this is the length shown in the tab caption "(N ft)".
- **Material** per part: `Cost = Σ colours PriceByColor(c) × lengthWithScrap_c`. For the bar
  (and for Clips, SubType 40) `lengthWithScrap_c = R10(Ceil(f32 1.03 × (calc_c + extra_c)))` —
  price is PER FOOT of the ten-rounded length. Corners (35/45/50) and Cover (55) SKIP the scrap
  loop: `cost = price_c × pieces_c` (per piece, unrounded).
- **Fasteners** `GenericEdges.Fasteners` = `Ceil(Σ bars lengthWithScrap / 10 × 21)` per group
  (2" and 4" summed).
- **Labor** `GenericEdgeItem.BaseHours`: corners (SubType 35/45/50 in groups 5/6) = `LF_nonPre ×
  pieces`; otherwise, `UsePreDrill == false` → `LF_nonPre × R10(noDrillLen + extra)` (Cover/Clips: their
  calc length is 0, so `LF_nonPre × R10(pieces)`);
  `UsePreDrill == true` → `R10(preLen) × LF_pre + R10(noDrillLen) × LF_nonPre + R10(extra) ×
  Round(max(LF_pre, LF_nonPre), 4)`. LF = `Custom…LaborFactor > 0 ? custom : …LaborFactor`.
  Group hours = Σ parts `Round(Base × (1 + adj/100), 4)`; a group only counts when its bar
  length > 0. Drip-edge link edits the BAR item's adjust only (popup seeded with the bar's base);
  gravel-stop link edits ALL parts (`GenericEdge.set_AdjustLabor`, seeded with the group base).
- Ref: `ref_GenericEdge` (GenericEdgeID, Description, EdgeGroup, EdgeSubType, EdgeSize,
  PartNumber, WhitePrice, TanPrice, GrayPrice, PreDrillLaborFactor, NonPreDrillLaborFactor,
  Custom*, UsePreDrill). Bar prices captured (Drip Edge 2" 8.40/9.98/9.98, 4" 10.08/11.08/11.08);
  the installer seed has only the four gravel-stop corner rows (10.19 / 11.06); **drip-edge
  corner/clip prices and `UsePreDrill` flags need the admin "Drip Edge" / "Gravel Stops" grids**.

**Base & Snap Cover** (`TwoPieceMetal`, one per `ref_TwoPieceMetal` row; `Size` index → id:
0→7 (4"), 1→8 (6"), 2→11 (3"), 3→12 (5"), 4→13 (7"), 5→14 (8")).
- Counts: roof sides with `Termination.ID == id` + parapets with that `TermOption` (feet, no
  drill split). "Calculated Total" = roof + parapet ft; "Additional Required" = `OtherLength` ft.
- `GetTotalLength = R10(f32 1.03 × (roof + parapet + other))` — tab caption "(N ft)".
- **Material** = `TotalLength × Price` (per ft) `+ CoversQuantity × CoverPrice + ICQty ×
  InsideCornersPrice + OCQty × OutsideCornersPrice`. Metal Snap Cover checkbox prefills
  `CoversQuantity = GetTotalLength` (ft, editable, unrounded in cost).
- **Fasteners** (`TwoPieceMetals.Fasteners`): sizes {0,2,3} (4", 3", 5") `Ceil(len/10 × 42)`,
  others `Ceil(len/10 × 63)`.
- **Labor** `Round(len × LaborFactor + (IC + OC) × CornerLaborFactor, 4)` then `× (1 +
  adj/100)`, `Round 4`. Ref `ref_TwoPieceMetal` (…Price, CoverPrice, InsideCornerPrice,
  OutsideCornerPrice, LaborFactor 0.043 h/ft, CornerLaborFactor 0.2 h/pc, Custom*); only the 3"
  row is in the installer seed — **capture the "Two Piece Metals" admin grid for 4"–8" prices**.

**Fastener grids on these screens** — no auto-distribution. Each screen shows `Fasteners Needed
= max(0, GetEdgingFastenerTotals[k] − Σ Quantity(slot) over the screen's fastener group)`, red
when > 0; the estimator types counts into the green cells. Group k / slot / totals index:
term bar 0/0, 1¾" fascia 1/2, 4" fascia 2/3, drip edge 3/4, gravel stop 4/5, parapet wall-tabs
5/1, snap cover 6/6 (`Accessories.GetEdgingFastenerTotals`, rva 0x107e8: [0] TermBars, [1]
fascia size 3, [2] fascia size 4, [3] DripEdges, [4] GravelStops, [5] `Parapets.EdgeFasteners`,
[6] TwoPieceMetals). Group membership = `ref_FastenersSubgroups` flags (ForTermBar,
ForSmallFascia, ForLargeFascia, ForDripEdge, ForGravelStop, ForParapet, ForSnapOn — seeded).
Money: §12.5.

### 12.3 Flashing & Other Accessories (C)

- **Corners** (`Corner`): six ref rows; qty per colour (6 colours; the capture's grid shows the
  bid's colours). `Cost = Σ_c qty_c × price_c` (`ref_Corners`: Price=White, TanPrice, GrayPrice,
  DarkGrayPrice, TerraCottaPrice, RockPlyPrice); hours = `Σ_c ManHours × qty_c × (1 + adj/100)`
  (`ManHours`, `CustomLabor` — captured 0.1667–0.3333). Nothing auto-populates corners.
- **Pipe Stacks** (`PipeStack`): Usage = `ref_StackUses` (1 Plumbing 0.5, 2 Hot Stack 1.0, 3
  Pitch Pan 1.5 — `LaborAdjust`/`CustomLabor`, seeded); Size = `ref_Stacks` rows (1"–42",
  `Price`/`PriceTan`/`PriceGray`/`PriceDarkGray`/`PriceTerraCotta`/`PriceRockPly`,
  Open/ClosedPartNumber, `RequiredSealantMultiplyer` — the multiplier is persisted to XML and
  **never used in pricing**). `Cost = size.Price(colour) × qty`. Labor
  (`BaseManHours_4_0_236`): `h = qty × (IsOpen ? 1.25 : 1) × usage.LaborFactor`, then
  `size > 18 → ×2`, else `size > 12 → ×1.5`; `× (1 + adj/100)` per stack ("Individual Pipe Stack
  Labor" link edits that stack). Usage therefore DOES price (labor) — and Pitch Pan usage (id 3)
  also drives pitch-pocket filler (§2.5). Consumption: circumference `c = Ceil((size + 0.25) ×
  π)` in; `SealantLinealFt = c/12 × qty` → per colour tubes `Ceil(Σ ft × 2 / 10)`; panduit
  straps per stack: 20" straps `= ⌊c/17⌋` while c ≥ 17, then 14" straps `Ceil(remainder/11)`
  (each × qty) → §12.4 Panduit.
- **Conduit Washers** (`Washer`): `ref_Washers` (Price, LaborRequired, CustomLaborRequired —
  captured 0.3333 h). `Cost = price × qty`; `h = Round(rate × qty, 4) × (1 + adj/100)`; also 1
  sealant tube per 4 washers (§2.5).
- **Roof Drains & Boots** (`Drain`): fields Qty, Existing Roof (`ref_DrainRoofTypes` 1 None, 2
  Single Ply, 3 BUR, 4 GS BUR with CleanupLabor / ReinstallLabor 0/0.25, 0.25/0.25, 0.5/0.5,
  0.75/0.75 — seeded), "Reuse Existing Drain Rings" checkbox, Drain Boot Size (`ref_DrainsBoots`:
  Price, PriceForColor, LaborFactor — captured 0.5 h), Drain Ring Size (`ref_DrainRings`: Price).
  `Cost = ReuseRing ? 0 : qty × (boot.Price + ring.Price)` — **reuse zeroes the material** (boot
  included) and the colour price column is not consulted. Labor `= Round(qty × (roof.CleanUp +
  (ReuseRing ? roof.ReInstall : boot.LaborFactor)), 2) × (1 + adj/100)`; + 1 sealant tube per
  drain (§2.5). Strainers (`Strainer`, `ref_Strainers`: Price, UnitLabor, CustomLabor): `cost =
  price × qty`, `h = qty × UnitLabor × (1 + adj/100)` — Hours/Unit multiplies as captured.
- **Walk Pads (& wall vents)** (`AccOther`, `ref_AccOther` SubType WalkPad/…): per-pad quantity
  (no LF/SF conversion); `Cost = price × qty`; `h = qty × (CustomLabor > 0 ? custom : UnitLabor)
  × (1 + adj/100)` (0.5 / 0.65 captured).

### 12.4 Calculated Items (D)

- **Panduit** (`Panduit`, `ref_Panduit`: Price = UNIT cost, NumberPerBox, Length): rows with
  `Length == 14` get `CalculatedQty = PipeStacks.Panduit14Inch`, `== 20` →
  `Panduit20Inch`, any other row (the tool) 0. `Boxes = Ceil((Qty_extra + Calc)/NumberPerBox)`;
  `Panduit.Cost = Boxes × (NumberPerBox × Price)` is what the Accessories Summary SHOWS — but
  `Accessories.get_TotalCost` (0x10a8c) adds **`Panduits.TotalBoxCost`** = Σ `Panduit.BoxCost`
  (`NumberPerBox × Price`, ONE box) over present rows (`Panduits.OnRecalculate` 0x1fa88), so the
  bid carries one box per row whatever the count (corrected §22.5; reproduced behind
  `LEGACY_PANDUIT_ONE_BOX_PER_ROW`). No labor.
- **Sealants** (`Sealant`, `ref_Sealants`: Name, PartNumber, Price): `Cost = price × (CalcQty +
  Quantity)`, no labor; `CalcQty` rules are §2.5 of legacy-consumption-rules (term bar / fascia
  strip mastic → RefID 9 @ 350 LF/pail; Duro-Caulk by colour = `ToInt32(Ceil(termBarLF_c +
  fasciaCoverLF_c) / 12)` — ceiling the feet, then divide, then banker's-round to whole tubes
  (NOT `Ceil(sum/12)`; clarified 2026-09-10); drains +1 tube each and washers `Ceil(0.25 × qty)`,
  both into the White bucket (RefID 13); pipe stacks per colour per §12.3; pitch-pocket filler
  from usage-3 stacks and pitch pans; Duro-Roof seam sealant; capstone parapets → White).
  "Show Discontinued Sealants": rows whose part number ∈ {1116, 1116B, 1114,
  1115, 1126, 1126B, 1124, 1125} (hardcoded in `frmAccessory2`) are hidden unless checked, shown
  red with the note "use Duro-Caulk Plus"; the count label sums their entered qty. Display only.
- **Adhesives** (`AdheredSystem`): `Cost = Round((AdditionalQty + CalculatedQty) ×
  PricePerUnit, 0)` — **rounded to whole dollars** per adhesive; no labor here (adhesive labor
  rides in the underlayment/membrane hours). `CalculatedQty` = `AdheredSystems.AggregateCalcQtys`
  (§2.4: membrane + every adhered layer + every parapet wall, summed per adhesive, `Ceil` once) —
  the §10.7 `QuoteAdhesiveUnits` are part of the per-layer term inside that sum, so they are
  billed exactly once, here. Extra = additional whole units.
- **Membrane Acc.** (`MembraneAccs`/`GenericMaterial`, table `MembraneAcc`: PricePerPack,
  ItemsPerPack, DefaultUnitLabor, CustomUnitLabor, ShowInEstimator): `Cost = Round(Price ×
  Ceil((Qty + CalcQty)/ItemsPerPack), 2)`. Rows: id 1 **ARP (SqFt)** `CalcQty = Ceil(sections
  ARPSqFt) + Ceil(parapets ARPSqFt)` — this IS the bill for ARP (roof-section ARP is subtracted
  from membrane and priced here; parapet ARP is an add-on, §8.4); its labor = `Quantity(extra) ×
  labor × (1 + adj)` only (the link shows no % — adjust −2). Id 2 **T-Patch** `CalcQty = Σ
  **Duro-Tuff** sections Round(AreaTotal/250)` (1 per 250 sq ft; `AreaTotal = Length × Width`,
  raw, no scrap; `Math.Round` = banker's). CORRECTED 2026-09-10: the first transcription said
  "non-Duro-Tuff" — the IL (`MembraneAccs.RecalcParents`, rva 0x1edb4) branches PAST the add
  when `CompareString(ShortName, "durotuff") ≠ 0`, i.e. only Duro-Tuff sections count. That is
  why the §12.0 anchor bid (Duro-Last) shows Calc Qty 0 and no T-Patch in the footer — the
  web's hold-at-0 was the right call. Id 3 **stripping** is a
  template: per section a derived row "1' of 10" DL {mil}mil {Colour} Stripping" (part number
  `baswf` + systemId(00) + colourId(00) + mil(000)) is created with price =
  `lookup_DuroLastPrices[mil, category 5][colour column]` (Duro-Tuff: `lookup_DuroTuffPrices[mil]`,
  name "…DT…"), labor = `stripping.Labor × durolastmech.DeckTypeMultiplier[section deck]`,
  `CalcQty = 0` — quantity is user-entered feet. Rows are recreated on every recalc.
- **Vents** (`Vent`, `ref_Vents`: Price, PriceForColor (unused in Cost), LaborFactor 0.5,
  CustomLabor): DERIVED — `CalcQty(colour c) = Σ sections with Color == c and
  FieldAttachmentSystem is cMechanicalSystem: Ceil(Length × Width / 1000)` (adhered sections
  contribute 0); `VENT_IDs = [1..6]` so vent RefID == colour id. Shown qty = `CalcQty +
  Quantity` (user delta, floored at −CalcQty). `Cost = price × total`; `h = Round(total ×
  LaborFactor, 4) × (1 + adj/100)`.

### 12.5 Fasteners & Related (E)

**Storage.** `Management.oRefFasteners` = every `ref_Fasteners` row (PartNumber, Description,
SubType, BoxPrice, BoxQuan, BoxWeight; joined to `ref_FastenersSubgroups` For* flags). Each
`Fastener` carries `m_iQuantity[14]`: slots 0–6 = the seven edge groups (§12.2), 7 unused, 8–13 =
deck buckets Wood / Metal(+Retrofit,Purlin) / Gypsum(+Tectum, LWC-Other) / Concrete /
LW-over-Concrete / LW-over-Steel. Sums: `Quantity(255)` = all slots, `254` = 0–6, `253` = 8–13.

**Money** (`Fasteners.TotalBoxCost` → dMaterial[4]): per catalog row `ReqBoxes = Ceil(Quantity(255)
/ BoxQuan)`, `cost = Round(ReqBoxes × BoxPrice, 2)` — so a 1½" Spade typed on the drip-edge
screen and on the Wood screen shares ONE box count. Bits, driver tips and plates are the same
mechanism (each a `ref_Fasteners` row bought by the box/each). No labor.

**Items Required** (`frmAccFasteners.InitializeTotals/UpdateTotals`), per bucket b; per present
section: `mf = RoofSection.MembraneFasteners` (field + perimeter row-style counts, §2.2 — `Round`
each), `uf = UnderlaymentFasteners(-1)` (all layers, §2.3); if the FIELD attachment is
`durobondmech` → `induct += uf` else `poly += mf`; `insulPlates += uf` **once per layer whose
attachment is `durolastmech`** (two mechanical layers double the plate count — legacy quirk,
transcribed); deck id → bucket: 1→Wood; 2,3,10→Metal; 5,8,9→Gypsum; 4→Concrete; 7→LW/Concrete;
6→LW/Steel. Per present parapet (its own deck type → bucket): `deckF += Parapet.DeckFasteners`
(= `ToInt32(AdjustedLength)`, 1 per foot — **premise correction to §8.5: this IS consumed, here**)
and `parapetEdge += Parapet.EdgeFasteners` (§8.5). Display for the selected bucket:
- Fasteners = `mf + uf + deckF − Σ entered qty(slot b)` over rows whose `SubType` (lower-cased) is
  allowed for the bucket: Wood {drill point, spade, xhd}; Metal {drill point, spade, purlin,
  xhd}; LW/Steel same as Metal; Gypsum {ntb, auger}; Concrete {concrete screw, nail};
  LW/Concrete {concrete screw, nail, ntb, auger} — prose-matched on the SubType string in legacy.
- Poly Plates = `poly + deckF − entered(ID 255)`; Insul. Plates = `insulPlates − entered(257)`;
  Induction Plates = `induct − entered(303)`; all clamped ≥ 0, red when > 0. **Gypsum bucket
  forces Poly and Insul. plates to 0** (auger/NTB carry their own plate).
- No default row: the count is an indicator; nothing lands in a row until typed. Fastener
  length vs board stack is the estimator's choice.

**Parapet Wall-Tabs and Steel Plates** (`frmAccessory5`): Fasteners Needed = `totals[5]
(Parapets.EdgeFasteners) − Σ Quantity(slot 1)` over the ForParapet group; **Steel Plates Needed
= max(needed, Σ entered parapet fasteners) − entered(ID 256, slot 1)** — one steel plate per
wall-tab fastener, never fewer than the computed need (ID 256 = the "3" Square Steel DL" row;
correction to §2.6 which called 256 "parapet-only fasteners"). Masonry Bits and Driver Tips grids everywhere:
user-entered only, no computed need, priced as boxes/each like any fastener row.

### 12.6 Parapet Termination tab (B.2) — model recap

Fields: `cboTermType` (ids above; default XML `termoption = 1` Empty, `termlength = 0`);
selecting a termination enables Length (`TermLength`), defaulting to the wall Length, editable
(auto-shifts with Length changes, §8.4); `UseTermBarOnBase` checkbox (adds wall Length ft of
WHITE term bar, drill split by WallType). Setup provides the parapet's WallType default ("2. Wall
Type": Wood or Metal = 1, Brick or Concrete = 4) and the Parapets Material mil/colour/attachment;
there is no Setup default for the termination itself. Money: nothing direct — every option only
feeds the accessory footages above (term bar id 2 by colour; fascia 3/4 by size; drip/gravel
5/9/6/10; two-piece 7/8/11–14), which then price per §12.2.

### 12.7 Ref tables (F) — what is data, and which grids still need a screenshot

| screen | table (columns used) | in web DB? |
|---|---|---|
| Term Bar | `ref_TermBars` (Color, Price/ft, Predrill/NonPredrillLabor, Custom*) | rates yes; price per colour: capture "Termination Bars" grid |
| Fascia | `ref_FasciaBars` (Price/ft, Size, labor ×4, vinyl W/T/G price, metal cover price, inside/outside corner price) | rates yes; **cover/corner prices: capture** |
| Drip Edge / Gravel Stop | `ref_GenericEdge` (EdgeGroup, EdgeSubType, EdgeSize, White/Tan/GrayPrice, PreDrill/NonPreDrillLaborFactor, Custom*, UsePreDrill) | bar prices + rates yes; **corner/clip/cover rows and UsePreDrill: capture** |
| Base & Snap Cover | `ref_TwoPieceMetal` (Price, CoverPrice, Inside/OutsideCornerPrice, LaborFactor, CornerLaborFactor, Size) | 3" only; **4"–8": capture** |
| all fastener grids | `ref_Fasteners` (BoxPrice, BoxQuan, SubType) + `ref_FastenersSubgroups` (For* flags) | 164 rows yes; subgroup flags seeded for 4 ids only — **capture the flag table** |
| Corners | `ref_Corners` (6 colour prices, ManHours, CustomLabor) | yes |
| Pipe Stacks | `ref_Stacks` (6 colour prices, Size), `ref_StackUses` (LaborAdjust) | yes |
| Washers | `ref_Washers` (Price, LaborRequired) | yes |
| Drains | `ref_DrainsBoots` (Price, PriceForColor, LaborFactor), `ref_DrainRings` (Price), `ref_DrainRoofTypes` (Cleanup/ReinstallLabor), `ref_Strainers` (Price, UnitLabor) | yes |
| Walk pads | `ref_AccOther` (Price, UnitLabor, SubType) | yes |
| Panduit | `ref_Panduit` (Price/unit, NumberPerBox, Length) | yes |
| Sealants | `ref_Sealants` (Price) | yes |
| Adhesives | `Adhesive` (Price, Unittype) + coverage tables (§2.4) | yes |
| Membrane Acc | `MembraneAcc` (PricePerPack, ItemsPerPack, DefaultUnitLabor) + `lookup_DuroLastPrices` cat 5 (stripping) | yes |
| Vents | `ref_Vents` (Price, LaborFactor) | yes |

Constants that are code, not data: 1.03 scrap (f32), ten-foot rounding, 21 / 42 / 63 fasteners per
10 ft, 1 vent per 1,000 sq ft (mechanical only), 1 T-Patch per 250 sq ft, pipe-stack π·(d+¼) and
17"/11" strap bands, 2 sealant beads per stack ÷ 10 ft, 0.25 h open-stack adder and the ×1.5 (>12")
/ ×2 (>18") size factors, drain 1 tube each, washers ¼ tube each, 350 LF strip mastic per pail,
12 LF per caulk tube, adhesive cost rounded to whole dollars, box counts `Ceil`.

### 12.8 Implementation status (web, 2026-09-10) + open questions

IMPLEMENTED (src/lib/engine/accessories.ts + accessories-screens.tsx, anchors §12.0 reproduced
in accessories.test.ts): the full §12 money path — edge terminations (term bar with the
base-footage quirk and dead Peel Stop rows, fascia + vinyl/metal covers, drip/gravel generic
edges, snap cover), corners, pipe stacks (usage/open/size labor factors + strap/sealant
consumption), washers, drains + strainers, walk pads, panduit boxes, sealant CalcQty, membrane
accs, derived vents, the 14-slot fastener model with shared per-row box counts, per-bucket Items
Required (insulation plates over-counted per mechanical layer — quirk transcribed), parapet
wall-tab / steel-plate counts, and the §12.4 whole-dollar adhesive rounding (+ Extra units).
Billing: material → dMaterial[4] (ARP keeps its own slot), hours → crew-rate direct labor,
hours billed unrounded (footer displays 2dp). Fastener subgroup membership is seeded from the
captured screens' visible grids. The parapet Termination sub-tab (§12.6) is built (termination
id / length / Use Term Bar on Base / Wall Type per wall).

DELIBERATE HOLDS (no fabrication in the money path):

1. **T-Patch CalcQty = 0** — CONTRADICTION: §12.4's `Σ non-Duro-Tuff sections
   Round(AreaTotal/250)` gives 22 on the §12.0 anchor bid (55×100), but the captured Membrane
   Accs screen shows Calc Qty 0 AND the reconciled footer ($264.25) carries no T-Patch. What is
   `AreaTotal`, and which way does the Duro-Tuff filter cut? Extra-only billing until resolved.
2. **Duro-Caulk tube rounding** — the §2.5 transcription reads literally
   `Ceiling(termBarLF + fasciaCoverLF) / 12`; we implemented `Ceil(sum / 12)` ("1 tube per
   12 LF", whole tubes). Please confirm the operator order.
3. **Drain/washer tube colour** — "the White/Gray bucket, index 2": implemented as GRAY
   (colour ids Tan 1 / Gray 2 / White 3). Confirm.
4. **Parapets.EdgeFasteners, Duro-Last walls** — the §8.5 formula needs
   CalcTabCount/TabCount from the frmParapets tab layout; walls over 30" vertical currently show
   0 needed (typed fasteners still bill). Please extract the tab-count model.
5. **Generic-edge parapet drill split** — the §12.2 parapet-index quirk reads
   `ref_DeckTypes.Predrill` (flags uncaptured); we route all parapet footage no-drill. With
   UsePreDrill=false everywhere the only divergence is labor on pre-drill footage.
6. **Pitch Pocket Filler** — RefID 10 ↔ part number (1121 vs 1122)? Plus PitchPan.FillerAmount
   values. CalcQty held at 0.
7. **Term-bar strip mastic default length** — `GetTotalLength(false,false)` read as the SUM over
   bars; confirm single-bar vs group.
8. **Capstone sealant tubes** (§8.4 `Ceil(Ceil(len)/40)`) — which sealant row do they land on?
9. **Tab Sealer** — the §2.5 Duro-Roof seam sealant (RefID 19) is attached to part 1119T
   "Tab Sealer" (the only candidate row); confirm the RefID→part mapping.

DATA CAPTURES still needed from the licensed app's admin grids (not IL): ref_TwoPieceMetal
prices 3"–8" (labor is live; material bills $0 with a warning until captured) and the
lookup category-5 stripping prices (stripping rows bill labor only). The §12.7 fascia
cover/corner prices, drip/gravel corner+clip rows, and per-colour term-bar prices turned out to
be ALREADY LIVE in the web pricing_catalog.

### 12.9 Answers to §12.8 (decompiler session, 2026-09-10) — IL-exact, report-only

Scorecard against what the web implemented or held: items 1 (hold), 7 (sum), 9 (1119T) were
right; items 2 (rounding) and 3 (colour) were wrong; 4–6 and 8 were open and are closed below.
Methods are cited so a skeptic can re-dump them. The embedded upgrade ledger
`BidAdvantage.DataAccess.SqlScript.xml` (shipped inside the DataAccess assembly; a history of
`INSERT`/`UPDATE`/`DELETE`/`DBCC CHECKIDENT` statements) is used where the IL cannot see a table —
it fixes IDENTITY ids exactly, but any PRICE in it is historical, not current.

1. **T-Patch** — the §12.4 filter was inverted; corrected in place (commit "correct six stale
   claims"): only **Duro-Tuff** sections contribute `Round(Length × Width / 250)` (banker's).
   `AreaTotal = Length × Width` (`RoofSection.get_AreaTotal`, rva 0x4b5a4), no scrap, no
   parapets. On a Duro-Last bid CalcQty is 0 — the captured screen and footer were right and the
   web's hold at 0 is the correct value, not a hold. Implement as Duro-Tuff-only.

2. **Duro-Caulk tubes** — neither literal reading. IL (`Sealants.RecalcParents`, rva 0x22208):
   `tubes[i] = Convert.ToInt32( Math.Ceiling(CDec(termBarLF(i) + fasciaCoverLF(i))) / 12D )`.
   Ceiling applies to the FEET, the division is decimal, and `Convert.ToInt32(Decimal)` rounds
   half-to-even. Test vectors: 6 ft → 0; 12 → 1; 13 → 1; 17 → 1; 18 → 2; 19 → 2; 30 → 2; 42 →
   4 (3.5 → 4). The web's `Ceil(sum/12)` gives 1, 1, 2, 2, 2, 2, 3, 4 — wrong on 6, 13, 17, 30.
   `termBarLF(i)` is `TermBars.GetTotalLengthByColor(i, False, False)` (rva 0x2633c) = the
   **first** present bar with `Color − 1 == i`, returning `R10(1.03f × (roof + curb + parapet +
   otherPreDrill + otherNoDrill))` — no base footage; `fasciaCoverLF(i)` =
   `FaciaBars.TotalCoverLengthByColor(i)` (rva 0x182d8) = Σ bars vinyl(colour i+1) +
   metal(index i).

3. **Colour index 2 = WHITE.** Two enums: `eDLColorsIndex` is 0-based (Tan 0, Gray 1, White 2,
   DarkGray 3, TerraCotta 4, RockPly 5) and drives the sealant buckets; `eDLColorsID` is 1-based
   (Tan 1, Gray 2, White 3 …) and is what term bars / fascia colours carry (`GetTotalLengthByColor`
   compares `Color − 1` to the index; `TotalCoverLengthByColor` parses `i + 1` as `eDLColorsID`).
   Drains, washers and capstone tubes therefore land on White → `DUROCAULK_ID[2] = 13`.
   The web's GRAY needs to move to WHITE.

   **RefID → part map for `ref_Sealants`** (from the upgrade ledger's identity history, cross-
   checked against the code arrays `DUROCAULK_ID = [14, 15, 13, 15, 16, 15]` (Tan, Gray, White,
   DarkGray, TerraCotta, RockPly) and `PARASEAL_ID = [6, 7, 5]` (Tan, Gray, White), the
   `SetStripMastic → 9` / `SetPitchPocket → 10` setters, the `RefID 19` seam-sealant loop, and the
   estimator grid order, which is `SELECT * FROM ref_Sealants` with no ORDER BY):

   | SealantID | part | name | how it is set |
   |---|---|---|---|
   | 1–4 | 1116 / 1116B / 1114 / 1115 | Duro-Caulk W/T/G/Bronze | discontinued; extra only |
   | 5–8 | 1126 / 1126B / 1124 / 1125 | Paraseal W/T/G/Bronze | discontinued; `PARASEAL_ID` (W 5, T 6, G 7) referenced but no calc path adds to them |
   | 9 | 1129 | Strip Mastic (Pail) | `SetStripMastic` |
   | 10 | 1121 | Pitch Pocket Filler (10.2 oz) | `SetPitchPocket` — see item 6 |
   | 11 | 1122 | Pitch Pocket Filler (30 oz) | extra only |
   | 12 | 1123 | SB-240 Mastic | zeroed each recalc, never added to — extra only |
   | 13 | 1136 | Duro-Caulk Plus – White | index 2 (White) + drains + washers + capstone |
   | 14 | 1138 | Duro-Caulk Plus – Tan | index 0 (Tan) |
   | 15 | 1134 | Duro-Caulk Plus – Gray | indices 1, 3, 5 (Gray, DarkGray, RockPly) |
   | 16 | 1135 | Duro-Caulk Plus – Bronze | index 4 (TerraCotta); NOT zeroed before the add |
   | 17, 18 | — | (deleted rows: water/solvent base adhesive) | — |
   | 19 | 1119T | Tab Sealer | seam-sealant loop (item 9) |

   Ledger evidence: ids 13–16 were inserted after `DBCC CHECKIDENT('ref_Sealants', RESEED, 13)`
   as White 1136, Tan 1138, Gray 1138→`1134`, Bronze 1139→`1135`, then 1111, 1112-010, 1119T as
   17, 18, 19, then `DELETE … WHERE SealantID = 17 or 18`. The 10 vs 11 split is the one row the
   ledger does not name: 10 is priced 4.88 in it (tube-scale, matching the 10.2 oz row) and the
   grid lists 1121 before 1122 in id order. Treat 10 ↔ 1121 as evidenced, not proven; item 6
   gives a one-screen confirmation.

4. **`Parapets.EdgeFasteners` for Duro-Last walls** — the tab model is now written into §8.5
   (`CalcTabCount` = index of the highest non-zero slot in the tab array = number of tab rows
   above the skirt, cant included). Worked values, `In2Ft(12) = 1`, `In2Ft(15) = 1.25`:
   Duro-Last mech, 40 ft adjusted length, vertical 36", no cant → CalcTabCount 1 →
   `Ceil(40 / 1 × 1) = 40`; same wall with cant → 2 → 80; vertical 60", no cant → 2 → 80;
   Duro-Last adhered (non-mech), 40 ft, 36", no cant → `Round(40 / 1.25 × 1) = 32`. Vertical ≤ 30
   → 0 regardless. The walls "over 30" showing 0" in the web are exactly the CalcTabCount gap.

5. **Deck pre-drill flags** — the table is `global_DeckType` (not `ref_DeckTypes`), column
   `IsPreDrill`, loaded by `Management` (`SELECT * FROM global_DeckType`, ordinal 3 →
   `DeckType.Predrill`). The upgrade ledger seeds it: Wood 0, Structural Metal 0, Metal Retrofit
   0, **Concrete 1**, Gypsum 0, **LWC/Steel 1, LWC/Concrete 1, LWC/Other 1, Tectum 1, Purlin
   Fastened 1** (ids 1–10). There is no admin UI for it, so this seed is the best available value;
   it is a `global_` (vendor) table, not a contractor-editable one. Consumer:
   `GenericEdgeItem.CalcParapetLength` (rva 0x1c008) — for parapet i whose `TermOption.ID ==
   SubType`, `len = IsPresent ? TermLength : 0`; if the edge row's `UsePreDrill` AND
   `RoofSections(i).DeckType.Predrill` → the pre-drill bucket, else the no-drill bucket (the
   `RoofSections(i)` index is the parapet's index — the §12.2 quirk, unchanged). With `UsePreDrill`
   false on every seeded generic-edge row, routing everything no-drill is IL-equivalent; the flags
   above make it exact if a row ever has `UsePreDrill = 1`.

6. **Pitch Pocket Filler** — RefID 10 ↔ 1121 (10.2 oz) per the table in item 3. `FillerAmount`
   is `ref_MetalsPitchPans.Filler` (columns: MetalsPitchPansID, Description, PartNumber, Price,
   LaborPerUnit, LaborRate, DimensionA/B/C, Filler), read by `PitchPans` from the ref table and
   copied per row. **Not in the IL, not in the ledger, and not shown by any admin grid** (the
   Pitch Pans grid shows Description / Unit Cost / Labor Per Unit / Labor Rate only) — the only
   capture route is behavioural: in the licensed Estimator, with no pipe stacks of usage "Pitch
   Pan", set Qty 1 on ONE pitch-pan size (Metals → Pitch Pans), then read Accessories → Sealants
   → the row whose Calc Qty moved: the row identifies RefID 10's part number (1121 vs 1122) and
   the value is `Filler` for that size. Repeat for 6×6×8 and 8×8×8 (three screenshots). Until
   then the web's hold at 0 for the pan term is the honest value; the pipe-stack term
   `(qty + (isOpen ? 0 : 1)) × {>15" 4, >11" 3, >8" 2, else 1}` for usage id 3 is IL-complete
   and can ship now.

7. **Strip mastic default** — SUM over present bars (`TermBars.GetTotalLength(False, False)`,
   rva 0x262f8, loops all bars and adds each `TermBar.GetTotalLength`), so the web's sum is
   right; note the stored value lives on bar[0] and the sealant path then applies
   `R10(1.03f × ·)` twice more (three scrap passes on the default path — §2.5 corrected).
   Fascia bars carry their own `StripMasticLength` per bar and are summed the same way.

8. **Capstone sealant tubes** — `Ceiling(Ceiling(Parapet.Length) / 40)` per present parapet with
   `Capstone.ID == 2` (Remove & Reinstall), added to colour index 2 = White → **RefID 13,
   Duro-Caulk Plus White (1136)**, regardless of the parapet's colour. Uses the wall `Length`,
   not `CapstoneLength2`.

9. **Tab Sealer** — confirmed: RefID 19 ↔ part 1119T. The ledger inserts 'Tab Sealer','1119T' as
   the third row after the reseed-to-13 batch (14, 15, 16, then 17, 18, 19) and only 17 and 18
   are deleted. The seam loop is `If Sealant.RefID = 19 Then CalcQty = CInt(Round(seamLF / 30 /
   5))` over Duro-Roof sections only.

Not answered here (unchanged captures): `ref_TwoPieceMetal` current prices for ids 1–6 (the
ledger shows the row structure — ids 3, 1, 4, 2, 5, 6 = 3", 4", 5", 6", 7", 8", `Size` 2, 0, 3,
1, 4, 5 — with historical prices only), and `lookup_DuroLastPrices` category 5.

**§12.9 web implementation status (2026-09-10):** items 1–5 and 7–9 are implemented in
`src/lib/engine/accessories.ts` with tests pinning the §12.9 vectors — T-Patch Duro-Tuff-only;
Duro-Caulk `ToInt32(Ceil(ft)/12)` (6→0, 13→1, 18→2, 30→2, 42→4) over the ten-rounded term-bar
scrap lengths + raw cover feet, on the 6-bucket eDLColorsIndex with DUROCAULK parts
1138/1134/1136/1135; drains/washers/capstone tubes on WHITE (1136); pitch-pocket stack term on
1121 (pan term awaits the item-6 behavioural capture); the Duro-Last CalcTabCount model (mech
40/80, adhered 32 worked values reproduce; Duro-Roof → 0 as a non-listed ShortName); the
IsPreDrill seed noted at the generic-edge split (inert while every row has UsePreDrill=false);
strip-mastic sealant path now applies the third scrap pass. The Bronze-row accumulation quirk
(RefID 16 never zeroed between recalcs) is legacy session state, not a formula — a pure
recompute matches the first-recalc value and the drift is deliberately not reproduced.

**Two-Piece Metal prices: FOUND (2026-09-10).** The ref_TwoPieceMetal prices were captured all
along — they live on the EXCEPTIONAL Metals admin screen (pricing_catalog
`duro_last:exceptional_metals` → `subscreens.two_piece_metals`), all six sizes with part
numbers: bars 3"–8" $2.50/2597, $3.00/2600B, $3.05/2601B, $3.25/2602B, $3.60/2603B,
$3.85/2604B; covers $3.70–$5.45; corners $30.60–$35.90 each side. `buildAccessoryRefData` now
reads them (grouped by the `N" 2-Piece Compression` header rows) and Base & Snap Cover bills
material. Remaining captures: ONLY the lookup category-5 stripping prices and the §12.9 item-6
pitch-pan behavioural capture (Filler values + the 1121-vs-1122 confirmation).

## 13. EXCEPTIONAL Metals — the complete money path (IL-exact, 2026-09-10)

Extracted in-session from the licensed install's `DataAccess.dll` (dnfile/dncil IL dump of
`BidAdvantage.DataAccess.Gutter` 0xa16xx–0xa20xx, `GutterAcc(s)`, `DownSpout(Acc)(s)`,
`PitchPan(s)`, `CollectionBox(es)`, `Metals`, `ReviewCalc.Recalculate` 0x4550c) and
`Estimator.exe` (frmMetals/frmGutters/frmDownSpouts/frmPitchPans/frmCollectionBoxes designer IL
+ RefreshSummary 0x65758). All arithmetic in .NET Single (float32).

### 13.1 Row money

Length-based rows — **Gutter** (per Style+Size) and **DownSpout** (per size, Open/Closed):

- `MaterialCost = increment10(Length) × PricePerFoot`
- `increment10(x)`: `x ≤ 0 → 0`; `0 < x < 10 → 1` (**quirk** — the IL loads the literal
  `1.0`, so a 6-ft run bills one foot of material, not ten); `x % 10 == 0 → x`; else
  `x + 10 − x % 10` (round UP to the next 10 ft).
- `Labor (hours) = Length × LaborPerFoot` (recomputed by `set_Length`; `set_Labor` back-derives
  LaborPerFoot — an override facility, not a second formula).
- `LaborCost = Labor × LaborRate` (the row's own ref-data $/hr).
- Displayed `Qty` = "bars": `0 → 0`; `≤ 10 → 1`; else `Convert.ToInt32(Length/10)`
  (banker's — 25 ft shows 2, 35 ft shows 4). Display only; money uses increment10.

Qty-based rows — **GutterAcc**, **DownSpoutAcc**, **PitchPan**, **CollectionBox**:
`MaterialCost = Price × Qty`; `Labor = Qty × LaborPerUnit`; `LaborCost = Labor × LaborRate`.

### 13.2 Structure & roll-up

- Gutter accessories (End Caps L/R, Splice Plates, Miters, Gutter Sealant, Rivets) are children
  of their gutter (`Gutter.oGutterAccs`); `Gutters.OnRecalculate` sums
  `Gutter.get_MaterialCost(true)` — that is why `GutterAccs` never appears in the `Metals`
  sums (it is not top-level).
- ALL downspout accessories — the per-size Drop/Outlet + elbows AND the General Downspout
  Accessories (Straps, Square-To-Round, Rivets, Snow Diverter) — are one flat top-level
  `DownSpoutAccs` collection.
- `Metals.MaterialCost/LaborCost/Labor` = Gutters + DownSpouts + DownSpoutAccs + PitchPans +
  CollectionBoxes (straight float32 sums, no rounding).

### 13.3 ReviewCalc wiring (CONFIRMED — closes the old "FLAGGED FOR BID VALIDATION")

`ReviewCalc.Recalculate`: `dMaterial[5] = GoodSingle(Metals.MaterialCost)` (inside M0 with the
other dMaterial slots), `dLabor[5,0] = GoodSingle(Metals.LaborCost)`,
`dLabor[5,1] = GoodSingle(Metals.Labor)`. Metals labor is DIRECT labor at each row's OWN
LaborRate inside LaborSubtotal1 — never the bid crew rate, and NOT LaborSubtotal2 services
(the web app already billed this way; the doubt in the MetalLine comment is resolved).

### 13.4 Screen (frmMetals) & web implementation

Legacy screen: "EXCEPTIONAL Metals" title, four tile buttons (Gutters / Downspouts /
Pitch Pans / Collection Boxes — icon images recovered from the form resources into
`public/metals-*.png`), lvSummary grid `Category | Item | Qty/LF | Cost/Quote |
Hours PerUnit/LF | Hours | Labor Cost` + Edit; RefreshSummary itemizes each gutter/downspout
with its OWN money (`get_MaterialCost(false)`) and each accessory as its own row
(`"«acc» for «gutter»"`), LaborPerFoot at 3 dp / Hours at 2 dp (display rounding only).
Dialogs: frmGutters = Style + Size dropdowns over a grid (gutter row edits Length; accessory
rows edit Qty; grid rows 1+ map to GutterAccs[row−1]); frmDownSpouts = Size dropdown, grid rows
0–1 are the Open/Closed DownSpouts (Length), rows 2+ are DownSpoutAccs[row−2] (Qty), plus the
"General Downspout Accessories" grid; frmPitchPans = "Vinyl Coated Metal Pitch Pans" qty rows;
frmCollectionBoxes = "Scupper Option" dropdown (Without/With Scupper) + qty rows. Footer
`Total:` + `Finished` on each dialog.

Web: engine module `src/lib/engine/metals.ts` (`buildMetalsRefData` from the seeded
`duro_last:exceptional_metals` subscreens, `MetalsState`, `computeMetals` → summary lines +
`dMaterial[5]`/`dLabor[5]` totals, float32 throughout), billed in `bid-builder.ts` alongside
the old flat `MetalLine[]` lines (older bids keep computing identically; the flat picker is
demoted to an "Extra catalog lines (older bid)" card). UI `src/components/metals-screens.tsx`
mirrors the tile screen + four dialogs. Seed repair applied live (verify→apply→verify): the
4"X4" downspout grid row 3 had `description: null` — restored to "Drop/Outlet" by grid
position (the 6"X6" grid carries Drop/Outlet in the same slot); its money values (23.95 /
0.75 h / $45) were already present, so no prices were invented. Note the seeded gutter grids
carry $0 labor columns (installer defaults had no per-LF gutter labor) — gutter hours stay 0
until the admin fills them; downspout/pitch-pan/collection-box labor is live.

## 14. Non-Duro-Last Items — the complete money path (IL-exact, 2026-09-10)

Extracted in-session from `DataAccess.dll` (`NDLItem` 0xa85f1–0xa8fc9, `NDLCollectionBase`
0xa768c–0xa8550, `EdgeBlockings`/`WallBlockings`/`DeckMaterials`/`SheetMetals`/`Masonry`/
`Services`/`Subcontractors`/`CustomApps`/`NDLOthers`, `NonDL` 0xa90d4–0xa9d64,
`ReviewCalc.Recalculate` + `ReviewCalc.NonDL` 0x46b80) and `Estimator.exe` (`frmNonDL`
RefreshSummary 0x67f44, `frmNonDL1..6` Load / FieldChanged / btnResetLabor /
txtMaterialTotal_LostFocus / btnFinish).

### 14.1 Item money (`NDLItem`)

- `Qty(total) = m_iQty (user "Extra"/"Quantity") + m_iCalcQty (auto)`. Grids that show a single
  "Quantity" (Sheet Metal, Masonry, Services, Subcontractors, Custom) display `Qty(1)` and
  `set_Qty(incl, v)` stores `v − CalcQty`; the Blocking and Deck grids show `Footage`/`Calc` and
  `Extra` separately.
- `MaterialCost = DACommon.toSingle(Qty(1) × UnitCost, 4)` — Round 4 dp then Single.
- `Labor (hours) = m_dUserLabor = Qty(1) × dLaborPerUnit`, recomputed by `set_Qty`,
  `set_CalcQty` and `set_LaborPerUnit`; `set_Labor(v)` stores `toSingle(v, 2)` and back-derives
  `dLaborPerUnit = Round(v / Qty(1), 2)`; the Days column is `Hours ÷ Settings.HoursPerDay`.
- `LaborCost = toSingle(Labor × LaborRate, 4)`.
- `LaborRate`: the ref row's rate; `ReadRefData` substitutes `Estimate.LaborRate` (crew rate)
  when the ref rate is 0. A user-added row (the blank last grid row; typing a Description calls
  `NDLCollectionBase.Add(desc)`) inherits the previous row's rate, or the crew rate when first.
  "Use Estimate Labor" sets every row of the dialog's collection(s) to the crew rate.
- `IsPresent = Labor > 0 or Qty(1) > 0`.

### 14.2 Collections & the dead override

`NDLCollectionBase.OnRecalculate` calls `RecalcRow(i)` per row then sums MaterialCost /
LaborCost / Labor in double. `get_MaterialCost(recalc)` / `Labor()` / `get_LaborCost(recalc)`
branch on `bOverride`: when set, material = `m_dMaterialCostOverride` and labor = 0 (the
"Subcontractor" lump sum the Deck Materials / Sheet Metal dialogs' editable "Material Total"
box writes via `set_MaterialCost`, with the btnFinish warning "treated as a subcontract and will
not be figured as a labor portion"). **`bOverride` is initialised `false` in the ctor and no
code path in the shipped Estimator.exe / DataAccess.dll ever calls `set_IsOverriden`** (full
IL scan) — the typed total is stored (`NonDuroLast.DeckMaterialsMat / SheetMetalWorkMat`) but
never bills. Dead code; not reproduced (same policy as Peel Stop).

### 14.3 ReviewCalc wiring

`dLabor` is sized `30 + Subcontractors.Count + Services.Count + 1`. For i = 0..5 the
`ReviewCalc.NonDL(group, labor?, cost?)` switch feeds **dMaterial[14+i]**, **dLabor[14+i,0]**
(LaborCost) and **dLabor[14+i,1]** (hours) from: 1 = WallBlockings + EdgeBlockings, 2 =
DeckMaterials, 3 = SheetMetals, 4 = Masonry, 5 = CustomApps, 6 = NDLOthers — all with
`get_MaterialCost(0)`, so **wall-blocking material bills** (the earlier "labor-only" reading
was the dialog footer). `dMaterial[20] = Σ dMaterial[0..19]` (MaterialTotalBeforeTax, taxed
unless TaxExempt) and `dTotals[7] = NonDL.MaterialCost` (OtherMaterial) — the same six groups.
Labor for those six is DIRECT labor at each row's own rate inside LaborSubtotal1, hours in
man-days. **Subcontractors** and **Services** get one dLabor row per item at `24 + k`:
`[,0] = MaterialCost + LaborCost`, `[,1] = Labor`, both accumulated into the last row
(LaborSubtotal2). `NonDL.MaterialCostIncludingServices` (the summary Totals row) adds
Services material; Subcontractors material is never material. This CONFIRMS the web routing
that already existed (`NON_DL_LS2_CATEGORIES`).

### 14.4 Auto quantities (`RecalcParents`, keyed by ref RefID)

| Collection | Hook | CalcQty |
|---|---|---|
| EdgeBlockings ("Thickness" ref column = OtherRefData) | per present RoofSection | greedy fill of `UnderlaymentThickness` (Σ layer RealThickness) with rows 3→0 while `t > 0.6`; one more row-0 board when `0.5 ≤ t`; `CalcQty[i] += toInt(Ceil(count[i] × BlockingLinealFt × f32(1.03)))` |
| WallBlockings row 0 | Parapets.BlockingLinealFt | `ToInt32(Ceil(LF × 1.03))` |
| SheetMetals RefID 1 (Curb Counter Flashing) | curbs TermOption 5 | the §8.3 feet |
| Masonry RefID 1 (Remove Only) / RefID 2 (**Mortar Mix**) | capstone option 1 / 2 LF | `Ceil(LF / 2)` each |
| Services RefID 3 (Dumpster) | RoofSections.TearOffVolume | `Ceil(Σ section DumpsterYards ÷ Settings.DumpsterYards)` |
| NDLOthers RefID 1 (DL Approved Slipsheet) / 2 | Parapets + Curbs PolyethyleneSqFt / Curbs.ISO_SqFt | `Ceil(sq ft)` each |

`Curb.PolyethyleneSqF = Round(LinealFt × (C + D) × 5 / 48 × qty, 8)`; `Curb.SF_ISO = LinealFt
× qty`. The 3rd Party Services screen's `extras.yardage` is `Settings.DumpsterYards` (30).

**Seed gaps (flagged, not guessed):** neither the RoofEdgeBlocking `Thickness` column nor the
Underlayment `RealThickness` was captured — both stand in via the inch dimension in the row's
own name (`½"`, `5/4"`, `1 1/2" ISO`, `2.7" Rigid`; slip sheets → 0), a seeded numeric
`Thickness` key wins when present. `ref_ndlOthers` (2 rows; the ledger names row 1 "DL
Approved Slipsheet") was never on a captured admin screen — seeded as `non_dl:others` with $0
and `_uncaptured`, so an auto quantity on either row raises a warning instead of billing $0
silently; capture the two rows' prices from the licensed Estimator to close it.

### 14.5 Screen & web implementation

`frmNonDL`: title "Non-Duro-Last Items", six tiles (Wood & Edge Blocking / Structural Roof Deck
Materials / Sheet Metal Work / Masonry Work / Sub-Contractors and Services / Customized
Contractor Applications — icons recovered into `public/nondl-*.png`), lvSummary `Category |
Item | Qty. | Cost/Quote | Hours | Labor Cost` (hours Round 3) + Edit; categories in order Roof
Edge Blocking, Wall Blocking, Roof Deck Materials, Sheet Metals, Masonry, Services,
Subcontractors, Custom Applications, Others; Totals = MaterialCostIncludingServices / Labor /
LaborCost. Dialog grids (CustomList): `Description | Footage|Calc | Extra | Unit Cost | Total
Cost | HoursPerUnit | Days|Hours | Labor Rate | Labor Cost` (frmNonDL1/2) or `Description |
Quantity | …` (3/4/5/6), the blank add-row, "Use Estimate Labor", footer `Total:` (1, 3) or
`Material Total:` / `Labor Total:` (2, 4, 5, 6), Finished.

Web: engine module `src/lib/engine/nondl.ts` (`buildNonDlRefData` from every `non_dl` screen,
`NonDlState` = per-row extra + unit-cost / hrs-per-unit / hours / rate overrides + custom rows,
`nonDlCalcQuantities`, `computeNonDl` → lines + OtherMaterial / own-rate labor / subs /
services), billed in `bid-builder.ts` (the module OWNS the auto rows whenever the snapshot
carries the non_dl screens; the older §8.3/§8.4 auto path survives only for frozen snapshots
without them; flat `nonDlLines` from older bids keep billing as before and show as "Extra
catalog lines (older bid)"). Review ledger rows come from the module lines (Wood Blocking ←
edge + wall, Roof Decking, Sheet Metal, Masonry, Custom Apps, Other ← Others; one
Subcontractors / Services row per item). UI `src/components/nondl-screens.tsx` mirrors the
six-tile screen and dialogs. `Settings.DumpsterYards` now reads the services screen's
`extras.yardage` (was hard-coded 30).

## 15. Curbs screen — web implementation status (2026-09-10)

Re-verified against the IL in-session (`Curb.BaseHours` 0x333a4, `ManHours` 0x3365b, `LinealFt`
0x3334a, `ISO_Labor` 0x33718, `ISO_Fasteners` 0x33764, `PolyethyleneSqF` 0x33684, `SF_ISO`
0x336e4, `Curbs.OnRecalculate` 0x33afc, `ReviewCalc.Recalculate` slots; `frmCurbs`
InitializeComponent / FillFields / ResetFields / VerifyFields / UpdateView / picCurb_Paint /
optNone_CheckedChanged / style button handlers).

**Wiring (confirmed):** `dMaterial[3] = Curbs.TotalCost` (Σ `Curb.Cost`, the §2 wrap model),
`dLabor[3,0] = CalcLaborCost(Curbs.ManHours)` at the ESTIMATE crew rate, `dLabor[3,1]` = hours —
the web already billed both this way. Term options → ids 0 None, 1 Scupper/Fascia, 2 Lift & Tuck,
3 Lift & T-Bar, 4 No Lift & T-Bar, 5 No Lift & Counter Flash (radio order on the form: None,
No Lift & Counter Flash, No Lift & T-Bar, Lift & T-Bar, Lift & Tuck, Scupper/Fascia); With Top
forces None (and disables the group), Scupper / Metal Scupper force Scupper/Fascia. Style
buttons → `CurbStyle` index 0..6 = ids 1..7 (Open, Closed, Open Canted, Closed Canted, With Top,
Scupper, Metal Scupper); the canted pair are menu items under Open / Closed.

**Two web divergences corrected (both against §8.2, already transcribed there):**
1. `curbLaborHours` applied the style multiplier to the per-LF term only; the legacy multiplies
   `(perLF × perimeter × qty + base × qty)` — the setup/base term too. Fixed (test: Scupper ×4
   → 166/60 × 4 h).
2. "Plastic on Curb(s)" labor `PolyethyleneSqF / 400` hours (inside BaseHours, so under the
   per-item adjust %) was missing. Fixed (test: 37.5 sq ft → 0.09375 h). The poly / ISO sq ft
   also now feed the §14 Non-DL "Others" rows.

**Screen:** the legacy curb drawings were recovered from the frmCurbs ImageList streams
(`iltLarge` 150×115 → `public/curb-style-0..5.png`, `iltCurbs` 58×58 → `public/curb-icon-0..5.png`;
image index by style: 1→0, 2→1, 3/4→2, 5→3, 6→4, 7→5 per `FillFields`). The A/B/C/D dimension
letters are drawn INTO those images; `picCurb_Paint` only writes the numeric readout
("A: n" … "D: n", Arial 12 bold) down the left of the picture box at y = 35/60/85/110 — the web
now does the same (readout column + legacy image) instead of positioning its own letters over a
redrawn schematic. Textbox defaults A 1, B 1, C 12, Skirt (D) 6; `VerifyFields` requires all four
> 0 and warns when C < 8 ("Minimum height for curbs is 8\"…"); the lvSummary is Label | Option |
Qty | A | B | C | D | Color with `UpdateScreenTotals` Man Hours + labor $; "Copy Settings from
Roof Section" copies deck type + color (+ mil); the per-curb "Labor: X hours" link edits
AdjustLabor. Web: `src/components/curbs-screen.tsx`.

## 16. Roof Sections screen — geometry, per-section labor, complexity (IL-exact, 2026-09-10)

Re-read in-session: `RoofSection` (DataAccess.dll) `PerimSideLengthMinusCorners_4_0_230`
0x4b69c, `PerimTotalLength` 0x4ba14, `CornerTotalLength` 0x4b5f0, `AreaCorner` 0x4b61b,
`get_AreaField` 0x4ba54, `FieldLength/FieldWidth` 0x4bafc/0x4bb5c, `ARPSqFt` 0x4bbd8,
`BaseHours`/`AdjustedBaseHours` 0x4bc5c/0x4bc8a, `get_SheetSize`/`set_SheetSize` 0x478a8/0x479e8,
`OnRecalculate` 0x4dc94 (BlockingLinealFt), `TearOffBaseLabor` 0x4da98, `RoofSections.AdjustLabor`
0x4f8a4 / `get_ManHours` 0x4f9d8; `frmRoofSection` (Estimator.exe) `cbSideXIsPerim_CheckedChanged`,
`CheckCorners`, `chkboxCornerN_CheckedChanged`, `txtPerimX_Leave`, `txtTermXLen/txtARPXLen/
txtWoodXLen_TextChanged`, `chkBlocking_CheckedChanged`/`SetBlocking`, `cbComplexity_SelectedIndex
Changed`, `LoadComplexityFactors`, `optQuick_CheckedChanged`, `optComplex_Click`, `txtLength_Leave`,
`UpdatePreview`, `VerifyFields`; `frmRoofSectionAdv.LinkLabel1_LinkClicked` (perimeter calculator);
`FrmRoofSectionsSummary.LoadSummary`; seeded `ref_SheetSizes`, `Complexities`, `RSComplexityFactor`.

### 16.1 Geometry (money path)

- Side lengths are the section dims (A/C = Length, B/D = Width). Checking **Is Perimeter Edge**
  sets `PerimSideLength(i) = side length` and auto-marks the corners whose OTHER side is already
  perimeter (side i marks corner i when side i+1 is perimeter and corner i−1 when side i−1 is);
  unchecking zeroes the run, clears both adjacent corners and the tall-wall flag. `CheckCorners`
  shows corner i only while sides i and i+1 are both perimeter (0 = A∧B, 1 = B∧C, 2 = C∧D,
  3 = D∧A); a hidden corner is unchecked. `txtPerimX_Leave` stores `Round(value, 2)`.
- `PerimTotalLength = Σ_i max(0, PerimSideLength(i) − W·[corner i] − W·[corner i−1])` (W =
  PerimEnhancementWidth; ≥ 4.0.230 clamps each side at 0). `CornerTotalLength = Σ marked corners
  × W`, `AreaCorner = CornerTotalLength × W`, `AreaPerimeter = PerimTotalLength × W`,
  `AreaField = AreaTotal − AreaPerimeter − AreaCorner`.
- `ARPSqFt = 1.03 × Σ ((ARP.Size + 6) / 12) × ARPLength[i]` — ARPLength is its own textbox
  (`txtARPXLen`, default the side length). `TerminationWidth[i]` (`txtTermXLen`) likewise; both
  feed the §12 roof-edge feet (ToInt32 per side).
- Wood blocking: checking sets `Blocking = refBlockings[1]` (ID 2) and `BlockingWidth =
  Round(side length)`; `BlockingLinealFt = Σ BlockingWidth where Blocking.ID == 2` → §14 edge
  blocking. "w/ Wall > 2ft" (`SideHas2ftWall`) has no money callers — persisted only.
- Web: `edges.ts` (`perimeterFromEdges` with `{enhancementWidthFt, corners}`,
  `cornerLengthFromEdges`, `availableCorners`, `resolveSectionZones`; `EdgeInput` gained
  `perimLengthFt / termLengthFt / arpLengthFt / hasTallWall`; `BidSectionInput.perimCorners`).
  The former web behaviour (Σ perimeter side lengths, manual corner length) is what edge-less /
  corner-less older bids still get. **Correction vs the earlier web port:** the perimeter length
  ignored the corner subtraction and corner length was a free number — both now legacy-exact.

### 16.2 Labor

- `BaseHours = RoofSystem.RoofSectionLaborHours(this)`; `AdjustedBaseHours = BaseHours ×
  (1 + AdjustLabor/100)`; `RoofSections.ManHours = Σ present sections' AdjustedBaseHours`.
  The estimate-level "Adjust Labor" (`RoofSections.AdjustLabor(a, b, c)`) writes EVERY section's
  AdjustLabor / AdjustUnderlaymentLabor / TO_Additional; the section's Labor link edits one.
  Web: `BidSectionInput.adjustLaborPct` (override; bid-level remains the default), composed with
  the labor template exactly like the bid-level value; `RoofSection.adjustLaborPct` on the engine
  side.
- Roof System / Attached With / Attached To are SECTION properties (Home > Defaults only seeds
  new sections). Web: `roofSystem / attachment / membraneAdhesiveName` overrides on the section;
  `resolveSectionSystem` resolves them; a section whose combo differs from the bid's carries its
  own `laborTables` into the engine (`resolveSectionRates` uses them). Membrane pricing, the
  tab-tier decision, sheet multipliers and the §2.4 membrane-adhesive grouping all follow the
  section's system. Parapets / accessories keep the bid-level system (unchanged).
- Complexity: `MechFieldLaborRate` / `AdheredFieldLaborRate` / perim rates multiply
  `SheetSize.SmartSheetMulti` AND `ComplexityFactor.SmartValue`. `RSComplexityFactor` rows exist
  only for RoofSystemID 3 (Duro-Tuff) and 5 (Duro-Fleece): ComplexityID 0..5 = Open 0.9, Minor
  0.98, Moderate 1, Medium 1.2, Heavy 2.4, Extreme 4; other systems list a single "None" = 1.0.
  `LoadComplexityFactors` defaults to index 2 (Moderate). `set_SheetSize` (durolast/durobond/
  duroroof) resets the factor to "None" when a non-roll sheet is chosen, and `UpdatePreview`
  enables the Complexity combo only while `SmartSheetMulti == 1.0` (the sheet combo is disabled
  then) — so the factor only ever applies with a ×1.0 sheet. Web: `RS_COMPLEXITY_FACTORS`,
  `sectionComplexityFactor(rsId, complexity, sheetSizeMulti)`; the screen mirrors the mutual
  enable. **Correction:** the web engine hardcoded `complexity: 1`.
- `TearOffBaseLabor = W × L × lookup(col 3 if > 0 else col 2) × SheetSize.SmartSheetMulti ×
  ComplexityFactor.SmartValue`, Round 3, then × (1 + TO_Additional/100). Web now passes
  `tearOffSheetComplexityMulti = sheetSizeMulti × complexity` (was omitted — ×1 for the seeded
  Duro-Last "1500 sf" default, so existing hand-checked bids are unchanged).

### 16.3 Sheet size, Quick Bid, validation

- Quick Bid (default) vs "Enter D/L Roof Sheets": `optComplex_Click` warns "When entering
  individual D/L roof sheets no automatic calculation is performed for necessary waste or
  overlap…"; `optQuick_CheckedChanged` clears + hides the perimeter checkboxes / perim lengths /
  tall-wall boxes and disables the sheet combo. Non-quick `get_SheetSize` derives the sheet from
  `Ceiling(W × L)` vs each `SheetSize.Rolls × 100` in list order (last size exceeded → next size
  up, or the largest; exact match → that size; else the first). `txtLength_Leave` on a non-quick
  section > 3000 sf shows "Durolast does not manufacture sheets with a square footage greater
  than 3,000 s.f." and resets the dim to 1 — the web shows the message and does NOT reset.
  `ref_SheetSizes`: RollGood 4 (Rolls 1), 500 sf 2.4 (5), 1000 sf 1.2 (10), 1500 sf 1 (15),
  2000 sf .98 (20), 2500 sf .9 (25), 3000 sf .82 (30) — the label number = Rolls × 100, which is
  what `sheetSizeSqFt` parses. Web: `derivedSheetSizeLabel`, `resolveSectionSheetLabel`,
  `BidSectionInput.isQuickBid`.
- "Standard Size Sheet Discount" on the form mirrors `Estimate.StdSizeDiscount` (bid-level).
- `VerifyFields` (all transcribed as non-blocking hints on the web screen): Width / Length ≤ 0;
  Sheet Size; Need Custom Settings; Deck Type; durolast: "Perim Enhancement is greater than Roof
  Dimension" when `Width < (perimA + perimC) × W` or `Length < (perimB + perimD) × W`;
  Incompatible Decktype; Lap Spacing; durolastmech: "Pull Test is < 140"; sheet larger than the
  section ("Are you sure…"); Incompatible Underlayment; Undefined Attachment Method; per
  perimeter side: W ≤ 0 → "< 0", non-durotuff & non-durobondmech W < 12 → "< 12", durotuff W < 5
  → "< 5"; ARP / Wood / Termination side lengths > 0 (ARP ≤ side length); Perimeter side
  length > 0 and ≤ side length. ⚠ The web default enhancement width is 3 ft (pre-series
  choice); with a perimeter side marked, the legacy rule flags anything < 12 ft on Duro-Last —
  left as a visible hint, default unchanged (needs a human call on the intended default).
- Perimeter calculator (frmPerimCalculator): `W = Round(Ceiling(min(0.4 × building height,
  0.1 × lesser roof dimension)))`, floor 5 → `perimeterEnhancementCalculator`.
- `UpdatePreview` captions: "A: n'" + ", <termination>" + ", n Blocking" + ", ARP: n"" per side,
  "n' Perim" along perimeter sides, "No Membrane" when no system; 2500–3000 sf sheet warning
  ("Any sheets ordered between 2500 and 3000 square feet have length and width limitations…").
- Screen: `src/components/sections-screen.tsx` (Custom Name, L/W, Deck, Roof System, Attached
  With, adhesive, Type, Color, Pull Test + calc'd spacing, Design Table, Field Tab Spacing,
  Fastener OC, Avg Sheet / Complexity mutual enable, Std Size Sheet Discount, Quick Bid radios,
  Perimeter & Enhancement dialog with the calculator, Labor dialog, Setup / Inspection readouts,
  Man Hours / Labor Cost / sq ft; Edge Options tabs A–D; preview with corner boxes; lvSummary
  Section | L | W | System | Attach | Deck Type | Color | Lap; Roof Sections Summary dialog with
  the LoadSummary columns; New / Copy / Remove; Show Calculations; Notes).

## 17. Home screen (Setup step) — parity + wiring (IL-exact, 2026-09-10)

Read in-session: `frmHome` (Estimator.exe) `InitializeComponent` captions, `LoadEstimate`
0x59130, `btnStart_Click`, `btnUpdate_Click` (+ `frmUpdateBidOptions`), `cbWarranty_SelectedIndex
Changed` 0x59d9c, `cbMaxWind_SelectedIndexChanged`, `cboBuildingType/cboStatus_SelectionChange
Committed`, `chkTaxExempt/chkTaxMode/txtSalesTax` handlers, `txtCommission_Validating`,
`btnLbrMarkup_Click` (+ `frmLaborTemplate` captions), `cboTemplate_SelectedIndexChanged` /
`updateTemplate`, `TestForEnhancement` 0x58b38, `LoadDefaultUnderlaymentAttachment`,
`llbCopyClient_LinkClicked`, `txtEstimateTitle_LostFocus`, `Button1_Click` (apply to existing
sections → `RoofSections.OverwriteWithDefault` 0x5032c + `frmRSComparison`), `Button1_Click_1`
(apply to existing parapets), `cbParapetWallType_SelectedIndexChanged`, `txtCompany_TextChnaged`;
`frmEditClient` / `frmMembTypeSelect` captions; DataAccess `Estimate` setters, `Warranty` members;
seeded `Warranty` + `WarrantyHighWind` rows.

### 17.1 Layout (frmHome)

Left "Setup" panel, TabControl **Bid Info | Client | Job Site**:
- Bid Info: **1. General Info** — Customer Name (`txtCompany` ↔ `Estimate.ClientName`, the SAME
  field the Client tab's "Company Name" edits), Job Name (`Estimate.Title`; blank → "Bid Title
  cannot be left blank." and the old title is restored), Estimator's Name, Date Created
  (`calStartDate` "MMM dd, yyyy" ↔ `Estimate.StartDate`, editable), Status (`EstimateStatus`),
  Building Type (`BuildingType`: Commercial / Residential). **2. Labor && Markup Setup** —
  "Labor: $X per hour" and "Markup: $X per day" (mode 1) / "X%" (mode 0) / "X% (Gross)" (mode 2);
  "Click here to edit" opens `frmLaborTemplate` ("Edit Markup & Labor": copy-from options list,
  Hourly Labor, Hours per Man Day, Man-Day Labor, Markup radios Percentage of Total Costs /
  Dollars per Man Day / Gross Profit Percentage, Include prior to Markup: Commission / Per Diem,
  Hours or Man Days). **3. Labor Template** (`cboTemplate` + description; on an existing bid:
  "Are you sure you want to change your labor template? This will override all manually entered
  labor settings." — `updateTemplate` then WRITES the template's modifiers into every section /
  parapet / curb / drain / pipe stack / term bar / fascia / 2-pc / generic edge AdjustLabor and
  the estimate's AdjustSetupLabor / AdjustInspectionTime). **4. Estimator Commission** (Commission
  Rate, "##0.0#"). **5. Tax Exempt** — checkbox + Sales Tax % (`Estimate.SalesTax` stored as a
  fraction, shown ×100 "#0.00##") + "Only Tax Material" (`TaxMaterialOnly`): checking exempt sets
  SalesTax 0 and disables both; unchecking restores `Settings.SalesTax` / `TaxOnlyMaterial`.
  **6. Notes** (`Description`).
- Client: Company Name, Contact Person, Address 1, Address 2, City St, Zip, Phone x Ext, Fax,
  E-Mail (ClientName / ClientContact / ClientAddress1-2 / ClientCity / ClientState / ClientZip /
  ClientPhone / ClientExtension / ClientFax / ClientEmail); "Edit Client Information" opens the
  `frmEditClient` client list (Company Profile / "Company is a Client").
- Job Site: "Copy Client Address" (Address 1/2, City, State, Zip), Address 1, Address 2, City St,
  Zip, Job #, Ship Via, Ship To.

Right "Defaults" panel: Manufacturer combo, "Update Pricing && Labor" (`frmUpdateBidOptions`:
Update Material Pricing & Unit Labor, Update Labor Template, Update Non-DL Labor/Unit,
Labor Rate, Price/Unit to Management Defaults, Reset Underlayment Price Quotes, Upgrade
DuroLast Mechanical Labor to v4.0, Upgrade to Latest Formulas), **1. Deck Type**, **2. Wall
Type** (Wood or Metal → `Parapet.WallType` 1 / Brick or Concrete → 4), **3. Roof Sections
Material** (Roof System, Attached With [28"/60"/120" Tab Mechanically Fastened, (No Tab)
Induction Weld, (No Tab) Fully Adhered, Duro-Grip ×4], Attached To, Type, Color, Design Table
(psf), "Perimeter && Enhancement" link, `lblEnhancement` "<- Enhancement Necessary" (red) when
`UniversalFastenerSpacing` fails for the default section / "<- Using Custom Enhancement"
(green), "Apply To Existing Roof Sections"), **4. Underlayment Attached With** (None /
durolastmech / adhered systems allowed under insulations; "(will not apply to existing
underlayment)"), **5. Parapets Material** (Roof System [Duro-Last / Duro-Last Fleece-Back /
Duro-Roof], Attached With, Type, Color, "Apply to Existing Parapets"), **6. Select Type of
Warranty** (`cbWarranty` + "Max Expected Wind" `cbMaxWind`: 55-72 / 73-80 / 81-90 / 91-100 /
101-110 / 111-120 mph → `MaxWindExpected` 72…120, enabled only while `Warranty.IsHighWind`),
"Start!" (→ the first estimate step). An "Existing Bids:" list + "Reports" sit on the Home form
too (the web's bids page / proposal).

### 17.2 Semantics that changed on the web

- **Warranty high wind**: legacy `Warranty` rows carry `IsHighWind` and `WarrantyTerm`; the
  `WarrantyHighWind` upcharge keys on (WarrantyLength, MaxWindExpected). The web had an
  independent "High wind" toggle + term picker. Now `warranties` carries `req_thickness /
  is_high_wind / term_years` (migration `20260910120000_warranty_legacy_flags.sql`, values from
  the legacy seed by name), `effectiveHighWind` derives the flag + term from the warranty and
  the band from `maxWindExpected`; older snapshots without the flags keep the saved fields.
  ⚠ The live `high_wind_upcharges` 20-yr rows (0.09/0.11/0.13/0.15/0.17 mech) differ from the
  legacy seed (0.07/0.9[sic]/0.11/0.13/0.15) — left as captured (not a code matter).
- **ReqThickness** (`frmMembTypeSelect`, "Use These Thicknesses"): the web lists the sections
  thinner than the warranty's requirement and bumps them on request (legacy also cascades to
  parapets — parapets on the web inherit the section/bid thickness unless overridden).
- **Per-bid sales tax**: `SavedBidState.salesTaxRate / taxMaterialOnly` (absent = company
  settings) → `BidInput` → the money chain; Tax Exempt zeroes the rate exactly like the legacy
  handler and un-exempting returns to the settings.
- **Apply To Existing Roof Sections** applies the legacy set (Roof System + attachment systems,
  Design Table, Membrane Type, Color) — NOT deck type or sheet size (the previous web button
  applied deck/thickness/color/sheet). Legacy additionally skips sections whose deck is
  incompatible or whose fastener spacing lookup fails and shows a before/after comparison
  (`frmRSComparison`); the web applies unconditionally after the same confirmation text.
- **Defaults persisted**: `sectionDefaults.designTable`, `parapetDefaults` (Roof System /
  Attached With / adhesive / Type / Color / Wall Type → new parapets; "Apply to Existing
  Parapets" — parapets may run a DIFFERENT membrane than the roof sections, as the legacy "5.
  Parapets Material" group allows; the Setup fields were read-only until 2026-09-18), `underlaymentAttachmentDefault` (seeds the
  Underlayment step's attachment picker), `buildingType`, `startDate`, `maxWindExpected`;
  client/job-site fields split into the legacy parts (`clientAddress2 / clientCity / clientState /
  clientZip / phoneExt / fax / projectAddress2 / jobCity / jobState / jobZip / shipTo`), with
  the combined `jobCityStZip` line the proposal prints kept in sync.
- **Labor template change warning** ported (existing bids only); the web keeps composing
  template factors at compute time instead of overwriting every item's AdjustLabor.
- Not carried: the client list (`frmEditClient`), Manufacturer switching (Duro-Last only), the
  per-option "Update Pricing & Labor" sub-choices (the web replaces the whole frozen snapshot),
  Reports.

## 18. Underlayment labor — the complete legacy money path (IL-exact, 2026-09-10)

Re-read in-session: `RoofSection.UnderlaymentCost` 0x4bcc4, `UnderlaymentBaseHours` 0x4c284 (+
0x4c718 overload), `UnderlaymentQuoteHours` 0x4cba8, `UnderlaymentAdjustedBaseHours` 0x4cd48,
`UnderlaymentLayerFieldFasteners` 0x4d23c, `RoofSections.UnderlaymentLaborHours` 0x4fed8,
`RoofSystem.get_AdhesiveLaborRate` 0xa274, `SheetSize.get_SmartSheetMulti` 0xad268,
`ReviewCalc.Recalculate` (slots), `frmUnderlayment` handlers (`llbItemLabor_LinkClicked`,
`UpdateTotals`, `LoadAttachment`).

### 18.1 The formula (per section, per priced layer; quote layers excluded)

```
base = Σ_layers [ AreaTotal / 2500 × LayoutTime
                + mechanical: SingleFastenerTimeByDT(deck) × UnderlaymentFasteners(layer)
                + adhered:    (AreaField × L + AreaPerimeter × L) / 2500
                              L = RSAdhesiveCoverage.UnderlaymentAdhesiveLabor[group of the layer
                                  below]  (bottom layer: DeckTypesAdhesiveLabor[deck])
                + none:       nothing more ]
base ×= ComplexityFactor.SmartValue × SheetSize.SmartSheetMulti(section)
UnderlaymentAdjustedBaseHours = base × (1 + AdjustUnderlaymentLabor / 100)
RoofSections.UnderlaymentLaborHours = Σ AdjustedBaseHours + Σ UnderlaymentQuoteHours (unadjusted)
```
`UnderlaymentFasteners(layer)` = the §10.3 field + perimeter rules: membrane mechanical → slip
sheets (SubType 1) `Round(Ceil(area × 0.08))`, custom densities `Round(d × area)` (+ corner),
4'×4' tiles (SubType 7/8) `Round(area/16) × 4`, else `Round(area/32) × 5`, the perimeter run on
AreaPerimeter alone; membrane adhered / Duro-Bond → field `Round(AreaField/32) × 10` (4'×4':
`/16 × 5`), perimeter `Round((AreaPerimeter + AreaCorner)/32) × 16` (4'×4': `/16 × 8`). The
bare "Attached With = None" option bills layout only. ReviewCalc: `dMaterial[5+tile]` (tile 1…8
→ slots 6…13) = `RoofSections.UnderlaymentCost(tile)`, `dLabor[5+tile]` = crew-rate labor of
`UnderlaymentLaborHours(tile)`; `dTotals[6]` = MaterialTotalUnderlayment. Material (§6) is
unchanged: area × 1.06 × $/sqft (Geotextile 1.03), quotes verbatim once per CustomQuoteID.

### 18.2 Web corrections (2026-09-10)

1. **Adhesive labor** was `area × labor / 1000` on the total area; now `(AreaField +
   AreaPerimeter) × labor / 2500` (`underlaymentAdhesive` takes `laborPer2500SqFt`). With the
   captured 6.5 h figure this removes a 2.5× over-bill on every adhered layer.
2. **Complexity × sheet multiplier** now scale each section's underlayment base hours
   (`uScale` in the builder loop) — previously not applied.
3. **Fastener counts** follow the legacy rule (`underlaymentLayerFasteners`, module
   `underlayment-fasteners.ts`) instead of a user-picked fasteners-per-board; the same rule now
   feeds the Accessories fastener needs, the consumption/needed-quantities module and the
   ordering summary. `UnderlaymentLayer.fastenersPerBoard` is retained for older saved bids but
   no longer priced.
4. **Per-section AdjustUnderlaymentLabor** (`BidSectionInput.adjustUnderlaymentLaborPct`): the
   Underlayment step's "Adjustable Labor for selected Roof Sections" link sets it on the
   selected sections; absent = the labor template's Underlayment Labor factor (the legacy
   template writes the same field).
5. **Quote labor is never adjusted** — the template factor / section adjust now scale priced
   layers only.
6. **Attached With "None"** is a valid layer attachment (layout labor only).
7. **Substrate derivation** (`deriveAdhesiveSubstrate`): the bottom layer uses the deck type
   (`ADHESIVE_SUBSTRATE_BY_LABOR_DECK`; Retrofit / Purlin have no adhesive row), higher layers use
   the board below's AdhesiveGroup name (`underlaymentGroups.adhesiveGroupNameById`, the legacy
   group description without its "N" prefix). The stored `substrate` is only a fallback for
   older bids / underivable combinations; the screen shows the derived "Attached To".
8. **Layout time** now bills for every priced layer regardless of attachment (legacy), and a
   missing layout row warns.

Units note: the captured "Fastening Times" figures (e.g. Wood 0.342) are treated as MINUTES per
fastener (÷ 60). The legacy IL multiplies its stored `SingleFastenerTimeByDT` value directly, so
its DB must hold the converted figure; the conversion point was not located in the IL —
assumption, consistent with the captured admin display and with sane totals (≈2.2 h of
fastening per 2,500 sq ft on wood).

## 19. Parapets screen — labor band, per-wall system, template composition (IL-exact, 2026-09-10)

Sources: `frmParapets` (Estimator.exe: `LookupParapetTimes`, `Recalculate`, `VerifyFields`,
`ResetFields`, `ShowMembraneOptions`, `CopySettingsFromRoofSection`), `Parapet.BaseManHours` /
`Parapet.ManHours` / `Parapet.WallAdhesive` / `Parapet.EdgeFasteners` (DataAccess.dll) and the
default-parapet XML in `BidAdvantage.DataAccess.SqlScript.xml`. Builds on §8.5–§8.7.

### 19.1 The legacy rules

1. **Labor band is DERIVED from Vertical**, never picked. `LookupParapetTimes(vertical)` walks
   the ParapetTimes rows and returns the one whose range contains the raw double: breaks at
   31 / 49 / 73 / 100 (`0"-30"`, `31"-48"`, `49"-72"`, `73"-99"`, `100"+`). A fractional
   height between two integer bands (30.5") stays in the lower band.
2. **Labor key** (`Parapet.BaseManHours`): mechanical attachment keys
   `[WallType, DeckType, HasCant, band]`; every other attachment keys WallType = 4 (pre-drill
   column). Hours = `value / 50 × AdjustedLength` (+ `Poly / 100 × 0.25` when Use Slipsheet),
   AdjustedLength = Length + 1 + Pieces.
3. **ManHours = BaseManHours × (1 + AdjustLabor / 100)**. The labor template writes the SAME
   `AdjustLabor` field on the parapet when applied, so a wall's own "N MHS (x%)" link value
   REPLACES the template factor — they never multiply.
4. **Per-wall Membrane Options**: each parapet carries its own RoofSystem / Attachment /
   membrane adhesive / mil / color (`ShowMembraneOptions`), seeded from the bid defaults;
   "Copy Settings from Roof Section" copies a section's system, attachment, mil and color.
   The wall's attachment drives (a) the pre-drill column above, (b) `Parapet.WallAdhesive` —
   only walls whose OWN attachment is adhered bill wall adhesive, grouped by the wall's
   (roof system, adhesive), basis Length × (Vertical + WallTop) / 12 ÷ wall coverage — and
   (c) `Parapet.EdgeFasteners` tab count (mechanical vs adhered tab model).
5. **Recalculate tab model** (screen "Height after tabs" readout only — no price term):
   `Round6Inch(Vertical)`; mechanical: 25 above 30", +28 above 59" (else +23 above 53"),
   +28 above 89" (else +23 above 83"); adhered: one 60" tab above 59"; Duro-Bond: none.
   `RemainingHeight = max(0, Vertical − Σ tabs)`.
6. **ResetFields defaults**: Length 1, Pieces 1, Skirt 6", Cant / Vertical / Top / Drop 0,
   flags off. `VerifyFields` requires Vertical, Length and Pieces > 0 before a wall saves.
7. **Wall styles toolstrip** (four icons: Vertical, Canted Vertical, Up & Over, Canted Up &
   Over) only enables / clears the Skirt / Cant / Top / Drop inputs; the dims themselves are
   what price. HasCant = Cant > 0. Not ported (see §19.3).

### 19.2 Web corrections (2026-09-10)

1. `parapetBandForVertical(bands, verticalIn)` (adapters) + `parapetLaborBand(p, bands)`
   (bid-builder): the band derives from `verticalInches` whenever a wall has profile dims;
   walls saved without dims keep their stored `heightBand`. The screen shows the derived band
   read-only.
2. `ParapetInput` gains `roofSystem?`, `attachment?`, `membraneAdhesiveName?`,
   `blockingLengthFt?`, `notes?`; `resolveParapetSystem(bid, p)` resolves the wall's system
   (bid defaults when unset). The labor loop, Duro-Tuff panel rule, pre-drill flag, wall
   adhesive grouping and the Accessories `parapetEdgeFastenersCount` all use the per-wall
   system now (previously the bid's).
3. Wall adhesive was billed for EVERY wall when the bid was adhered; now only walls whose own
   attachment is adhered (an adhered wall on a mechanical bid also bills — the bid needs no
   adhered section for the wall's adhesive combo to be examined).
4. `adjustLaborPct` on a parapet is the only adjust applied (the template's value is written
   INTO that field on selection — §20.3 replaced the compute-time template factors everywhere,
   curbs included).
5. `ReviewBreakdown.parapetHoursById` / `parapetBaseHoursById` feed the screen's labor link
   and the frmLaborPopUp dialog (Adjust % ⇄ Change Hours, "Use template default" clears the
   override).
6. `parapetRemainingHeightIn(p, roofSystem, attachment)` (accessories) implements the
   Recalculate tab model for the "Height after tabs" readout.
7. New-wall defaults follow ResetFields (Length 1, Pieces 1, Skirt 6", other dims 0); the
   Setup "Wall Type" default still seeds `wallType` (web default 1 = Wood or Metal; the legacy
   default XML carries 4 = Brick or Concrete — see §8.6, open question).
8. `src/components/parapets-screen.tsx` replaces the inline step: Deck / Wall Type / Length /
   Pieces, the profile dims with girth and derived band, Height after tabs, Use Slipsheet,
   Term Bar Base, Termination (+ wood blocking length) / Capstones / ARP tabs, Membrane
   Options expander, Copy Settings from Roof Section, Fasteners Needed, Notes, VerifyFields
   hints and the lvSummary (Style | Color | # | Skirt | Cant | Vert | Top | Drop | Length |
   Termination | Wood | Caps | ARP) with Vertical / Total / Parapet Membrane Sq Ft totals.

### 19.3 Not ported

- The wall-style toolstrip (§19.1 item 7). The web screen leaves all five dims editable; a
  style picker would only gray out / zero the dims a style excludes. No money impact.

## 20. Labor audit — install labor basis, adhered labor, templates (IL-exact, 2026-09-14)

Full pass over every labor term against the IL and the admin → engine data path. Sources:
`RoofSystem.MechField/MechPerim/AdheredField/AdheredPerimLaborRate` (DataAccess rva 0xa5d4 /
0xa810 / 0xa790 / 0xae7c), `DuroLastSystem.MechFieldLaborRate` (0xc4c4), every
`*System.RoofSectionLaborHours_4_0_230`, `RoofSection.get_MaterialTotalField/Perim/Corner`,
`RoofSections.get_BaseSetupTime / get_BaseInspectionTime / get_TearOffLabor`,
`cMechanicalSystem.get_SmartOnCenterMultiplier / get_SmartTabSpacingMultiplier`
(DescendingIntegerComparer), `Template.*`, `frmHome.updateTemplate` (Estimator rva 0x5a394),
`frmLaborTemplate.btnSave_Click`, the RoofSection / Parapet / Curb / Estimate constructors, the
accessory `*.BaseManHours / ManHours` family, and the installer's seeded MechOnCenterMulti /
MechTabMulti / SSMechMulti / SSAdheredMulti / RSRollGoodWidth / AdhesiveCoverage / RSMembraneType
tables.

### 20.1 Section install labor — corrections

1. **Labor AREA basis.** `RoofSectionLaborHours_4_0_230` (every system) bills
   `MaterialTotalField × fieldRate + MaterialTotalPerim × perimRate + MaterialTotalCorner ×
   cornerRate`, then × `MembraneType.Labor` (thickness factor), floored at 0.
   `MaterialTotalX = (AreaX / AreaTotal) × MembraneWithOverlap` — the zone SHARE of the
   membrane quantity, not the raw takeoff area. (A running negative carry exists but only fires
   when a share is negative.) The web billed raw `L×W − zones`; it now passes share ×
   MembraneWithOverlap (`laborArea` in the builder). For the 50×50 fixture that is ×2601/2500.
2. **Adhered install labor was 0.** `AdheredFieldLaborRate = GetAdhesiveBaseHours(adhesive)
   .SmartValue / 1000 × (SheetSize.Layout == rollgood ? RollGoodWidthAdhesiveMulti(FieldLap) :
   SheetSize.SmartSheetMulti) × ComplexityFactor`; perimeter/corner the same with a ×1.2 bump
   ONLY when the adhesive ShortName is "durogrip" and its PerimeterSpacing ≠ -1. The base hours
   are `AdhesiveCoverage.DefaultLabor` (hours per 1,000 sq ft: Water Based 5.215, Solvent Based
   6.95, Duro-Grip 5.8408 …) — captured in each adhered `rdl_combos` row under
   `adhesive.base_hours_per_1000_sqft_by_substrate` but never read. `buildLaborTables` now
   exposes `adhesiveBaseHoursByName`; the builder resolves the section's adhesive, the roll-good
   width multiplier (new table `rdl_roll_good_width`, seeded verbatim from RSRollGoodWidth:
   Duro-Last 64"→1; Duro-Tuff 30"→2.6, 60"→1.3, 120"→1; Duro-Roof 64"→1; Duro-Fleece 60"→1.3,
   120"→1) and the durogrip flag (`legacy_adhesive.short_name / perim_spacing_in`). A missing
   adhesive row → 0 h WITH a warning; a missing roll width → ×1 with a warning (legacy would
   throw on a Nothing lookup); a blank adhered sheet cell (the captured combo leaves 1500 sf+
   empty; legacy returns -1 there, zeroing the hours) → ×1 with the roll-goods path.
3. **Perimeter / corner tab multiplier.** `MechPerimLaborRate` keys `CustomPerimeterLap ≠ -1 ?
   CustomPerimeterLap : PerimeterLap` (corner: `CustomCornerLap ≠ -1 ? … : PerimeterLap`), and
   `RoofSection.PerimeterLap` (`_perimTabSizeOrRollWidth`) has NO writer anywhere in the two
   assemblies — it is always 0. The descending tab walk then returns its LAST entry (smallest
   tab: Duro-Last 28" → 1.5125) for every perimeter / corner zone without a custom lap. The web
   keyed the field lap (60" → ×1.0, under-billing perimeter labor ×1.5125). Ported verbatim:
   the section's Advanced perim/corner lap when set, else 0.
4. **On-center multiplier fallback.** The `SmartOnCenterMultiplier` walk has no catch-all: a
   spacing below every key leaves the initial 1.0 (the TAB walk is the one that returns the last
   entry). `onCenterLookup` (labor.ts) replaces `bandLookup` for OC; only matters for OC < 6".
5. **Confirmed matching** (no change): 10 × deck × tab × oc / 2500 × sheet × complexity; field
   uses SmartDeckTypeMultiplier, perim/corner the DEFAULT deck column; DescendingIntegerComparer
   on both multiplier lists; thickness factor once per section; tear-off `W×L×lookup ×
   SheetMulti × Complexity`, Round 3, ×(1+TO_Additional/100), bid Ceiling-to-cent; setup band
   walk (mode-1 = Ceiling(sqft) × value, Minimum floor, top band above the table); inspection
   flat bands; parapet / curb / underlayment (§18/§19/§8.2); accessory BaseManHours (stacks
   `qty × (open ? 1.25 : 1) × usage × size factor`, drains `Round(qty × (cleanup + boot | reinstall), 2)`,
   per-item `× (1 + AdjustLabor/100)`); metals / non-DL own-rate; labor rate from the Markup &
   Labor Options preset (`MLOptions.LaborRate` → `markup_options.hourly_rate`).

### 20.2 Open items — status after the admin-screenshot check (2026-09-14)

- **`lookup_Decktimes` — RESOLVED, inactive.** `DuroLastSystem.MechFieldLaborRate` calls
  `oLookupDecktimes.DataTableLookup(4, [tab == 64 ? 60 : tab, deckId, snappedOC])` and
  multiplies only when the result ≠ -1. `LookupTable.get_DataTableLookup(col, keys)` (rva
  0xabc60) matches the leading key columns and returns COLUMN `col` — column 4 of
  `lookup_Decktimes(TabSpacing, DeckType, FastenerSpacing, Value, CustomValue)` is
  **CustomValue**, which the installer sets to -1 on every row (`UPDATE lookup_Decktimes SET
  CustomValue = -1`, release 2.1), and BAManager has no editor for it (its Roof Deck Labor
  screen, capture 110935, shows the product 10 × deck × tab × spacing — e.g. Wood 24" = 13.76 —
  with no deck-times grid). The factor never fires; the web's ×1 is exact.
- **Setup band modes — RESOLVED.** The Setup Times admin screen (capture 110813) offers only
  Square Feet / Multiplier rows (Hour = sqft × multiplier shown read-only) over a Minimum of 16:
  6000 / 20000 / 100000 × 0.003 — every band is the multiply mode, matching the seed.
- **Tear-off scale — RESOLVED by the screen's own caption.** The Tearoff Times tab states
  "Custom values entered in Hours per 100 sqft"; the seeded grid is that grid, so ÷100 gives the
  hours the screen defines.
- **Labor template values — legacy help text vs runtime.** The Labor Templates admin screen
  (capture 110851) says "100 = Standard/Baseline, 95 = 5% decrease, 108 = 8% increase", but the
  shipped Standard template stores 0 in every row and the runtime writes the stored number
  straight into AdjustLabor (`DBLoadLookupTables` → `DACommon.toSingle`, no rescale; ManHours =
  Base × (1 + AdjustLabor/100)). A user following that help text and entering 108 would get
  +108% in the legacy estimator. The web follows the runtime (percent adjustment, 0 = none) and
  says so on its admin page.
- **Membrane quantity — PORTED (§21).** `MembraneWithOverlap = RoofSystem.CalculateMembraneQty`: `Rolls == 1` →
  `RollGoodsMembraneCalc`, `Rolls > 1` → `SheetsMembraneCalc`, else `AreaWithEdgeOverlap`. The
  seeded sheet sizes carry Rolls 1 (Roll Good) / 5…25 (sheets), so legacy uses the roll or sheet
  geometry, not `(L+1)(W+1)`. The web bills `(L+1)(W+1)` for material AND (now) labor; the two
  geometry ports remain open (quantities.ts `rollGoodsMembraneQty` is drafted but unwired).
- **`SSAdheredMulti` keyed per ADHESIVE — PORTED (§21)**: `rdl_adhered_sheet_multi` seeded
  from the installer; the combo column stays the fallback.
- **Hours per man-day — PORTED (§21)**: per-estimate field on the Labor & Markup dialog.

### 20.3 Labor templates — the legacy model (replaces the compute-time factors)

- A `Template` holds PERCENT ADJUSTMENTS (0 = none, 10 = +10%). `frmHome.updateTemplate`
  writes them straight into each item's AdjustLabor: `Estimate.AdjustSetupLabor ←
  SetUpTimeLabor`, `AdjustInspectionTime ← InspectionTimeLabor`; every RoofSection ←
  `RoofSectionLabor` / `UnderlaymentLabor` / `TO_Additional ← Convert.ToInt32(TearOffLabor)`;
  every Parapet ← **`RoofSectionLabor`** (the IL calls `get_RoofSectionLabor` in the parapet
  loop — a legacy quirk, ported; only the Parapet CTOR seeds `ParapetsLabor`); every Curb ←
  `CurbsLabor`; Drains / PipeStacks / TermBars / edges … ← their areas. New items seed from the
  estimate's current template (constructors); a new estimate starts on the default template
  (`oRefTemplates`).
- Web: `labor-template.ts` (`laborTemplateDeltas`, `applyLaborTemplate`, `seed*Adjust`) does
  exactly that on the Setup step / Labor & Markup dialog (with the legacy "override all manually
  entered labor settings" confirm on an existing bid), new bids apply the admin default template,
  new sections / parapets / curbs seed from it, and the engine reads ONLY the item fields
  (`bid.laborTemplateName` is informational). The earlier web model (value/100 factor, 0 ≡ 100,
  composed multiplicatively with the item adjusts) was wrong on both counts: a stored 10 meant
  ×0.1, and template × adjust compounding never existed in legacy. `laborTemplateFactor` now
  returns 1 + value/100. Areas the web template stores but legacy has no single field for
  (corners / strainers / vents / washers / walk pads) are left untouched.

## 21. Membrane quantity, per-adhesive sheet multipliers, hours per man-day (IL-exact, 2026-09-14)

### 21.1 MembraneWithOverlap = `RoofSystem.CalculateMembraneQty`

Dispatch (DuroLastSystem rva 0xd370, DuroRoofSystem 0xde78, DuroBondSystem 0xbd24,
DuroFleeceSystem 0xc123): `SheetSize.Rolls == 1` → `RollGoodsMembraneCalc`; `Rolls > 1` →
`SheetsMembraneCalc`; else `AreaWithEdgeOverlap`. Duro-Fleece is always roll goods; Duro-Bond has
no roll-goods branch (sheets or area). `Rolls` is RSSheetSize.Rolls: "Roll Good" 1, "N sf" N/100
(`sheetRollsFromLabel`). Duro-Tuff has its own roll layout — §21.4.

- **`RollGoodsMembraneCalc`** (DuroLastFunctions rva 0xa4b28):
  `rows = CustomPerimeterLap(0) > 0 ? Round(Ceil(PerimEnhancementWidth / In2Ft(CustomPerimeterLap
  − OverlapWidth))) : 0`; `pw[i] = rows × In2Ft(CustomPerimeterLap − OverlapWidth) ×
  SideIsPerim(i)`; `overlapLength = Ceil(((W+1) − pw[2] − pw[0]) / lap × ((L+1) − pw[1] −
  pw[3]))` with `lap = ToInteger(CustomFieldLap > 0 ? CustomFieldLap : In2Ft(FieldLap))` — an
  INTEGER (28" → 2, 60"/64" → 5); result `AreaWithEdgeOverlap + overlapLength × In2Ft(OverlapWidth)`.
  The four "(PerimSideLength + 1) × rows" sums computed first are overwritten by the field term
  (stloc.3 at 0x22b) and survive only in the Show Calculations text — ported verbatim, so the
  perimeter rows only narrow the field run. Reproduces the §9 trace (1×1, 60" lap → 4.5).
- **`SheetsMembraneCalc_4_0_223`** (rva 0xa45e4): `n = NumSheetsReq`; `avgSheetSide =
  √(AreaWithEdgeOverlap / n)`; `numOverlaps = Round(Floor(2n − 2√n))`; result
  `AreaWithEdgeOverlap + numOverlaps × avgSheetSide` (the bare seam length; the × In2Ft(OverlapWidth)
  variant only appears in the printed percentage). `NumSheetsReq` (0xa453c): quick bid on sheets →
  `Ceil(AreaWithEdgeOverlap / (Rolls × 100))`; non-quick-bid → 1.
- `OverlapWidth` = RoofSystem.LapOver (installer: 6" all systems, Duro-Fleece 3") —
  `LEGACY_OVERLAP_WIDTH_IN`.
- Effect on the 50×50 "1500 sf" fixture: 2601 → 2601 + √1300.5 = 2637.06 sq ft (+1.4%) for
  material AND install labor (the §20.1 share basis); roll goods at 64" → 2861.5.

### 21.4 Duro-Tuff — `DuroTuffSystem.CalculateMembraneQty` (rva 0xdec0, ported verbatim)

`duroTuffMembraneCalc` (quantities.ts). Inputs: L, W, OverlapWidth 6", FieldLap (= the field
roll width), CustomFieldLap, the perimeter attachment ("durotuffmech" or not), UseCustomSettings,
NumCustomRows(0/1), CustomPerimeterLap / CustomCornerLap (0/1), per side SideIsPerim /
PerimSideLength / SideHas2ftWall, IsPerimCorner(0..3), MembraneType.DefaultRollLength (100 ft),
RoofSystem.RollGoodWidths (30 / 60 / 120).

1. **Setup.** Mechanical ("durotuffmech") and NOT UseCustomSettings → the routine WRITES
   `NumCustomRows = (1, 2)`, `CustomPerimeterLap(0) = CustomCornerLap(0) = 30`, and (1) =
   `FieldLap > 30 ? 60 : 30` onto the section ("BA set"); custom → the user's values. Any other
   attachment → rows (0, 0) and the plain `(L+1) × (W+1)` field.
2. **Expected outer widths** per perimeter side: `(lap0 − 6) × rows0 × (custom ? 1 :
   has2ftWall ? 0 : 1)`; if `In2Ft(outer[A] + outer[C]) > LENGTH` (A/C compared against Length,
   B/D against Width — verbatim) → `CustomFieldLap ← lap0`, rows (0, 0), all widths 0. **Inner
   widths**: `(lap1 − 6) × rows1`, overflow test on outer + inner → `CustomFieldLap ← lap1`,
   rows1 = 0.
3. **Outer run (ft)** into `lengths[lap0]`: Σ perimeter sides `(PerimSideLength + 1) × rows0 ×
   (custom ? 1 : has2ftWall ? 0 : 1)`; sides B/D also subtract `In2Ft(outer[adjacent side])` per
   marked adjacent corner (single width, not × rows); then `+ Floor(run / 100) × 0.5` butt joints.
   **Inner run** into `lengths[lap1]`: A/C `(PerimSideLength + 1) × rows1` minus `In2Ft(outer
   [adjacent])` per marked corner; B/D the same with `In2Ft(inner + outer [adjacent]) × rows1`;
   `+ Floor(run / 100) × 0.5`.
4. **Cash-out** `total = lengths[30] × 2.5 + lengths[60] × 5` (fixed keys), both reset.
5. **Side leftovers**: for each perimeter A/C (rows0 > 0) and B/D (rows1 > 0) the
   non-perimeter remainder `(L or W − PerimSideLength)` is filled across `outer + inner` inches
   with field strips: while `rem > fieldRollWidth − 6` → `lengths[fw] += run`, `rem −= fw − 6`;
   else `total += run × In2Ft(rem)`.
6. **Field**: `fieldLength = L − In2Ft(outer + inner)[B] − …[D] + 1`, `fieldWidth = W − …[A] −
   …[C] + 1`; fill `Ft2In(fieldWidth)` inches the same way; on the last strip `lengths[fw] +=
   Ceil(lengths[fw] / 100) × 0.5`, `total += lengths[fw] × In2Ft(fw) + fieldLength ×
   In2Ft(rem)`.
7. Return `total`. The written-back laps matter downstream: `MechPerimLaborRate` then keys the
   30" tab (×2.8 on Duro-Tuff) for perimeter / corner zones, and an overflow's CustomFieldLap
   re-keys the field tab. The builder passes them into the labor inputs (`laborPerimLap` /
   `laborCornerLap` / `laborFieldLap`).

Effect: a default 50×50 Duro-Tuff mechanical section at the 30" lap bills 3,254.75 sq ft (25 full
30" strips lapped 6" + a 12" remainder + butt joints) instead of 2,601 — the 30" roll waste is the
legacy figure. Web mapping: `UseCustomSettings` ≡ a custom perimeter lap on the section (one outer
row at that lap, no inner rows — the legacy Advanced form's separate inner row / width fields have
no web counterpart yet, flagged); 2 ft walls come from the edge "w/ Wall > 2ft" flag.

### 21.2 Adhered sheet multiplier per adhesive

`SheetSize.get_SmartSheetMulti` (rva 0xad268) reads `m_dAdheredSheetMulti[adhesive.ID]` for an
adhered field attachment (custom first if > 0), i.e. the SSAdheredMulti table keyed by sheet AND
adhesive. New table `rdl_adhered_sheet_multi` (roof_system_id, sheet_label, adhesive_id) seeded
verbatim from the installer (Duro-Last Roll Good 4 / 500 sf 2.4 / 1000 sf 1.2 for adhesives 1–2;
Duro-Tuff and Duro-Fleece Roll Good 1); `EngineAdminData.adheredSheetMulti` resolves it by
adhesive long name, falling back to the combo's column when no row exists.

### 21.3 Hours per man-day per estimate

`frmLaborTemplate.btnSave_Click` writes `Settings.HoursPerDay` (and UseManDays) for the open
estimate. `BidInput.hoursPerDay` / `SavedBidState.hoursPerDay` (absent = admin default) feed
man-days, the $/man-day markup mode, the Man-Day Labor readout and quote labor in days; the Labor &
Markup dialog's "Hours per Man Day" is now editable.

## 22. Non-labor pricing audit — every material / hardware dollar vs `ReviewCalc.Recalculate` (IL-exact, 2026-09-18)

Scope: every admin price and every non-labor dollar on every step, traced admin screen → table →
`getEngineAdminData` → adapter → engine → `computeMoney`, and the assembled totals re-read against
`ReviewCalc.Recalculate` (rva 0x4550c) instruction by instruction. Verdict per area (details in the
sub-sections): **WIRED-OK** — membrane price matrix (tiers, colours, Duro-Roof ×1.05, family
prices §1/§7), warranties + high-wind (`RoofSections.WarrantyTotalCost` 0x5018c), discounts
(prepay 5 % of M0, std-sheet 4 % of membrane at ≥ 50 000 sq ft, volume 5 % at > 100 000),
sales tax (both modes, exempt), freight (stepped / percent basis dMaterial[20]), markup modes
(`CalcMarkupValue` 0x46e18), per-diem / commission in and out of markup, parapet membrane +
ARP, curb wrap constants, metals, non-DL item money and routing, accessories (drip / gravel,
corners, pipe stacks, washers, drains, walk pads, sealants, fasteners, adhesives), underlayment
board material, quote layers, adhesive prices. **Corrected** — the items below.

### 22.1 Slip-Sheet underlayment is Duro-Last material (dMaterial[6] ⊂ dTotals[0])

`Recalculate` writes `dMaterial[5 + tile] = GoodSingle(RoofSections.UnderlaymentCost(tile))` for
tiles 1..8 (slots 6..13), then `dTotals[0] = GoodSingle(Σ dMaterial[0..6])` — the loop bound is
`ldc.i4.6 ble`, so **slot 6 = tile 1 = Slip Sheets** (Duro-Fold, Ultra-Fold, Duro-Blue, Geotextile,
Duro-Weave) is inside Duro-Last Material, the 5 % prepay base and the volume-discount base.
`dTotals[6] = GoodSingle(MaterialTotalUnderlayment(False))` (0x470e4) sums **dMaterial[7..13]**
only (tiles 2..8). Web: `slipSheetMaterial` (new on `BuildResult`) joins `duroLastMaterial`;
`materialUnderlayment` is tiles 2..8 (+ unmapped tile 0 + the manual seam). The Review ledger
keeps the Slip Sheets row with the insulation tiles (as the legacy screen does) and the
attribution tests move it across; the estimator's purchases panel and the proposal split it out
of the membrane line.

### 22.2 Per-slot GoodSingle (material)

Every `dMaterial` slot is stored `GoodSingle`'d — [1] MembraneCostBeforeDiscount, [2]
Parapets.TotalCost, [3] Curbs.TotalCost, [4] Accessories.TotalCost (edge terms, flashing,
fasteners, **adhesives** and the MembraneAccs ARP row are all inside it — `Accessories.
get_TotalCost` 0x10a8c), [5] Metals.MaterialCost, [6..13] per underlayment tile, [14..19] per
`ReviewCalc.NonDL` group — and the totals round again: `dTotals[0] = GoodSingle(Σ[0..6])`,
`dTotals[6] = GoodSingle(Σ[7..13])`, `dTotals[7] = GoodSingle(NonDL.MaterialCost)` (the RAW
six-group sum, 0xa915c). `dMaterial[20]` (tax / freight basis) = Σ of the rounded slots.
`dMaterial[22]` (freight) is GoodSingle'd in both modes before `dTotals[9] = GoodSingle(
dMaterial[22] + ExtraShipping)`. The web previously summed raw floats and rounded once; the
builder now rounds each slot (`goodSingle`), `computeMoney` rounds d[0]/d[6]/d[7], and
`shippingTotal` rounds the freight first. Penny-level, but it is where old Review sheets differ.

### 22.3 Labor rows, Single fields, per-diem, LaborSubtotal2

- `dLabor[k,0] = GoodSingle(CalcLaborCost(hours_k))` per row — roof sections (one row for all
  sections), parapets, curbs, accessories, EACH underlayment tile (6..13), setup, inspection,
  tear-off; own-rate rows `GoodSingle(Metals.LaborCost)` and `GoodSingle(NonDL(group))`;
  `LaborSubtotal1 = GoodSingle(Σ dLabor[0..21])`. `computeEstimate` now rounds per component
  (`underlaymentLaborHoursByTile` carries the tile split) instead of once on the summed hours.
- `dLabor[24 + k,0] = GoodSingle(item.MaterialCost + item.LaborCost)` per subs / services item,
  `LaborSubtotal2 = GoodSingle(Σ)`; the builder rounds per line, `computeEstimate` the total.
- `Estimate.Markup`, `Commission`, `SalesTax`, `PerDiem`, `ExtraShipping` are `Single`; the
  percents are divided by `100!` in single precision before widening (`ldc.r4 100; div;
  conv.r8`) — `money.ts` reproduces the float32 fractions (`pctSingle`), including mode 2's
  `1! − x/100!`.
- `dTotals[13]` adds the RAW `PerDiem × TotalManDays` when PerDiemInMarkup; only `dTotals[17]`
  is GoodSingle'd. Fixed.
- Non-DL flat catalog lines / frozen auto-rate rows with `Labor Rate 0` bill at the estimate
  crew rate (`NDLCollectionBase.ReadRefData` 0xa78cc) — the §14 module already did; the older
  paths now do too. Metals keep the raw rate (no fallback in `Gutter.get_LaborRate`).

### 22.4 LEGACY QUIRK — the non-DL "Others" group's labor never reaches Labor Subtotal 1

`Recalculate` fills `dLabor[14 + i]` for the six NonDL groups (i = 0..5 → 14..19; group 6 =
`NDLOthers`), then writes **Setup** labor to `dLabor[19]`, inspection to [20], tear-off to [21]
and sums [0..21]. Slot 19 is overwritten: the Others group's labor $ and hours are dropped from
LaborSubtotal1 and man-days in the shipped Bid-Advantage (an off-by-one; its own Review shows
Setup on that row). Reproduced behind `LEGACY_NDL_OTHERS_LABOR_DROPPED` (bid-builder) with a
warning whenever that labor is non-zero; the ledger's "Other" labor row shows 0. Flip the
constant to bill it. Others-group MATERIAL (dMaterial[19]) is unaffected.

### 22.5 Accessories corrections (IL re-read)

- `DACommon.RoundToNextTen` (0x41238): `n = Ceil(x); n + 10 − (n mod 10)` unless x is an exact
  multiple of ten — 9.27 → 20, 19.57 → 30 (the first transcription gave 10 / 20). Affects term
  bars, fascia bars (bar and per-colour lengths), strip mastic, two-piece metals; drip / gravel
  (`R10(Ceil(...))`, integer input) were already right.
- Curb termination footage: `TermBar/FaciaBar.GetCurbEdgeLength` accumulate `Convert.ToInt32(
  Round((2A + 2B + 12)/12 × qty, 4))` into an INTEGER field — whole feet per curb.
- `FaciaBar.GetTotalLengthByColor` (0x16f80) = `R10(1.03f × (roof_c + curb_c + parapet_c [+ both
  Additional boxes on White]))` — the vinyl / metal cover prefill basis is the ten-rounded,
  scrapped colour length, not raw feet.
- Panduit: `Accessories.get_TotalCost` adds `Panduits.get_TotalBoxCost` = Σ `Panduit.BoxCost`
  (ONE box per present row, `Panduits.OnRecalculate` 0x1fa88), not boxes × box cost — the
  Accessories Summary shows the latter. Reproduced behind `LEGACY_PANDUIT_ONE_BOX_PER_ROW`
  with a warning when more than one box is needed.
- Tab sealer (Duro-Roof seams), T-Patch (Duro-Tuff) and vents (mechanical) test EACH section's
  roof system / attachment, not the bid default.

### 22.6 `RoofSection.UnderlaymentAdhesive` (0x4d470) — ported verbatim

For an adhered layer: if the layer's **OWN** board's adhesive group ∈ {16, 18, 19} →
`+= QuoteAdhesiveUnits` (no coverage, no multiplier; the previous web tested the board BELOW).
Otherwise k = coverage of the substrate (board below's group, or the deck for the bottom layer)
and `units += AreaField/k × m0 + AreaPerimeter/k × m1 + AreaCorner/k × m1` — the corner squares
ARE in the units basis (labor keeps field + perimeter, §18); `m0 / m1 = UUseAdheredCustomSettings
? ToInteger(12 / UCustomAdhesiveSpacing(0 | 1)) : 1` — an INTEGER multiplier (8" → ×2, 9" → ×1,
24" → ×0), separate field and perimeter/corner spacings, both required. No NeedQuote guard: an
adhered quote layer bills its adhesive too. `BidSectionInput.uAdhesiveSpacingPerimIn` (Enhancement
Options now has both boxes; absent = the field spacing). Legacy divides by coverage 0 (tapered
below) → +Infinity — the web warns and bills 0 there.

### 22.7 Data & fallback corrections

- `adhesive_wall_coverage`: the Duro-Tuff (RS3) 350 / 300 rows are COMMENTED OUT in the shipped
  installer (SqlScript.xml 2213–2214); only the release-2.1 `-1` rows exist. Removed from the
  live table and the seed (migration `20260918100000`). Legacy divides `WallPlusTopSqFt / −1`
  and SUBTRACTS units for an adhered Duro-Tuff wall — a vendor defect; the web warns and bills 0.
- `non_dl:others` (NDLOthers: "DL Approved Slipsheet" = Ceil(parapet + curb polyethylene sq ft),
  curb ISO sq ft) existed only in the live database; migration `20260918110000` records it
  (rows `_uncaptured`, $0 — prices must come from the licensed Estimator).
- Frozen-snapshot fallback: parapet wood blocking bills the row's MATERIAL too (`ReviewCalc.NonDL`
  case 1 = WallBlockings + EdgeBlockings `get_MaterialCost`), not labor only.

### 22.8 Flagged (not changed — decisions or captures needed)

- Duro-Tuff parapet `AdjustedSqFt` = panels × **30** × AdjustedLength in the IL (no ÷ 12); the
  web bills panels × 2.5 ft (§3 / §7.3 HUMAN GATE — unchanged, needs a validation bid).
- Admin › Duro-Last › Adhesives: the Substrate → Field Coverage grid is a reference capture; the
  engine reads coverage from the seeded legacy tables (`adhesive_coverage_*`, wall coverage) and
  the Labor › Adhesive Times grid. Edits there change the PRICE only (the editor now says so).
  Wiring the grid to the engine, or replacing it with editors for those tables, is a follow-up.
- No per-bid underlayment $/sqft override (legacy `frmULSqFtPopUp` → `DualValue.CustomValue`).
- Metals gutter accessories: the web infers "shared across all gutters" from the row's
  DESCRIPTION because the seeded screen has no `GutterID` column — an admin-entry hazard, not a
  money bug today. Full note + fix options in **§22.10**. (Separately: D/L/E/M-Style gutters have
  no priced rows in the seed — vendor-DB only, needs a capture.)
- Uncaptured prices (bill $0, already flagged): pitch-pan Filler, drip-edge corners / clips,
  `non_dl:others` rows (see §22.11 — they are not reachable from either legacy UI). CLOSED
  2026-09-21: Rock Ply pipe stacks and Rock Ply corners do not exist in the legacy catalog
  (owner confirmation) — the code paths stay but the pipe-stack picker no longer offers the
  colour; Dark Gray / Terra Cotta term-bar boxes were implemented in §22.9; Duro-Last stripping
  is priced (§22.9); gutters / downspouts are captured (§22.12).
- Membrane high-wind upcharge column follows the DEFAULT section's attachment class (mechanical /
  adhered; any other class → 0) — the web keys the bid-level attachment.
- Flute filler "Attached With": legacy keeps the combo on a quote layer but it never touches the
  quote's material or labor (only the plain-board fastener / adhesive-unit quirk, §10.7); the web
  asks for no attachment on quote layers. Kept as is (decided 2026-09-18).

### 22.9 Implemented from the §22.8 list (2026-09-18) — IL-exact

- **Stripping** (`MembraneAccs.RecalcParents` 0x1edb4, re-read to the end): per present section
  a `1' of 10" DL <mil>mil <Colour> Stripping` row, part number `baswf` + system + colour + mil
  (one row per combination), `ItemsInPurchaseUnit = 1`, price = `lookup_DuroLastPrices[mil,
  category 5 = Roll Goods][ColorToPriceIndex(colour)]` — the roll-goods $/sqft billed PER FOOT
  (Duro-Tuff sections: `1' of 10" DT`, price `lookup_DuroTuffPrices[mil]`); CalcQty 0, the user
  enters feet; `GenericMaterial.Cost = Round(price × Ceil(qty), 2)`. Labor = MembraneAccs item
  3's rate × `durolastmech` `SmartDeckTypeMultiplier[deck]`. Web: `strippingBySection`
  (bid-builder) feeds `computeAccessories`; feet aggregate per part before the Ceiling; the
  screen shows the $/ft.
- **Admin Adhesives coverage grid → engine** (`applyAdhesivesScreenCoverage`): the grid is the
  legacy `AdhesiveCoverage` table `RoofSystem.LookupCoverageRate` reads. Membrane groups →
  `byDeckName` (deck substrates), `byUnderlaymentGroup` (board-group substrates, keyed by the top
  board's group — legacy `UnderlaymentCoverage[AdheredTo]`), "Walls" → `wallCoverage`;
  "Insulations" → the Adhesive Times COVERAGE cells (labor stays). Screen cells win over the
  installer seed; null keeps the seed; 0 = needs quote.
- **Per-bid underlayment $/sqft** (`frmULSqFtPopUp` → `DualValue.CustomValue`; `SmartValue` =
  custom > 0 else default): `BidInput.underlaymentPriceOverrides[board]`, entered under the board
  price on the Underlayment step, saved with the bid.
- **Dark Gray / Terra Cotta term-bar "Additional" boxes**: `TermBars.get_ItemByColor(4|5)`
  (0x25834) finds no bar of that colour and returns bar[0] = White, so those feet price on the
  White bar (`additionalNoDrillOther` / `additionalPreDrillOther`).
- **Wall Type default** = 4 (Brick or Concrete) for new parapets and the Setup default.
- **High-wind column**: `defaultRoofSection` is the estimate-level defaults section (set only in
  `Estimate..ctor`), so the column follows the bid-level attachment — `cMechanicalSystem`
  (typedef 0x3d) → column 2, `AdheredSystem` (0x31) → column 3. The web already does this;
  verified, no change.

### 22.10 FLAG (open, 2026-09-18) — gutter accessories are routed by description text, not a `GutterID`

**Not a live money bug.** Every seeded row routes correctly today. This is recorded because the
mechanism is fragile in a way that fails SILENTLY and only bites the next person who edits the
Exceptional Metals screen.

**Legacy.** `GutterAccs.readRefTable` (rva 0xa2730) fills a gutter's accessory list in two passes
over `oRefGutterAccs`: first every row whose **`GutterAcc.GutterID` equals that gutter's own
GutterID**, then every row whose **`GutterID` is `-1`** (`ldc.i4.m1`) — the explicit
"style-independent, append to every gutter" marker. The relationship is a DATA COLUMN; the row's
description is never parsed.

**Web.** The captured `duro_last:exceptional_metals` screen carries no `GutterID`, so
`buildMetalsRefData` (`src/lib/engine/metals.ts`) recovers the relationship from the description
with `GUTTER_ROW_RE` = `^([A-Z]+)-\d+\s*\(([^)]*)\)\s*—\s*(.+)$`, i.e. rows shaped
`DX-4 (A=6" B=4" C=4") — End Caps (Left)`. A match binds the row to that style + size; **anything
that does not match falls through to `ref.gutters.shared` and is billed on EVERY gutter**
(`computeMetals` bills `[...refEntry.accessories, ...ref.gutters.shared]` per gutter).

**Current state (live DB, verified 2026-09-18).** Exactly two gutter rows fall through, and both
are genuinely style-independent, so the fallback is doing the right thing:

| Row | Unit cost |
| --- | --- |
| Gutter Sealant | 7.95 |
| Rivets (250 count) | 50.00 |

**The hazard.** The admin grid (`exceptional-metals-editor.tsx`) takes free text. An admin adding
a per-style accessory without the exact prefix — `End Caps (Left)` instead of
`DX-4 (A=6" B=4" C=4") — End Caps (Left)` — gets that cost added to every gutter on every bid,
with no warning. The em dash (—, not a hyphen) and the `STYLE-N` prefix are both load-bearing.
The inverse also fails quietly: a row whose style or size is not in the pickers is dropped
(`if (!style || !size) continue;`).

**Fix options, cheapest first.**
1. Keep the parse; treat ONLY a known allow-list of style-independent part names (Gutter Sealant,
   Rivets…) as shared, and surface anything else unmatched as an admin warning instead of
   silently billing it everywhere.
2. Add an explicit `shared: true` (or a `gutter_id` mirroring the legacy column) to the row shape,
   default it from the current parse in a migration, and have the editor expose it as a checkbox.
   This is the faithful restoration of the legacy `GutterID = -1`.
3. Validate in the editor at save time: warn when a new gutter row matches neither the
   `STYLE-N (dims) — part` shape nor the shared allow-list.

Option 2 is the real fix; option 1 removes the silent-mispricing risk in a few lines.

### 22.11 Where the two `non_dl:others` rows live in the legacy app (answered 2026-09-18)

Asked while hunting for their prices. Short answer: **neither legacy UI exposes them**, so the
values are only recoverable by running a bid.

- **Bid-Advantage Management (admin).** The "Non Duro-Last Pricing" branch has exactly eight
  nodes — Roof Edge Blocking, Parapet Wall Blocking, Structural Deck Materials, Sheet Metal Work,
  Masonry, Subcontractors, 3rd Party Services, Preset Custom Applications (admin capture
  2026-08-31 114217, tree fully scrolled). There is **no Others node**; the eight match the eight
  `non_dl:*` screens we seeded, which is why `non_dl:others` was never captured.
- **Estimator.** `frmNonDL.RefreshSummary` (0x67f44) DOES write the Others collection into
  `lvSummary` — one line per row with **Description, Qty and MaterialCost** (the two labor columns
  are hard-coded 0). But `btnEditNDL_Click` (0x688d0) and `lvSummary_DoubleClick` (0x68768)
  dispatch on the category text and handle only the eight named categories, so the Others line
  cannot be opened. `frmNonDLReconcile`, the one form that renders these rows in an editable grid,
  is **never instantiated anywhere in the shipped Estimator.exe** (full scan) — dead code, like
  the `bOverride` material-total (§14.2) and Peel Stop.
- **Installer.** `SqlScript.xml` only renames row 1 (`UPDATE ref_ndlOthers SET Description =
  'DL Approved Slipsheet' WHERE ndlOtherID = 1`, line 3323). No INSERT, no price. The rows and
  their unit costs are pre-existing vendor-database content.

**Capture route (the only one).** In the legacy app build a bid whose geometry fires both
auto-quantities — a parapet or curb with the polyethylene option on (row 1 =
`Ceil(Parapets.PolyethyleneSqFt + Curbs.PolyethyleneSqFt)`) and a curb with insulation on
(row 2 = `Ceil(Curbs.ISO_SqFt)`) — then read the two Others lines on the Non-Duro-Last screen's
summary list. Unit cost = Material ÷ Qty. The same lines also reveal **row 2's real description**;
ours ("ISO (Curb Insulation Sq Ft)") is a stand-in, since the installer names only row 1.

### 22.12 Parity Comparisons round 1 — Curbs screen + Estimate Review pair (2026-09-21)

Source: the owner's "Parity Comparisons" Drive folder — the legacy and web Curbs screens for the
same seven curbs, both apps' Estimate Review (Cost and Labor views) for that bid, and the
legacy Gutters / Downspouts / Pitch Pans dialogs for every style and size. The web bid was
re-keyed by hand, so some inputs drifted (noted per item); the roof sections were entered with
different values on purpose, so their review lines are not comparable.

**Confirmed penny-exact against the legacy screens** (same inputs): Roof Sections membrane
material $60,908.34; Flute Filler $12,582.84 and Tapered/Other $2,500.00 quotes; warranty
$7,264.40; standard-sheet discount ($2,436.33); prepay 5 %; setup 157.51 h / $7,087.77;
inspection 16 h / $720; the whole totals chain (Total Purchases, Subtotal 1, gross-profit
markup at 25 % and 35 %, commission 1.5 % on Subtotal 2 + per-diem, Bid Total, man-days, price
per roof sqft); curb wrap material — the engine reproduces the legacy $1,008.30 (legacy
dimensions, 40 mil) AND the web's $1,131.10 (the web bid had C = 12 on curbs 3 and 4 and 50 mil)
to the cent, so that gap is input drift; parapet vertical / total wall sqft.

**Bugs found and fixed**
- **Underlayment waste factor was inverted** (§6 corrected): legacy bills ×1.03 on every board and
  ×1.06 only on Geotextile. Proof on the screens: legacy 4x8 ISO $79,120.15 = web $81,424.62 ×
  1.03 / 1.06 exactly. Every insulation board was over-billed 2.9 %.
- **Curb insulation labor** (`Curb.ISO_Labor` 0x33718): `Round(0.25 + LinealFt × 0.0167 × Qty, 2)`
  — the 0.25 h once per entry, not per unit. Curb F (30×72, qty 3): web 9.05 h → 8.55 h; legacy
  shows 8.53 h. The remaining 0.02 h (≈ $1) does not come from any term in `BaseHours` (0x333a4,
  re-read: `(perLF × (A+B)×2/12 × qty + base × qty) × typeMult + Poly/400 + ISO_Labor`, LinealFt
  = (A+B)/6 exactly) and is left as a residual; the admin caption "Setup + (Deck × Multi)" is
  looser than the IL, which multiplies the setup too.
- **Review "Total Membrane sqft"** is legacy `dTotals[29]` = SqFtTotalMembrane + Parapets.
  AdjustedSqFt + Parapets.ARPSqFt + RoofSections.ARPSqFt (legacy showed 60,397.50 vs the web's
  bare 55,880); "Price per membrane sqft" and "Labor per membrane sqft" divide by it. Wired via
  `BuildResult.reviewMembraneSqFtExtras`.

**Open from this pair — needs the parapet screens**: parapet material legacy $6,640.73 vs web
$6,628.97 with identical wall sqft. At the 50 mil parapet price ($1.47) that is 4,517.50 vs
4,509.50 adjusted sqft — an 8 sqft gap on one wall's AdjustedLength / AdjustedHeight (pieces or
height rounding), and parapet labor 184.10 h vs 181.16 h. Not resolvable from the review alone.

**Display gaps noted (not money)**: the legacy Review carries a second Amount column (the
CustomMarkup "what-if" at 35 %); the web shows one. The web lists Adhesives as its own purchase
row; legacy folds adhesives into Accessories (same M0). Legacy "Other" $46.80 is the
`non_dl:others` rows priced from the vendor DB — with the seven curbs' ISO sq ft (Σ (A+B)/6 × qty
= 310.5 → 311) that is ≈ $0.15/sqft; read the Others lines on the legacy Non-DL screen to pin it
(§22.11).

**Captures applied** (migration `20260921100000`, live DB updated): four gutter styles DX / LX /
EX / MX × three sizes (4: A6 B4 C4; 5: A7 B5 C5; 6: A7 B6 C5) — gutter $10.90–$12.50/LF, end caps
$33.10–$33.85, splice plates $9.65–$10.00, miters $147.55–$155.95, all 0.15 / 0.15 / 0.1 / 1.0 h
at $45; Gutter Sealant $7.95 and Rivets $50 shared, no labor. Downspouts in five sizes (3"X4",
4"X4", 4"X5", 5"X7", 6"X6") — Open $18.90–$20.50, Closed $10.45–$13.00, Drop/Outlet $23.65–$24.90,
elbows $63.05–$66.95, 0.15 h (drop 0.75) at $45. Two legacy data quirks kept verbatim: the 5"X7"
Open row's labor rate is $0.00 and Snow Diverter is $0.00 (the installer's $34.55 was replaced).
Pitch pans already matched ($96.58 / $102.31 / $108.02, 1 h); the Filler amount is still not on
any screen. The 2026-09-09 installer reseed had priced the gutters at $4.69/LF with no labor —
those were 2013 vendor defaults, not the owner's live values. The plain D / L / E / M styles are
NOT used (owner, 2026-09-21); they stay listed in the seed with no priced rows and nothing
should be captured for them.

**Open — Duro-Caulk on the term bar: legacy 28 tubes vs web 14 (owner note, 2026-09-21).** The
owner's field reason is that a T-bar is caulked behind it AND along its top edge (two beads). The
legacy code does NOT do that: `Sealants.RecalcParents` (0x22208, re-read) computes ONE bead per
colour index — `ToInt32(Ceil(TermBars.GetTotalLengthByColor(i,0,0) + FaciaBars.
TotalCoverLengthByColor(i)) / 12)` — where `GetTotalLengthByColor` returns the first present
bar of that colour's `TermBar.GetTotalLength` = `R10(1.03f × (GetCalculatedLength(0,0) +
OtherPreDrill + OtherNoDrill))` and `GetCalculatedLength(0,0)` = roof edges + curbs + parapet
walls (no base row). No ×2, no second pass, and the White row (SealantID 13, position 12) IS
zeroed before the add, so the accumulation quirk that affects Bronze cannot double it either.
The web (`accessories.ts` Sealants block) computes the identical expression, so the 2× has to be
an INPUT difference: the legacy bar carried twice the footage (parapet walls terminated with
T-Bar on both apps?, a base term bar, Additional pre-drill / no-drill feet), a fascia cover
length on the same colour, or extra White tubes from drains (+1 each), washers (Ceil(0.25 × qty))
or pipe stacks (1–4 per stack, +1 if open, in the stack's colour). Resolve from the Term Bar
screen of both apps (roof / curb / parapet / additional feet, total, tubes) plus drain and stack
counts. Not implemented as a ×2 — that would be fabrication against the IL.

### 22.13 Owner walkthrough fixes (2026-09-21) — screens, not money

- **New section prefills 0 × 0** (was 100 × 100); the VerifyFields "Width" / "Length" problems
  flag it until keyed. Legacy `frmRoofSection.ResetFields` default is not the point — a silent
  100 × 100 was being priced when a section was forgotten.
- **Underlayment screen selection**: one click moves the selection to that section (legacy grid
  click); a native checkbox per row adds/removes it for a multi-section apply; "Select all" stays.
- **Flute Filler "Calculate pieces" piece length** prefills 8 ft (owner's stock length; the
  legacy `tbFFLength` default was never captured).
- **Section Labor link = legacy `frmLaborPopUp`** (§8.7): the link reads `Labor: X hours (Y%)`
  with `Y = 100 + AdjustLabor`, and the popup edits either the percent or the target hours
  (`hours = base × pct / 100`, stored `Round(pct) − 100`). The web had been showing the stored
  delta (0 / −20) where the legacy shows 100 / 80. `sectionBaseHours` (the same
  `computeSectionInstallHours` at AdjustLabor 0) is the 100 % reference.
- **Field Roll Width is a pick** — `frmRoofSection.LoadLapSpacings` (0x94de0): for roll goods
  (`SheetSize.Layout ≠ 1`) the label is "Field Roll Width" and the combo lists
  `RoofSystem.RollGoodWidths` (the `RSRollGoodWidth.Width` rows, inches: Duro-Last 64;
  Duro-Tuff 30 / 60 / 120; Duro-Roof 64; Duro-Fleece 60 / 120); for sheets it is "Field Tab
  Spacing" over `SheetTabSpacings`. The web offered a free inches box for roll goods; it now
  picks from `rollGoodWidthMulti[rsId]` (the seeded table) and falls back to the box only when
  a system has no rows. **Ported in full (same day, `src/lib/engine/lap-options.ts`)**: the
  list follows `SheetSize.Layout` (roll-goods sheet → RollGoodWidths / "Field Roll Width";
  sheet layout → SheetTabSpacings / "Field Tab Spacing", via the builder's isRollGoodSheet
  test); under a MECHANICAL attachment each lap is offered only when
  `UniversalFastenerSpacing(thickness, designTable, [lap], pullTest, 0)` finds a field
  spacing; an empty list becomes the single **"Check Pull"** entry, whose selection stores
  FieldLap = 0 (`cbLapWidth_SelectedIndexChanged` 0x950f4); the saved lap is preselected when
  still listed, else the first entry (`SelectedIndex = 0`). `VerifyFields` flags "Lap Spacing"
  only for an out-of-range selection — "Check Pull" itself is not flagged; the pull-test hints
  (" - Pull Test" unparsable, "< 140") are separate. The mechanical filter is skipped when the
  fastener lookup is not loaded (data gap). A zero lap keeps every estimate figure finite
  (pinned by a test); the roll-goods calc returns the bare area when the lap is 0.
- **Adhesive pickers are data-driven** (`adhesiveOptionsForSystem`): roof / section pickers list
  `RoofSystem.AcceptableAdhesives` = every adhesive with an AdhesiveCoverage row for the roof
  system (`frmHome.LoadAttachmentSystem`, 0x57eec); parapet pickers list
  `RoofSystem.WallAdhesives` = rows whose WallCoverage is neither −1 nor 0
  (`frmHome.LoadParapetAttachmentSystem` 0x58f30, lambda 55-0). With the vendor seed that is
  Water / Solvent for Duro-Last and Duro-Tuff roofs and walls, and Water Based + Duro-Fleece
  2-part / cartridge + Duro-Grip + OlyBond BiB / SpotShot for Duro-Fleece roofs (no Duro-Fleece
  wall rows — all −1). The owner reported MORE parapet adhesives in the legacy — their live
  Manager data must carry wall coverage rows the 2013 bootstrap lacks; adding a "Walls"
  coverage for an adhesive on the admin Adhesives grid now adds it to the parapet pickers.
- **Additional term bar 10 ft showing 20 ft is legacy-exact**: the bar's total is
  `RoundToNextTen(1.03f × (calculated + additional))` (`TermBar.GetTotalLength` 0x24e1c), and
  R10(10.3) = 20 — the same 20 the legacy Term Bar screen shows for a lone 10 ft Additional.
- **Admin Save buttons** moved to the top of every admin screen.

### 22.14 Parity Comparisons round 2 — Roof Sections pair (2026-09-21): Duro-Bond labor model

Source: the owner's `sections` folder — both apps' Roof Section screens and Estimate Review for
a two-section Duro-Bond 50 mil bid (A 188 × 182 Metal Retrofit, B 164 × 111.5 Structural
Metal, 1000 sf sheet, pull test 425 / DT 60, quick bid, no perimeter edges).

**Matched exactly**: membrane material $60,908.34, Total Membrane sqft 55,880, Roof sqft 52,502,
setup 157.51 h, inspection 16 h, crew rate ($45: 383.46 h ↔ $17,255.92).

**Bug — Duro-Bond sections were priced on the Duro-Last labor chain.** Legacy 383.46 h vs web
282.75 h; with B's on-screen 120 % removed both sections were short by the SAME ×1.268, i.e. one
missing term. `DuroBondSystem.RoofSectionLaborHours_4_0_237` (0xba1c; `_230` identical minus
the sheet multiplier) is a different model:
```
hours = MembraneType.Labor × MembraneWithOverlap × LayoutTime/2500 × SheetSize.MechSheetMulti
      + UnderlaymentFasteners(−1,0,0) × SingleFastenerTimeByDT(deck)
```
`UnderlaymentFasteners(−1)` on `durobondmech` (RoofSection 0x4d…: layer −1 branch) =
`DuroLastFunctions.DuroBondFastenersField + DuroBondFastenersPerim` (0xa58b4 / 0xa5934):
`Round(AreaField/32 × field) + Round(AreaPerimeter/32 × perim + AreaCorner/32 × corner)` where
field/perim/corner are the MechFastenerLookup columns for roof system 2 — induction plates PER
4 × 8 BOARD ("6 per 4x8" on the legacy screen: 50 mil / DT 60 / pull 425 → row 350 → 6 / 8 / 10),
or the Custom*FastenerSpacing values under custom settings. Raw takeoff areas, .NET banker's
rounding. The web's generic chain (10 × deck × tab × oc / 2500 × sheet × thickness) happened
to equal the layout term (all multipliers 1 except sheet 1.1 and 50 mil 1.15), so the plate
fastening time was the whole gap: A 6,416 plates × 0.462 min = 49.4 h; B 3,429 × 0.462 = 26.4 h.

Data: the Duro-Bond combo's `duro_bond_base_labor` (sheet_layout_hr 10; minutes per plate Wood
0.342, Steel / Retrofit / Purlin 0.462, LWC/Steel 0.858, Concrete / LWC-Concrete 2.185) was
captured and editable on the admin screen but never read by the engine. Now `LaborTables.
duroBondBase` → `RoofSection.duroBond` for rsId 2 mechanical sections; AdjustLabor wraps the
model like every other system (§16.2). Reproduced: A 233.59 h, B 124.89 h (149.87 h at the
screen's 120 %) — pinned by a test. The Sections screen now labels the Duro-Bond lookup value
"Plates per 4×8" / "6 per 4x8" instead of inches on centre.

Not comparable in this pair: Accessories ($31,520.70 / 97.56 h legacy vs $6,556.70 / 53.79 h)
and the insulation / non-DL lines — the legacy bid carries the full Knox County scope.

### 22.15 Roof-system labor sweep after §22.14 (2026-09-21) — every system's RoofSectionLaborHours

Re-read `*System.RoofSectionLaborHours_4_0_230/_237` for all five systems plus the rate
routines they call (`RoofSystem.MechField/MechPerim/AdheredField/AdheredPerimLaborRate`
0xa5d4 / 0xa810 / 0xa790 / 0xae7c, `DuroLastSystem.MechField/MechPerimLaborRate` 0xc4c4 /
0xc714) against the web chain, looking for another model gap like Duro-Bond's.

- **Duro-Last, Duro-Roof, Duro-Fleece**: `Labor × (field rate × MaterialTotalField + perim
  rate × MaterialTotalPerim + corner rate × MaterialTotalCorner)`, clamped ≥ 0 — the web's
  `roofSectionLaborHours` over the zone shares of MembraneWithOverlap (§20.1). Rates match:
  mechanical `10 × deck × tab × oc / 2500 × sheet × complexity` (perimeter/corner on the
  DEFAULT deck column, corner o.c. = the perimeter's unless custom); adhered
  `GetAdhesiveBaseHours/1000 × (roll-goods sheet ? RollGoodWidthAdhesiveMulti(FieldLap) :
  SmartSheetMulti) × complexity`, perimeter ×1.2 only for "durogrip" with a PerimeterSpacing.
  Duro-Last's field override differs from the base only by the inactive `lookup_Decktimes`
  factor (§20.2) and the 3"-snap of the o.c. it keys — no effect. **No change.**
- **Duro-Bond**: the §22.14 model (fixed the same day).
- **Duro-Tuff — second gap, fixed.** With a MECHANICAL perimeter ("durotuffmech")
  `DuroTuffSystem.RoofSectionLaborHours_4_0_230` (0xf5bc) does NOT use the zone shares. It bills
  the membrane rows the §21 routine wrote back: per tier i ∈ {0, 1}, `NumCustomRows(i) ×
  In2Ft(CustomPerimeterLap(i)) × PerimTotalLength` (and `× CornerTotalLength`) at
  `MechPerimLaborRate`'s tier-i rate — tab key CustomPerimeterLap(i) / CustomCornerLap(i)
  (30" → ×2.8, 60" → ×1.4), on-centre from MechFastenerLookup keyed by THAT lap
  (`UniversalFastenerSpacing(thickness, DT, [lap_i], pull, 1)`; the corner shares the
  perimeter's spacing; Custom*FastenerSpacing(i) under custom settings; a failed lookup leaves
  the error code → no band → ×1.0) — and the field at the field rate on `MembraneWithOverlap −
  Σ row areas`. The tier-1 block of `RoofSystem.MechPerimLaborRate` (0x0369+) runs only for
  "durotuffmech". Seeded Duro-Tuff lookup (DT 60, any mil): 30" rows perim 18" o.c. from 350 lb,
  60" rows 9" o.c. from 425 lb, corners always −1. Web: `RoofSection.duroTuffMech` (tiers from
  `duroTuffMembraneCalc`'s written-back rows / laps, `BidInput.fastenerLookup` = the
  mech_fastener_lookup rows the estimator already loads, zone perimeter / corner lengths);
  `computeSectionInstallHours` computes the branch; without the lookup rows the stored
  spacings are used and a warning says so; adhered Duro-Tuff and sections without perimeter
  footage are unchanged (the formula collapses to field × MembraneWithOverlap). Pinned by
  tests with a hand-computed case.
- **Duro-Tuff custom settings — ported (same day).** `frmRoofSectionAdv` "Duro-Tuff Options"
  (`grpDTCustomSettings`, `LoadForRoofSection` 0x9d6e4 durotuffmech branch): `cbUseDTCustom` =
  UseCustomSettings; the outer / inner width boxes (`tbDTOuterPerim` "30", `tbDTInnerPerim`
  "60") are DISABLED — on load the form re-asserts `CustomPerimeterLap(0) = 30, (1) = 60`;
  editable are `tbDTCustomRows0/1` → NumCustomRows(i) (`_LostFocus` → `set_NumCustomRows`),
  `tbDTCustomPerimFast0/1` / `tbDTCustomCornerFast0/1` → Custom{Perimeter,Corner}
  FastenerSpacing(i), `cbDTCustomFieldWidth` (RollGoodWidths) → CustomFieldLap, `tbDTCustomField`
  → CustomFieldFastenerSpacing. Nothing on the form writes CustomCornerLap — in custom mode the
  corner tab keys are whatever the last NON-custom recalc wrote back ((30, 60) for a section that
  started on BA-default rows, the normal path); the web uses (30, 60). Web:
  `BidSectionInput.tuffCustom { rows, perimOc, cornerOc, fieldLapIn?, fieldOc? }` on the
  Sections screen's Enhancement dialog (Duro-Tuff mechanical only); the calc takes the rows at
  the fixed widths and the custom field width, the labor tiers take the per-tier spacings, the
  field takes the custom field spacing. Older bids' Duro-Last-style `perimLap` on a Duro-Tuff
  section keeps its one-outer-row mapping.

### 22.16 Parity Comparisons round 2 — Parapets pair (2026-09-21)

Source: the owner's `parapets` folder — both apps' Parapets screens for the three Knox County
walls (Duro-Last / Solvent Based Adhesive / 50 mil / White, Metal Retrofit, Brick or Concrete):
P1 vertical 6/54, 750 ft; P2 vertical 6/18, 160 ft, T-Bar 160; P3 Up & Over 6/104/13/3, 35 ft.

**Input drift, not a bug — pieces.** Legacy P1 = 10 pieces, P2 = 1; web P1 = 8, P2 = 2.
`AdjustedLength = Length + 1 + Pieces` (§3) reproduces BOTH apps exactly: legacy membrane
4,517.50 = 761 × 5 + 162 × 2 + 37 × 10.5; web 4,509.50 = 759 × 5 + 163 × 2 + 37 × 10.5. The
labor gap is the same drift: P1 162.09 h / 761 ft = 0.2130 h/ft = web 161.67 h / 759 ft; P2
11.57 h × 162/163 = 11.49 → the legacy's "11.5"; P3 10.51 h on both. Totals 184.10 vs 183.75 h
and the $8 difference follow. With matching pieces the parapet lines are penny-exact; the
"$11.76 / 8 sqft" item from §22.12 is closed.

**Matched exactly**: Vertical Wall Sq Ft 3,918.33; per-wall labor at equal inputs; Height after
tabs 44" on P3 (104 − one 60" adhered tab).

**Fixed — Total Wall Sq Ft on the Parapets screen.** Legacy `Parapet.TotalWallSqFT` (0x419f4)
= `Length × (Vertical + Drop + Cant + WallTop) / 12` — no skirt — = 3,965.00 on the screens.
The web screen summed the full girth (skirt included) → 4,437.50; the Review stat already used
the legacy formula. Display only: nothing prices off it (wall adhesive uses WallPlusTopSqFt).

**Flagged — "Height after tabs" on tab-less walls.** Legacy shows 0" for P1 (54") and P2
(18"); the web shows 54" / 18". `Parapet.RemainingHeight` (0x423c8) as read: start at slot 1
(2 with a cant), subtract `m_dTabs[i]` up to `m_iCalcTabCount`, clamp at 0 — with no tab rows
the loop does not run and the routine returns Vertical, which is what the web does. The
screens disagree with that reading, so either the preview parapet's tab state differs at paint
time or a step was missed; no money depends on the label. Left as-is pending a second look.

### 22.17 Parity Comparisons round 2 — Underlayment pair (2026-09-21): "Section Fastened w/ Durobond"

Source: the owner's `Underlayment` folder — the legacy Underlayment screen with the Flute Filler
quote dialog and FluteFillerCalc open, and the web's Flute Filler dialog.

**Matched exactly**: the Flute Filler quote — 4,324 pieces × $2.91 + 60 h → Material & Labor
Cost $15,282.84 on both. Not comparable: the legacy FluteFillerCalc had no ridge width entered
(0 pieces); the web's "Use 182" is the §10.7 formula at 12" ridge centres. The legacy dialog's
"S.F of Sections 0.00 / Flute Filler Name 12528" is its own binding quirk (the quote id lands
in the name box) — not money.

**Bug — no Duro-Bond layer attachment.** The legacy screen's figures reproduce only with NO
fastening term: A (½" ISO, 34,216 sqft) 117.05 h = 34,216 / 2500 × 7.775 × 1.1; B (2 × 2½" ISO,
18,286 sqft) 189.48 h = 2 × 18,286 / 2500 × 11.775 × 1.1; together the Review's 4x8 ISO 306.53 h
(the 1.1 is `SheetSize.SmartSheetMulti` = the ROOF-SECTION column of the 1000 sf row, not the
Underlayment column's 1.2). Legacy `frmUnderlayment.LoadAttachment` (§10.4) offers "Section
Fastened w/ Durobond" / "1+ Sections Use DuroBond" first on a Duro-Bond system; a layer so
attached bills layout only — the board is held by the membrane's induction plates, whose
fastening time is the Duro-Bond SECTION labor (§22.14). The web offered only Mechanically
Fastened / Adhesive / None, and "Mechanically Fastened" adds the 5-per-4×8 fastening term (A
would bill 162.3 h). Web: `UnderlaymentLayer.attachment = "durobond"` ("Section Fastened w/
Durobond", listed first and defaulted on Duro-Bond bids, §10.4 order): layout labor only;
boards count for material; no screws in consumption; the Fasteners-screen `uf` on a Duro-Bond
field attachment is now the membrane's plate count (`UnderlaymentFasteners(−1)` on durobondmech
= DuroBondFastenersField + Perim, §22.14) — previously the layers' 5-per-board counts. Pinned
by tests (117.05 h + 189.48 h). `RoofSection.UnderlaymentBaseHours` (0x4c284) also carries a
tile-6 block that adds `UnderlaymentFasteners(−1) × durobondmech.SingleFastenerTimeByDT` into
`m_dUnder_labor[5]`; the Review's Tapered/Other 15 h (quote only) shows it did not contribute on
this bid — not transcribed (see the block's own guards before relying on it).

### 22.18 Flute Filler quote dialog — Calculate Pieces re-read + LumpSum sync (2026-09-21)

Owner's follow-up on §22.17: the web's "Calculate pieces" showed 182 for section A and the
Lump Sum box stayed at 0 in piece mode where the legacy shows the material amount.

- **Calculate Pieces — the §10.7 transcription was wrong, fixed.** `frmFluteFillerCalc.
  calculateButton_Click` (0x24a00) re-read with the locals: the eval stack keeps
  `Round(Length) × 12` and `across = Round(secLen / r2r)` — flute rows across the LENGTH ("the
  Width side runs from Ridge to Gutter") — not `Round(ff / r2r)`; and the trim branch is
  `frac(secWid / ff) < 0.5 → Round((1 − frac) × across)` (bge.un 0.5 jumps to the zero case),
  the reverse of the first reading. 188 × 182, 8 ft, 12" → 188 × 23 = 4,324 = the owner's legacy
  quote (the FluteFillerCalc screenshot itself shows 0 because its ridge box was blank).
  `fluteFillerPieces` now takes each section's length and width; tests pin 4,324 / 4,757 (+10 %)
  and a trimmed case.
- **LumpSum ⇄ per-piece — ported.** `frmULQuote` keeps ONE `QuoteUL.LumpSum`:
  `txtPerPiece_KeyUp` writes `pieces × perPiece` (Single) into it and shows it in the Lump Sum
  box (greyed while Piece Quote is selected — the radios only enable/disable the two groups);
  `txtLump_KeyUp` writes the lump and shows `Round(lump / pieces, 4)` back in the per-piece box;
  `UpdateCost` = LaborCost + LumpSum. The web dialog now mirrors that: the Lump Sum box displays
  pieces × cost per piece (disabled) in piece mode, and a typed lump sum back-fills the cost per
  piece to 4 dp.

### 22.19 Parity Comparisons round 2 — Curbs (2026-09-21)

Same seven curbs re-run by the owner after §22.12 (legacy: Structural Metal, 40 mil White,
insulation on A and F; web: deck Retrofit, mil/colour "Bid default" except curb 4 = 50 mil White,
insulation on curbs 3 and 8 = A and F). Legacy 48.81 h / $2,196.39, material $1,008.30; web
49.04 h / $2,206.58, material $1,046.52.

- **Labor — setup is per deck, not global (fixed).** `lookup_CurbTimes` is one row per
  `DeckTypeID` with `(HrsPerLinealFt, MinutesToInstall, Base, CustomHrsPerLinealFt, CustomBase)`,
  and `Curb.BaseHours` (0x333a4) reads col 3 (`Base`) for the curb's OWN deck. The web carried a
  single `labor_curb.setup_minutes` = 8. Solving the three legacy readouts on this bid — Curb A
  "16.7 h", Curb F 8.53 h (§22.12) and the 48.81 h total — with the seeded 7.5 min/LF and Open
  ×1.1 admits exactly one base: **0.125 h = 7.5 min for Structural Metal** (A = (0.125×104 +
  0.125×3)×1.1 + 1.99 = 16.7025; F = 8.525; Σ = 48.80875). With 8 min the same bid is 49.01. A
  per-lineal-foot rate change cannot fit A, F and the total together. `labor_curb_deck` gained a
  nullable `setup_minutes` override (migration `20260921140000`, applied live): Structural Metal
  = 7.5, every other deck null → the global 8 (their legacy `Base` values are still uncaptured —
  read them off the BAManager Curb Times screen before trusting a non-steel curb bid to the
  minute). Admin › Curb Labor shows the new column beside Min / LF.
- **Labor — perimeter rounding (fixed).** `BaseHours` uses `(A + B) × 2 / 12` raw; the web used
  `2 × (In2Ft(A) + In2Ft(B))`, which rounds each side to 2 dp first (98×110 → 34.68 vs 34.6667
  ft, +0.0055 h on curb A; the remaining 0.03 h of the 49.04 vs 49.01 gap).
- **Labor — input drift.** The web bid's curbs are on Retrofit (legacy Structural Metal); with no
  Metal Retrofit override that deck still bills the 8 min default, so the web will read 48.81 only
  once the curbs are switched to Steel (or Metal Retrofit is given its own capture).
- **Material $1,046.52 vs $1,008.30 — input drift, engine exact.** Curb 4 (20×20×16, qty 9) is
  stored at an explicit 50 mil ($376.89) while the other six ride the bid default 40 mil; the
  brute force over every mil/colour rate reproduces $1,046.52 only for that combination given
  the stored data, and all-40-mil White gives the legacy $1,008.30 to the cent (test
  "legacy Knox County CTC screen" in `bid-builder.test.ts`).

### 22.20 Parity Comparisons — Accessories (2026-09-21)

Same Knox County CTC bid, the web side re-keyed from scratch after a reload (owner's caveat).
Legacy footer: Material $16,406.70, 100.53 h, $4,523.98. Web: Accessories $12,747.80 +
Adhesives $4,512.00 (the legacy footer folds adhesives in, §22.12) = $17,259.80, 105.28 h,
$4,737.74. Both gaps reconcile to the cent / the hundredth of an hour from input differences;
the accessories money path needed no change.

**Labor +4.75 h — all input drift**
- Drains: the web bid has the 6-drain row twice (2 × 4.50 h) and Existing Roof = Single Ply
  (`ref_DrainRoofTypes` cleanup 0.25 h/drain); legacy has one row on None: 6 × 0.5 = 3.00 h. +6.00 h.
- Pipe stacks: the web's second 4" row is Closed (×1.0); legacy Open (×1.25): 10 × 0.125 = −1.25 h.
  Legacy displays 20.62 for the raw 20.625 sum (no per-row rounding, `PipeStack.ManHours`
  0x20406 returns unrounded); the web bills the same raw sum.
- Corners 6.67, walk pads 7.5, term bar 5.95 (Pre-Drill White 160 + 10 = 170 ft), vents 27 and
  drip edge + snap cover 26.79 h are identical.

**Material +$853.10 — all input drift** (catalog: XHD 12" $406/250, Metal Anchors $255/1000,
1½" Spade $208/2000, 3½" boot $20.90 + ring $18.25, Duro-Caulk $10.20)
- +$812.00: 500 × 12" XHD typed on the web Metal fastener tab (2 boxes); legacy has none.
- +$296.10: the duplicated drain row — 6 × $39.15 boots+rings and its 6 Duro-Caulk tubes
  (§12.9 one tube per drain, $61.20). With it removed the web's Duro-Caulk is 28 = legacy 28,
  which also closes the "14 vs 28" question left open in §22.12/§22.13.
- −$255.00: the web term-bar fasteners were typed as 1½" Spade (absorbed by the drip-edge +
  snap-cover spade box count, 3,800 → 2 boxes, same as 3,400); legacy typed Metal Anchors,
  one box.
- Pipe stacks Open vs Closed price identically ($14.25 white).

**Bug found and fixed — Items Required on a Duro-Bond section.** `RoofSection.
UnderlaymentFasteners(−1)` (0x4cf40) branches on the field / perim attachment ShortName: on
`durobondmech` it returns `DuroBondFastenersField` / `…Perim` (the membrane's induction plates)
and never enters the per-layer loop. The web added the layers' mechanical counts on top, so the
re-keyed bid (layers left on "Mechanically Fastened") showed Fasteners 16,845 / Insul. Plates
16,400 / Induction 16,400 against legacy 10,805 / 0 / 9,845. The membrane part was already
exact — Round(34,216/32 × 6) + Round(18,286/32 × 6) = 9,845. The layer loop is now skipped on
Duro-Bond mechanical sections (test: 188 × 182 → 6,416); the §12.5 quirk `insulPlates += uf per
mechanical layer` is kept, so those layers should be "Section Fastened w/ Durobond" (§22.17) to
show the legacy 0. Poly plates 945 vs 960 was NOT length drift — see §22.22 (deck fasteners
count the AdjustedLength, not the bare length).

### 22.21 Duro-Bond "Field Roll Width" pick was empty (2026-09-21)

Owner: on a Duro-Bond section the Field Roll Width did not drop down with 30 / 60 / 120.

- **Cause — data, not code.** `LoadLapSpacings` (0x94de0) lists `RoofSystem.RollGoodWidths`
  (RSRollGoodWidth by RoofSystemID) on a roll-goods sheet layout. The shipped installer script
  seeds RSRollGoodWidth for systems 1 / 3 / 4 / 5 only (Duro-Last 64; Duro-Tuff 30/60/120;
  Duro-Roof 64; Duro-Fleece 60/120) — no RoofSystem 2 row — and `rdl_roll_good_width` was
  seeded verbatim from it (§21 migration `20260914100000`), so `legacyLapOptions` had an empty
  raw list for Duro-Bond and the screen fell back to the bare number box. The live vendor DB
  evidently carries 30 / 60 / 120 for Duro-Bond (the owner's legacy screen); seeded as
  migration `20260921150000` (applied live) with the adhered multiplier = 1, which nothing reads
  because Duro-Bond has no adhered attachment. Not a table capture — if the legacy combo shows
  other widths, edit the rows.
- **Filter is unchanged and legacy-exact.** `LoadFlowPanel` always shows `pnlLaps` in the
  advanced view and nothing hides it per system; the pull-test filter applies (the Duro-Bond
  field attachment is a `cMechanicalSystem`, ShortName `durobondmech`) and its
  `mech_fastener_lookup` rows all carry tab_spacing −1, so every width qualifies once the pull
  test finds a row (≥ 210 lb at 60 psf); no pull test → the single "Check Pull" entry, as in
  legacy. The chosen width feeds `RollGoodsMembraneCalc` (FieldLap) for the Duro-Bond membrane
  quantity, so the pick is money-relevant. `EditAdvRSOptions` (0x9561c) clears the combo on
  durolastmech / duroroofmech / durobondmech only while the Advanced dialog's custom settings
  are applied — not a hide.

### 22.22 Complexity wiring, rounding audit, parapet deck fasteners, numeric inputs (2026-09-21)

Owner's three questions.

**Complexity factor — wired as legacy.** IL: `RoofSystem.MechFieldLaborRate` / `MechPerimLaborRate`
(and the `DuroLastSystem` overrides), `AdheredFieldLaborRate` / `AdheredPerimLaborRate`,
`RoofSection.UnderlaymentBaseHours` and `TearOffBaseLabor` each multiply
`ComplexityFactor.SmartValue`; the Duro-Bond model (`RoofSectionLaborHours_4_0_237`) does not,
and the Duro-Tuff / Fleece / Roof `_4_0_230` / `_229` models reach it through those rate
methods. `RoofSystem.ComplexityFactors` comes from RSComplexityFactor, seeded only for Duro-Tuff
(3) and Duro-Fleece (5): Open 0.9, Minor 0.98, Moderate 1 (default index 2), Medium 1.2, Heavy
2.4, Extreme 4 — every other system lists the single "None" = 1.0. `RoofSection.set_SheetSize`
resets the factor to None on durolast / durobond / duroroof whenever the picked sheet is not a
roll (`Rolls ≠ 1`), and `UpdatePreview` enables the combo only on a roll layout whose
SmartSheetMulti is exactly 1.0. Duro-Tuff and Duro-Fleece carry a single "Roll Good" sheet (×1),
so the web's `sectionComplexityFactor(rsId, complexity, sheetMulti)` (factor rows for 3 / 5,
1.0 unless the sheet multiplier is 1.0) is equivalent on every seeded configuration; the web
picker shows the six labels for those two systems and "None" otherwise.

**Rounding — same places, same mode.** Every ported rounding is `bankersRound` (.NET
`Math.Round` = half-to-even) at the IL's own points: In2Ft 2 dp; money `GoodSingle` (2 dp then
float32); labor cost 4 dp; per-item ManHours 8 dp (curbs, parapets); curb ISO labor 2 dp; curb
wrap 8 dp; membrane counts `Round(…, 0)`; Duro-Caulk `ToInt32(Ceil(ft)/12)`. Two half-up
leftovers found and corrected in this pass: `Ft2In` (`Round(ft × 12)`, Duro-Tuff membrane
calc) and `Parapet.DeckFasteners` below. The remaining `Math.round` uses sit on values that are
already integers (`Round(Ceil(x))`) or on display-only distribution (`proposal.ts`). Screens
display 2 dp; the engine keeps full precision between steps exactly as the legacy doubles do.

**Bug fixed — parapet deck fasteners.** `Parapet.DeckFasteners` (0x427b6) =
`Convert.ToInt32(AdjustedLength)`, AdjustedLength = length + 1 + pieces (0 when pieces < 1,
0x42140). The web counted `Round(length)`. Knox County: 750 / 160 / 35 ft walls → legacy 960
poly plates on the Metal fastener tab, web 945 (the "length drift" guess in §22.20 was wrong;
the 15 is the three walls' +1 +pieces). `parapetDeckFasteners(lengthFt, pieces)` now mirrors the
IL, half-to-even.

**UX — the sticky 0.** Every quantity box was a bare `<input type="number" value={n}>`: clearing
it parsed "" → 0 and re-rendered the 0, so the user had to type a digit and then delete the 0.
A shared `NumberField` (`src/components/ui/number-field.tsx`) keeps its own text while focused,
selects the current value on focus (typing replaces the 0), clamps to `min`, and hands the
parent only finite numbers. Wired into the Sections / Curbs / Parapets / Metals / Non-DL screens
and every numeric box on the estimate route (rates, markup, per diem, adjust %, quantities).

### 22.23 Setup "Attached With" lists and the greyed underlayment default (2026-09-21)

Owner: on Setup the material choices should change with the roof system, and Underlayment
Attached With should grey out, as legacy does (Duro-Tuff lists Duro-Tuff Fasteners / Water Based
/ Solvent Based; Duro-Bond lists Duro-Bond Plates/Fasteners only and greys the underlayment combo).

- **Attached With = one combo, per system.** `frmHome.LoadAttachmentSystem` (0x57eec),
  `frmRoofSection.LoadAttachmentSystem` (0x94348) and the parapet variant fill the combo with
  the roof system's `MechanicalSystem` (LongName: 1 Duro-Last Fasteners, 2 Duro-Bond
  Plates/Fasteners, 3 Duro-Tuff Fasteners, 4 Duro-Roof Fasteners; Duro-Fleece has none) and
  then every `AdheredSystem` with an `RSAdhesiveCoverage` row for that system (wall coverage for
  parapets). The captured coverage tables have rows for systems 1, 3 and 5 only, so Duro-Bond
  and Duro-Roof show their fasteners alone. `attachedWithOptions(admin, system, scope)` builds
  that list; the Setup roof and parapet defaults, the Sections screen and the Parapets screen
  now use it in place of the old "Mechanically Fastened / (No Tab) Fully Adhered" pair plus a
  separate adhesive pick (picking an adhesive sets attachment = adhered + that adhesive). The
  legacy deck-compatibility filter (`CompatibleDeckTypes`, "Incompatible DeckType") is DB-resident
  and uncaptured — not applied.
- **Underlayment Attached With.** `frmHome.LoadDefaultUnderlaymentAttachment` (0x5bcd0): "None"
  first; when the field attachment is `durobondmech` the combo is DISABLED; otherwise Duro-Last
  Fasteners is added, and the insulation adhesives (the "insulations" group's
  AdhesivesAllowedUnder) only when the membrane attachment is an `AdheredSystem`. The web Setup
  combo now follows that: None / Mechanically Fastened / Adhesive (adhesive only on an adhered
  membrane), disabled and showing None on Duro-Bond. The stored default is left untouched on
  Duro-Bond so the Underlayment screen keeps "Section Fastened w/ Durobond" as its first / default
  entry (§22.17), which is where legacy makes that choice.
- **Curb ISO material (owner's second question).** Legacy prices curb insulation from
  `ref_ndl` Others RefID 2 ("ISO (Curb Insulation Sq Ft)", $/sq ft × Ceil(Curbs.ISO_SqFt)), not
  from the Underlayment board price. The web does the same (`nonDlCalcQuantities` → others
  RefID 2 → unit cost × qty). The live `non_dl:others` row still carries Price 0 (seeded
  `_uncaptured`; the engine only warns while price AND labor are 0) — enter the $/sq ft on
  Admin › Non-DL › Others › "ISO (Curb Insulation Sq Ft)". No engine change.

### 22.24 Curb ISO material — the hidden "Others" price, pinned (2026-09-21)

Correction to §22.23's last bullet. The owner is right that legacy has no admin screen for the
Non-DL "Others" group and no item by that name in BAManager: `ref_ndl` Others rows (RefID 1 DL
Approved Slipsheet, RefID 2 curb ISO) are vendor-DB data the legacy app reads silently — the
only place they surface is the Review's "Other" line. That line pins the price:

- Knox County CTC, insulated curbs A (98 × 110, qty 3) and F (30 × 72, qty 3). `Curb.LinealFt`
  (0x3334a) = Round((A + B) / 6, 8) → 34.66666667 and 17; `Curbs.ISO_SqFt` = Σ LinealFt × Qty =
  104.00000001 + 51 = 155.00000001; Others RefID 2 CalcQty = Ceil(…) = **156** (the 8-dp
  rounding is what tips 155 to 156). Legacy "Other" $46.80 = 156 × **$0.30 / sq ft**.
- Web: `curbLinealFt` / `curbIsoSqFt` now round exactly as the IL (the builder used the raw
  (A + B) / 6, which ceils to 155 here); the same rounded LinealFt feeds the ISO labor and the
  polyethylene sq ft. The live `non_dl:others` ISO row is set to 0.30 and its `_uncaptured`
  marker cleared (migration `20260921160000`); the slipsheet row stays 0 / uncaptured (no
  legacy readout for it yet). The web keeps the group editable under Admin › Non-DL › Others —
  something legacy never exposed.

### 22.25 Owner round: Duro-Bond insulation plates, negative needs, metals focus, Update Pricing (2026-09-21)

- **Duro-Bond shows no insulation plates.** The §12.5 quirk (`insulPlates += uf` per
  mechanical layer) is skipped on a Duro-Bond mechanical section: there `uf` is the membrane's
  induction plate count, which already holds the boards; legacy bids carry those layers as
  "Section Fastened w/ Durobond" and show 0. Deliberate deviation from the transcribed quirk
  for the case legacy never reaches by default (mechanical layers on Duro-Bond).
- **Needs go negative.** Every netted "Fasteners Needed" / "Items Required" figure (edge
  screens, parapet wall-tabs + steel plates, the deck buckets) is now calculated − entered
  without the legacy `max(0, …)` clamp: order 500 against 450 and the screen reads −50, green.
  Red only while > 0; the tree colouring is unchanged (needs > 0). The Gypsum bucket still
  forces Poly / Insul. plates to 0.
- **Metals: editing a summary row opens its own entry.** Edit / double-click on a summary line
  now opens the tile on that line's gutter style + size, downspout size or scupper option (the
  dialogs used to open on their first entry, so the row you clicked was hidden behind the
  style/size pickers). Switching style resets the size to the first size of that style; an
  entry appears on the first typed value and lists under "Other gutters on this bid" once you
  move to another style/size.
- **"Update Pricing & Labor" only while stale.** Legacy shows the button always; the web shows
  it only while the bid's frozen admin / warranty snapshot differs from the current admin data
  (both normalised, JSON-compared) and hides it once applied — so it reappears exactly when an
  admin price, labor table or warranty table changes after the bid was priced.

### 22.26 Adhesives fold into Accessories (2026-09-21)

Owner: adhesives were their own Purchases row on the web Review; legacy folds them into
Accessories. Legacy `Accessories.AccessoriesReviewTable` lists the `AdheredSystems` rows
(TotalQuantity / Name / PricePerUnit / Cost) among the accessory items and `dMaterial[4]` carries
their cost, so the Review's "Accessories" line, the Accessories screen footer "Material Cost" and
the Accessories Summary all include them (the §22.20 reconciliation already added the two web
rows to compare). Now: the ledger's Accessories row = accessory lines + ARP + whole-unit
adhesives (the separate Adhesives row is gone; M0 unchanged), the Accessories footer adds
`adhesiveMaterial`, and the sidebar summary shows an "Adhesives" group (`adhesiveLines`: whole
units + extra × price per unit) inside its totals.

### 22.27 Panduit boxes billed in full (owner's decision, 2026-09-21)

`LEGACY_PANDUIT_ONE_BOX_PER_ROW` flipped to `false`: the bid now carries boxes × box cost per
Panduit row (Knox County: 63 × 3/8" × 14" straps → 2 boxes → $88, where legacy's bid carried one
box, $44, while its own Accessories Summary showed $88 — §12.4 / §22.5). Deliberate departure
from the legacy bid figure; the constant restores it. The one-box warning no longer fires.

### 22.28 4x8 ISO labor ≈ $3.1K over legacy — Duro-Bond layers stored as "Mechanically Fastened" (2026-09-21)

Owner: "the 4x8 iso is showing 3K more on labor on our app than legacy". Bid "Knox County BOE
CTC Test 2" (Duro-Bond, Metal Retrofit): its ISO layers were saved with `attachment =
"mechanical"` (the picker's default before §22.17 landed / the Setup default `mechanical`), so
the engine added the per-board fastening term the legacy never bills on a Duro-Bond section:
A ½" ISO 34,216 sqft → Round(34,216/32) × 5 = 5,345 screws × 0.462 min × 1.1 ≈ 45.3 h; B 2½" ISO
18,286 sqft → 2,860 × 0.462/60 × 1.1 ≈ 24.2 h; ≈ 69.5 h × $45 ≈ **$3.1K**. Layout-only figures
(117.05 h + 189.48 h) are the legacy 4x8 ISO 306.53 h (§22.17).

`frmUnderlayment.LoadAttachment` (0xadd24) re-read: for a selection containing a section whose
`RoofSystem.ShortName = "durobond"` the combo is cleared, ONE item is added — "Section Fastened
w/ Durobond" when a single row is selected, "1+ Sections Use DuroBond" otherwise — `SelectedIndex
= 0`, the combo is **disabled**, `llblAdvOptions` disabled, and the routine returns before the
None / `durolastmech` / adhesive items are ever added. A Duro-Bond board can never be
mechanically fastened or adhered on its own in legacy.

Web: `effectiveLayerAttachment(layer, isDuroBond)` (bid-builder) returns `"durobond"` for every
layer of a Duro-Bond section whatever the layer stores; the builder's labor/adhesive loop, the
consumption pass (boards / screws / adhesive units) and the Underlayment grid's layer cells all
go through it, so older bids re-price without a data migration. The "Select Attachment Method"
pick shows only the forced item (multi-selection wording as legacy) and is greyed out on a
Duro-Bond selection; the apply button stores `"durobond"` for Duro-Bond sections. Pinned by
test: a Duro-Bond layer stored as `mechanical` bills 117.05 h (was "> 117.06").

Also this round (UI only, no money): the Review ledger's editable cells (Shipping (Other),
Warranty, markup radios and value, Per-Diem, Sales Commission, discount "Use" ticks) share one
green cell style with a ✎ marker and a legend; the Underlayment layer stack graphic is clickable
(click a drawn layer to select that layer, same as its "Add Layer n" tab).

### 22.29 "T-bar labor seemed double" — Parapet 2, re-verified (2026-09-21)

Owner: the term bar on Parapet 2 of the Knox County CTC bid. Bid state: P2 160 ft, Brick or
Concrete (WallType 4), 2 pieces, T-Bar 160 ft (`termOptionId 2`, `termLengthFt 160`); no
Additional feet, no base term bar, no roof-edge or curb T-bar.

`TermBar.GetParapetLength` (0x253fc) re-read: for each present parapet with a termination, add
`TermLength` to the bar of its colour when `TermOption.ID = 2`; `WallType = 1` → no-drill length,
anything else → pre-drill length. `Pieces` never enters (it only feeds `AdjustedLength` = Length +
1 + Pieces for the wall's own labor / membrane). `cboTermType_SelectionChangeCommitted` seeds
`TermLength = Length` (not × pieces); `txtTermLength` edits store it verbatim.
`get_ManHoursPreDrill` (0x24ca0): `Round(R10(f32 1.03 × (preDrill + otherPreDrill)) ×
SmartPreDrillLabor × (1 + adj/100), 4)` — 170 × 0.035 = **5.95 h**, no-drill 0.

The two apps' Term Bar screens captured for §22.20 already agree line for line: Parapets 160,
Pre-Drill White 160, Sub-Total 170, Labor 5.95 h (100%), Adj. Total Length 170 ft, Metal
Anchors 400 typed (legacy) vs 1½" Spade 400 (web) — the fastener drift noted there. Nothing in
the engine multiplies the term bar by pieces, and the term bar contributes ONE summary row
("Termination Bars White", 5.95 h) and one term into `manHours`. Pinned by test ("Knox County
Parapet 2 …"): 160 / 170 / 5.95 / 357 fasteners / a single Term Bar line. No change to the money
path; if the owner's "double" is a specific screen figure (e.g. the Review's per-item labor or
the Accessories Summary), it needs that figure to chase further.

### 22.30 Setup "2. Wall Type" now re-routes existing walls; header / footer tidy (2026-09-21)

Owner: "if you were on brick or concrete then you went to metal or wood and click update it
doesn't change from predrill to non pre drill". Legacy `frmHome.cbParapetWallType_
SelectedIndexChanged` (0x5bb7c) writes the pick to `Estimate.defaultParapet.WallType` ONLY —
new walls inherit it; `Button1_Click_1` ("apply to parapets") copies RoofSystem / Attachment /
MembraneType / Color and never WallType; "Update Pricing & Labor" is admin data. So in legacy an
existing wall keeps its own WallType (and its term-bar / fascia drill split) until it is changed
on the Parapets screen — which is what the web did too.

Departure (owner's expectation): changing "2. Wall Type" on Setup now also sets `wallType` on
every existing parapet (toast names the count); the Parapets screen picker still overrides a
single wall afterwards, and "Apply to Existing Parapets" keeps including the wall type. The
drill routing itself is unchanged (`TermBar.GetParapetLength`: WallType 1 → no-drill, else
pre-drill; the labor lookup's WallType-4-fixed rule for adhered walls, §8.5, is untouched).

Layout (no money): the estimate header keeps only the title — the bid name is the Setup › Bid
Info "Job Name"; the Proposal button is removed for now; Status and Export sit above the Bid
total card on the right; the footer holds Save & Previous | Save | Save & Next (Save alone on
the last step).

Addendum (same day): "Apply To Existing Roof Sections" also pushes the "2. Wall Type" default
onto every parapet. Legacy `RoofSections.OverwriteWithDefault` copies attachment systems,
AdheredTo, RoofSystem, DesignTable, MembraneType, Color, PerimEnhancementWidth and
UseCustomSettings — never DeckType or WallType — so this, like the on-change propagation above,
is the owner's departure; the dialog text says so.
Same button also applies "1. Deck Type" to every section (owner's request; legacy leaves
DeckType alone). The pull-test spacing autofill does not key on the deck (roof system /
thickness / design table / lap / pull test), so no o.c. re-derivation is needed; a deck change
re-keys the fastening-time, tear-off and curb-setup lookups on recompute as it does from the
Sections screen.

### 22.31 Duro-Last item numbers and the Excel price-list import (2026-09-21)

New, no legacy counterpart (the legacy app reads vendor prices from its Azure DB). Table
`catalog_item_numbers` (item_no, screen_id, row_label, price_col, dl_description, last_price,
last_import_at; PK on the four keys) maps a Duro-Last item number to ONE price cell of a
Duro-Last pricing screen; an item number may feed several cells (legacy vents carry 1231 on
every colour) and a colour variant with its own item number is its own row. Seeded (migration
`20260921170000`, applied live: 319 rows) from the captured "Part #" columns → each screen's
primary price column (Price / Price/Box / Price/Part / Price/Package / White Price / White),
pipe stacks' Open + Closed Part # → Price, Adhesives products' part_no → price; "0" and blank
part numbers skipped. Membrane, Underlayment, Exceptional Metals and Non-DL screens carry no
Duro-Last item numbers yet — "Products without an item number" on the new tab lists the gaps.

Admin › Duro-Last Pricing › **Item Numbers & Price Import**: upload the .xlsx/.xls/.csv price
sheet (SheetJS, client-side); the header row and the Item # / Description / Price columns are
guessed (overridable); rows match on the normalised item number (case-insensitive, inner
spaces dropped: "1312 BF" = "1312bf"); the screen reports matched cells (with the last imported
price), **no-match item numbers** (mappable inline), matched-but-no-price, duplicates in the
sheet and catalog item numbers absent from the sheet. "Apply" writes the prices through
`applyPriceImport` (flat rows by label, Adhesives by product name; cells that no longer exist
come back as "could not be written") and stamps the mapping with price / date / Duro-Last
description. Every catalog screen shows the mapped item numbers per row ("Item #" column), and
the legacy "Part #" columns are text inputs (they were number inputs, which dropped "1225B").
Pure matching lives in `src/lib/price-import.ts` (tests). Inventory management can hang off the
same table later.

### 22.32 Price List Import — real Duro-Last workbook, review & confirm, menu placement (2026-09-22)

Owner supplied a real Duro-Last price list (`pricelist_dl_excel_2.xlsx`): sheet "Price List"
(13,506 rows; Item / Description / Category / Category Type / Size / Item Color / Metal Gauge /
Price / Unit of Measure — Item is numeric for 12,441 rows and text such as "1312 BF",
"1628-009", "NTB01" for 1,065) and sheet "Duro-Last Membrane" (Description / Mil / Color /
Price per SqFt, 65 lines).

- **Header guess** on the real file: row 1, Item col 1, Description col 2, Price col 8, Unit
  col 9 (the price regex no longer matches "Unit"; a Unit-of-Measure column is captured
  separately and shown in the review so a per-box vs per-each basis can be eyeballed).
- **Item numbers**: 115 of the 312 seeded legacy part numbers appear in the sheet as-is (e.g.
  1222/1222P panduit, 1231 vent, 1309 corner, 1315 stack, 1568/1571 fascia bars, 1916 drain
  boot, the drill bits). The rest were renumbered by Duro-Last (CDR 1536 → 15361 "CDR 2 FAB",
  drip edge / gravel stop now 11-digit metal codes, walk pads under "Walkway Pads" …). The
  import page lists every "catalog item number not in this sheet" with a search box over the
  sheet (description / item number) and a **Use** button that re-points the mapping (delete old
  key, insert new, Duro-Last description stamped) — the owner's job, one product at a time; it
  sticks for every later import.
- **Membrane tab**: matched by `Duro-Last - {mil}mil {Description}` × colour column (case /
  whitespace-insensitive): 60 of 65 lines land; the five 50 mil 120" Tabs lines have no matrix
  row (the legacy screen never carried one) and are reported, not written. The tab is loaded
  alongside the item sheet (checkbox) and its cells carry item number "MEMBRANE" (no mapping
  row to stamp).
- **Review & confirm** (owner's request): "Review & confirm N updates…" opens a dialog with the
  count of cells to write, how many change (up / down / newly priced), a table of every changed
  cell (item #, screen, product · column, sheet description, unit, current → new, Δ%), the
  unchanged cells folded away, the skipped no-match count, and the reminder that saved bids keep
  their frozen prices until "Update Pricing & Labor". Nothing is written before "Confirm and
  apply". Current values come from `listPriceTargets` (now returns each row's price cells).
- **Menu**: "Price List Import" is its own admin page (`/admin/price-import`), the LAST item
  in the admin menu after Non Duro-Last Pricing; the Duro-Last "Item Numbers" tab keeps the map.
- Unmatched sheet items (13,391 on this file — gutters, downspouts, copings, TPO … that the
  estimator never prices) are filtered / paged in the UI; only the ones you bid need mapping.

### 22.33 Price List Import — "Add as new product" (2026-09-22)

A sheet line the catalog never had can now become a catalog row from the no-match list: **Add
as new product** opens a dialog (screen, product name defaulting to the Duro-Last description,
price column, price with the sheet's unit shown) and `addCatalogProduct` appends the row to the
chosen flat Duro-Last screen — name in the label column, the price in the chosen column, other
price/count columns 0, the legacy "Part #" column(s) set to the item number — and writes the
item-number mapping (stamped with the price / date / description) so later imports keep it
current. Duplicate names are refused (map instead); Adhesives / Exceptional Metals keep their
own editors. Rows added this way are user rows (no `_locked`), so the catalog editor can rename
or delete them.

First product imported this way (owner's request), applied with the same logic by SQL: Drain
Boot Accessories › **Drain Guard White**, item 18301, $72.00 EA (sheet "DRAIN GUARD WHITE",
Drains / Drain Accessories) — the only catalog change so far; no existing price was touched.

### 22.34 Duro-Tech TPO — the web's sixth roof system (2026-09-22, NO legacy source)

Owner: "there's a new material D-Tech TPO that's a Duro-Last TPO". The legacy estimator knew
five systems (Duro-Last 1, Duro-Bond 2, Duro-Tuff 3, Duro-Roof 4, Duro-Fleece 5); nothing in
the IL or the vendor tables covers TPO. Duro-Tech TPO is added as **roof system 6** (`durotech`,
LapOver 6, needs vents) built from three sources, every figure an estimating START to calibrate
on the admin screens:

- **Duro-Last price list** (`pricelist_dl_excel_2.xlsx`, "Duro-Tech (TPO)" category): rolls in
  45 mil white, 60 mil white / tan / gray, 80 mil white at 30" / 60" / 120" × 100' and 10"
  stripping rolls; roll price ÷ roll area is identical across widths → membrane matrix rows
  `Duro-Tech TPO - 45` (White 0.75), `- 60` (White / Tan / Gray 0.84), `- 80` (White 1.30), priced
  as a flat family (`FLAT_PRICE_FAMILY_IDS` = 2/3/5/6: one $/sq ft per thickness variant, first
  numeric colour cell — a 45 mil Tan section bills the white figure; flagged).
- **Owner's "Roof Membrane Bid Calculator Reference"** (Duro-TECH TPO section): mechanically
  fastened 24–30 h / 2,500 sq ft on a wood deck, adhered 30–36 h; deck multipliers Wood 1.00,
  Structural steel 1.00–1.10, Concrete 1.25–1.40, Gypsum/Tectum/CWF 1.15–1.30, Retrofit/recover
  1.15–1.30; 80 mil "5–10% extra handling"; complexity Open 1.00 / Moderate 1.20–1.30 / very
  cut-up 1.40–1.60+; 6" side lap on bareback Duro-Tech TPO; TPO bonding adhesive ≈ 60 sq ft/gal
  ⇒ ≈ 300 sq ft per 5-gal pail; warranties 15 / 20 / up to 25 yr NDL.
- **Duro-Tuff** (the nearest welded roll-goods system) for everything the guide does not give:
  roll widths 30/60/120 with labor multipliers 2.6 / 1.3 / 1.0, the mechanical width bands
  2.8 / 1.4 / 0.95, the seven fastener-spacing multipliers, the 14-row pull-test → spacing
  table (`mech_fastener_lookup` rs 6 = rs 3 cloned), the adhered "Roll Good" ×1 sheet multiplier,
  the parapet wall-tab rule and the row-style membrane screw count.

**Model.** Mechanical: `base × deck × roll-width × fastener-spacing × complexity × thickness /
2,500` — the legacy formula's fixed "10 Hrs" is now a per-combo `base_hours_per_2500`
(`LaborCombo` → `LaborTables.baseHoursPer2500` → `mechLaborRate({baseHours})`, legacy combos
unchanged at 10; the anchor test still bills 15.125 h); TPO seeds 27 (midpoint of 24–30, Open
complexity, 10' roll, wood). Deck multipliers = the guide midpoints (Steel / Purlin 1.05,
Concrete / LWC-Concrete 1.325, Gypsum / Tectum / Retrofit / LWC-Steel / LWC-Other 1.225).
Thickness 45 / 60 = 1.0, 80 = 1.075. Complexity 1.0 / 1.1 / 1.25 / 1.4 / 1.6 / 2.0 over the six
legacy labels, default Moderate (1.25) as legacy — so the seeded typical roof bills 33.75 h /
2,500 sq ft. The combo's `complexity_factors` list now feeds the engine when present (Duro-Tuff /
Fleece lists equal the hard-coded legacy table, so nothing else moves). Adhered: 13.2 h / 1,000
sq ft (33 h / 2,500) for "TPO Bonding Adhesive" × complexity × thickness × roll-width multiplier
(Duro-Tuff model). Membrane quantity: `RollGoodsMembraneCalc` at the 6" lap (as Duro-Fleece).

**Adhesive.** `legacy_adhesive` 11 "TPO Bonding Adhesive" (5-gal pail, price 0 — the sheet lists
only TPO spray guns, hoses, tips and primer; enter the pail price on Admin › Adhesives); coverage
300 sq ft on every deck, over ISO 4'×8' / 4'×4', EPO/XPS, DensDeck / Prime groups and on walls;
tapered / crickets groups 0 (quote).

**UI.** "Duro-Tech TPO" appears wherever the labor combos drive a system list (Setup, Sections,
Parapets); "Attached With" = "Duro-Tech TPO Fasteners" + "TPO Bonding Adhesive"; the Sections
thickness pick now follows the combo's thickness table (45 / 60 / 80 here; 40 / 50 / 60 for the
legacy systems); Field Roll Width 30 / 60 / 120 filtered by the cloned pull-test table; the
Complexity pick is live; the stripping row reads "1' of 10" TPO". Admin › Labor › Roof Deck
Labor lists both TPO combos with a new "Base hours per 2,500 sq ft" field (blank = 10).

**Not done / flagged.** TPO-specific accessories (the sheet's TPO stacks, boots, corners,
TPO-coated drip edge, T-joint covers, walkway, unsupported flashing) still price from the PVC
catalog rows — they need TPO variants on the accessory screens (phase 2). Warranty eligibility
uses the shared table (45 mil clears the 40-mil rows). T-Patch stays Duro-Tuff-only. No waste
percentage (the guide's 5 / 7 / 10%) is applied — the roll-goods calc's own lap allowance stands.
Migration `20260922100000_duro_tech_tpo.sql`, applied live. Tests: flat pricing on the
roll-goods quantity (2,731.5 sq ft × 0.75 / 1.30), 27 h base × 1.25 Moderate (36.875 h), Open
complexity, 80 mil handling, legacy anchor unchanged; `buildLaborTables` base-hours default /
override.

Addendum (guide page 1, same day): (a) **default thickness 60 mil** — the Setup and Sections
thickness picks list the combo's thickness table and snap to 60 (else the first entry) when the
roof system changes and the current value is not offered; (b) **three named adhesives** —
adhesive 11 renamed "TECH-Bond TPO Bonding Adhesive", 12 "TECH-Bond TPO LVOC Bonding Adhesive"
(300 sq ft), 13 "TECH-Bond TPO Spray Adhesive" (guide ≈ 1,000 sq ft per cylinder), all three
with deck / board-group / wall coverage on rs 6, ×1 Roll Good sheet multiplier and 13.2 h /
1,000 sq ft in the adhered combo (migration `20260922110000`, applied live; prices 0 until
entered); (c) **colour as its own price field** — `familyMembranePricesByColor` (family →
variant → colour) feeds `familyMembranePrice(admin, family, variant, colour)`: a TPO section
bills its own colour's cell when the matrix row prices it and the family figure otherwise
(legacy families unchanged: one figure in White); (d) the guide's naming note — Duro-Tuff is
PVC; only its LABOR multipliers and pull-test rows were cloned as starting values, never its
product or price. Induction welding as a TPO attachment (guide §4) is not offered yet.

### 22.35 Non-DL TPO and EPDM Rubber — non-Duro-Last membranes (2026-09-22, NO legacy source)

Owner: "can you add the non DL TPO and EPDM?". Roof systems **7 "Non-DL TPO"** (`ndltpo`, LapOver
6) and **8 "EPDM Rubber"** (`epdm`, LapOver 3) join the six of §22.34, built the same way — the
owner's "Roof Membrane Bid Calculator Reference" for labor, Duro-Tuff for the roll-goods
mechanics the guide does not give — with one money difference: **they are not Duro-Last
purchases.** Their membrane and wall material bills to the Non-DL **Other** purchases slot
(`NON_DL_MEMBRANE_IDS` = 7/8 → `nonDlMembraneMaterial` → `ndlSlots[6]`, the same slot as the
manual "other material" seam), so no Duro-Last discount / prepay / volume math touches them and
the review ledger shows the figure on its own "Non-DL Membrane" row under Non-Duro-Last
purchases. `duroLastMaterial` (M0) stays at whatever Duro-Last product the bid still buys
(accessories, adhesives, boards).

**Labor (guide midpoints, every value a START).** Non-DL TPO mechanical 25–30 h / 2,500 → base
27.5; adhered 32–38 → 35 h = 14 h / 1,000 sq ft. EPDM mechanical 28–34 → 31; adhered 30–38 → 34 h
= 13.6 h / 1,000 sq ft. Deck multipliers and complexity (1.0 / 1.1 / 1.25 / 1.4 / 1.6 / 2.0) as
Duro-Tech TPO. Thickness: TPO 45 / 60 = 1, 80 = 1.075; EPDM 45 / 60 = 1, 75 = 1.05, 90 = 1.1
(guide: thicker rubber, more handling). Roll widths: TPO 30 / 60 / 120 with Duro-Tuff's 2.6 /
1.3 / 1.0 and its pull-test rows cloned; EPDM 120 / 240 with 240" at 0.85 (wider sheets, fewer
seams) and the Duro-Tuff 120" pull-test rows serving both widths (flagged — EPDM fastening
patterns are the manufacturer's). Default thickness 60 mil.

**Quantity.** `RollGoodsMembraneCalc` at the system's lap — 6" for TPO (welded seam), 3" for EPDM
(seam tape) — so the 51'×51' test roof bills 2,731.5 sq ft of TPO and 2,666.25 sq ft of EPDM on a
10' roll. Stripping (1' of 10" "TPO" / "EPDM" per §12.x) and the parapet wall-tab rule follow the
Duro-Tuff paths (`WEB_ROLL_GOODS_IDS` = 6/7/8). A wall on a Non-DL system has no Parapets tier:
it bills billed height × adjusted length × the flat family $/sq ft for the wall's mil / colour,
into the same Non-DL bucket.

**Prices.** Neither product is on the Duro-Last price list, so the membrane matrix gets seven
locked rows — `Non-DL TPO - 45 / 60 / 80`, `EPDM Rubber - 45 / 60 / 75 / 90` — **all blank**, plus
a new **"Black"** colour column (EPDM). Enter $/sq ft per row (per colour when it matters) on
Admin › Duro-Last › Membrane; until then the section bills 0 and warns "No EPDM Rubber membrane
price for "60"". Adhesives 14 "Non-DL TPO Bonding Adhesive", 15 "Non-DL TPO Spray Adhesive", 16
"EPDM Bonding Adhesive", 17 "EPDM Spray Adhesive" (300 / 1,000 sq ft coverage on decks, board
groups and walls; price 0 until entered on Admin › Adhesives). "Attached With" reads "Non-DL TPO
Fasteners/Plates" / "EPDM Fasteners/Plates".

**Not done / flagged.** Same phase-2 list as §22.34 (TPO/EPDM-specific accessory variants; the
warranty table is Duro-Last's and does not apply to a non-DL system; induction welding). The
Non-DL Membrane figure rides the Other slot's tax / freight basis like any other purchase.
Migration `20260922120000_non_dl_tpo_epdm.sql`, applied live. Tests: TPO roll-goods × flat price
into `otherMaterial` with `duroLastMaterial` 0 and 27.5 h × 1.25; EPDM 3" lap quantity and 31 h
base; a Non-DL wall (2 ft × 102 ft × $/sq ft) into the same bucket; blank matrix → 0 + warning.

Addendum (same day) — **"Enhancement Necessary" on EPDM.** The Setup flag is the legacy
`frmHome.TestForEnhancement` probe (pull test 350 at a fixed 60" lap). EPDM ships no 60" roll
(120" / 240" only), so the 60" probe found no `mech_fastener_lookup` row (error −2) and flagged
every EPDM bid. Departure: a system whose `TAB_OPTIONS_BY_SYSTEM` list does not offer 60" probes
its narrowest offered width (EPDM → 120"); legacy systems and both TPOs still probe 60".

### 22.36 Membrane item numbers from the roll-goods list (2026-09-22)

Owner: "don't some of these have item numbers in the price sheet? look at the second tab". The
workbook's "Duro-Last Membrane" tab carries **no item numbers** — Description / Mil / Color /
Price per SqFt only — which is why the import matches it by product. The main "Price List" tab
does list the rolls: category "Duro-Last Roll Goods" (40 / 50 / 60 mil × White / Tan / Gray /
Dark Gray, 50 mil also Terra Cotta, each at 5'4" × 100' and 2'8" × 100') and "Duro-Tech (TPO)"
(45 / 60 / 80 mil rolls at 30" / 60" / 120" × 100'). Migration `20260922130000` maps 41 roll
item numbers onto the matrix's Roll Goods and Duro-Tech TPO rows **per colour column** (both
roll widths on the same cell); the Duro-Last Membrane admin screen's Item # column now shows
them (chips wrap; the colour rides each chip, the roll's list description on hover). Tabs /
Parapets rows are prefabricated sheets with no list item. The sheet's "D-FLEECE EV" rows are
Elvaloy fleece — a different product — and were NOT mapped.

Addendum (same day, owner: "are all these Duro-Fleece products lacking a number?"): no — the
first pass missed them. Migration `20260922140000` maps 68 more: Duro-Fleece 50 / 60 mil and
Plus (White, plus Gray / Tan / Dark Gray on the non-Plus rows) and Duro-Tuff 50 / 60 mil in
White / Light Gray → Gray / Light Tan → Tan / Charcoal → Dark Gray, at 30" / 60" / 120" × 100'.
The legacy **Duro-Bond** rows price exactly the Duro-Tuff rolls (White 1.09 / 1.19, colours
1.23 / 1.33 = Duro-Tuff roll $ ÷ area), so the Duro-Tuff item numbers also sit on Duro-Bond 50 /
60 (Duro-Bond 40 has no roll on the list). Unmapped: Patina / Green / Copper / Blue / Red rolls
(no matrix column), 80 mil rolls (no row), 10" stripping rolls. Every mapped roll ÷ area equals
its live cell where one is priced (20 cells checked, 0 mismatches); the Gray / Tan / Dark Gray
Duro-Fleece and Duro-Tuff cells are still 0 until an import (or the admin) fills them.

**Import conversion.** The matrix is $/sq ft and the list prices per roll, so a roll item
mapped onto a membrane cell writes `Round(roll $ ÷ roll area, 2)` — the area from the sheet's
Size cell (`rollAreaSqFt`: `5'4 X 100'` = 533.3, `2'8" X 100'` = 266.7, `10' X 100'` = 1,000;
`guessHeader` now picks the Size column, with a manual pick beside Unit). Verified on the real
workbook: every mapped roll lands on the membrane tab's own figure (40 mil White 1.23 / Tan
1.25; 50 mil 1.36 / 1.37; 60 mil 1.48 / 1.50; TPO 0.75 / 0.84 / 1.30), both widths of a product
agree, and the cell is planned once — the membrane tab's per-sq-ft line wins when the workbook
carries it. A roll line whose Size cell cannot be read is listed under "Membrane roll lines not
converted" and never written as a per-roll price. No prices changed on this import path yet
(mappings only).

### 22.37 Underlayment layout hours — eight truncated product names (2026-09-22)

Owner's Bid total warned "No underlayment layout time for "1/4" DensDeck Prime"". The
`underlayment_layout_mechanical` table was captured from the legacy grid with its truncated
labels — `1/4" DensDeck P...`, `1/2" Securock G...`, `5/8" F/C Sheet R...` (eight rows: DensDeck
Prime 1/4 / 1/2 / 5/8, Securock GFRB 1/4 / 3/8 / 1/2 / 5/8, 5/8 F/C Sheet Rock) — so the exact-name
lookup never hit and those layers billed 0 layout hours. Migration `20260922140000` renames them
to the catalog names; the captured hours (18 / 20 / 25 / 31.82 h per 2,500 sq ft) are unchanged.
Applied live. Not a money-model change: the legacy app matched by product id, not by label.

### 22.38 New-section complexity starts at "Medium" (2026-09-22, owner departure)

Legacy `frmRoofSection` starts a new section at complexity index 2 ("Moderate"). Owner: "complexity
should be defaulted to medium when that box is not greyed out" → a NEW section now starts at
index 3 ("Medium"). Only systems with complexity factors price it (Duro-Tuff 1.2, Duro-Fleece
1.2, the web TPO / EPDM systems 1.4); Duro-Last / Duro-Bond / Duro-Roof ignore it. Saved
sections keep their stored index; a section with NO stored index still bills the legacy 2.

### 22.39 Update Bid Options — legacy `frmHome.btnUpdate_Click` (2026-09-22)

Legacy: the Home ribbon's standing **Update Pricing & Labor** button opens `frmUpdateBidOptions`;
OK runs `btnUpdate_Click` (0x5ad38): (1) `cbMaterialPricing` — save every underlayment's
`SqFtCost.CustomValue`, replace `Estimate.oMgmt` with a fresh copy of `defaultManagement`, restore
the custom values unless `cbUnderQuoteReset`, then `Estimate.UpdateEstimateManagement(underQuoteReset,
ndlLaborRate, ndlUnitPrice, ndlUnitLabor)`; (2) `PreserveLaborTemplate(cbLaborTemplate)` — unticked
keeps the estimate's own template object (manual labor settings untouched), ticked re-selects the
management template by name / id so `LoadEstimate` re-applies its modifiers; (3) hidden
`cbUpgradeMechLabor` (deck-times column 4 → −1; not offered); (4) `cbLatestFormulas` —
`Estimate.FormulasVersion` = the running assembly version.

Web (same button, now a standing black button at the right of the step row; the amber dot marks
management data newer than the bid's frozen copy): **Material pricing** = replace the bid's
`adminSnapshot` + `warrantySnapshot` with the live admin / warranty data (`underlaymentPriceOverrides`
— the web's SqFtCost custom values — live on the bid, so they survive unless **Reset Underlayment
Price Quotes** clears them; Non-DL rows follow legacy `NDLCollectionBase.UpdateManagement` (DataAccess 0xa8334): a
bid's rows are stored COPIES, so an un-ticked field keeps the figure the bid already had and a
ticked one is copied from the current ref row by Description — the web pins each ref row's
un-ticked fields from the OLD snapshot as explicit values before the swap and drops the ticked
fields' overrides (`pinNonDlToRef`; ref labor rate 0 = crew rate is not pinned; custom rows
untouched). Ticked template with a name no longer in management keeps the bid's settings, as
legacy `PreserveLaborTemplate` does. **Labor template** = `applyTemplate(name)` over the
bid's manual %s (sections, parapets, curbs, accessories, setup, inspection). **Latest formulas** =
`SavedBidState.formulasVersion` (new: stamped `CURRENT_FORMULAS_VERSION`; the engine now computes
under `bid.formulasVersion ?? current`, so older saves without a stamp keep computing as before)
re-stamped to the current version; the box is disabled when already current. Nothing is written
until the bid is saved. The pricing box pre-ticks when the snapshot is stale (legacy opens blank).

### 22.40 Fifth underlayment layer (2026-09-22, owner departure)

Legacy `RoofSection._uLayer` holds FOUR layers: `frmUnderlayment` has four "Add Layer" tabs and
`UnderlaymentBaseHours` (0x4c284) loops the layer index `0..3` (`ldc.i4.3 ble`). Owner: "some jobs
need 5 and legacy didn't have that option". The web now allows five (`MAX_UNDERLAYMENT_LAYERS = 5`
in `bid-builder.ts`; `sectionLayers` slices to it, the Underlayment step's table / tabs / stack
visual are generated from it). Nothing else changes: every layer is priced by the same per-layer
rules (§18 — layout time, fastener count, adhesive labor and units, material × 1.03 / 1.06,
substrate derived from the layer below), so a fifth layer bills exactly what legacy would have
billed had its form carried a fifth tab. Test: five "None" layers of 1/2" ISO on 2,500 sq ft =
5 × 7.775 h; a sixth is ignored.

### 22.41 Bid Combiner — legacy `BidAdvantage.BidCombiner` (2026-09-22)

Legacy (Estimator.exe, IL read 2026-09-22): `combineBidsButton_Click` loads each listed .bid file
("Please select two or more bids to combine"), `CombineBids` creates a NEW estimate
(`MainStore.CreateNew` → every estimate-level value from management defaults; the generated
Description says "Base Labor and Item Costs have been set according to management defaults"),
then: `CombineQuotes` re-numbers every source's custom quotes into one pool; `CombineRoofSections`
appends every section (ParentEstimate re-pointed); `ReduceQuotes` re-points the layers at the
re-numbered quotes; `CombineCurbs` / `CombineParapets` append; `CombineAccessories` SUMS the
user-entered quantities by item identity — AccOthers by Description, Corners by RefID per colour
(`QuantityByColor`), Washers / Strainers / Panduit / Vents by part, PipeStacks by Size + Usage +
IsOpen (else added), Drains by boot size + ring size + existing roof type + ReuseRing (else added),
Term Bar `AdditionalNoDrill/PreDrillLength` per colour, Fascia (Item1 = 3", Item2 = 4")
`OtherNoDrill/PreDrillLength`, `StripMasticLength`, vinyl-cover colour quantities,
`MetalCoverLength`, inside / outside corner quantities, Generic edges' `ExtraByColor` / corners /
covers, Two-piece metal `OtherLength` / covers / corners, Sealants by Description;
`UseStripMastic` flags are OR-ed; `CombineMetals` sums Gutters and DownSpouts by PartNumber
(Length + accessory Qty), Pitch Pans and Collection Boxes by RefID; Non-DL goes through
`frmNonDLReconcile` — same Description → `CompareNDLItems` combines the quantities and, when
Labor/Unit or Material Cost differ, asks "Press OK to combine the item quantities or press Cancel
to add the item as a separate entity"; fasteners are NOT carried ("Fasteners have been
recalculated. You will need to enter new quantities for the items highlighted in red on the
Accessories page"); Title "Combined Bid", Description = the warning + one line per source bid
(`"<title>" for <client>, bid by <estimator>`). Everything the estimate DERIVES per job (setup and
inspection hours, shipping, per diem, warranty, markup, commission, calculated fastener / plate /
adhesive quantities, membrane) is therefore computed once from the merged inputs.

Web (`src/lib/combine-bids.ts`, pure; Bids page tick-boxes → **Combine n bids** → `/estimate?combine=
id,id`): the estimator starts as a NEW bid (its fresh defaults = legacy management defaults), loads
the sources and hydrates the merged `SavedBidState`: sections / parapets / curbs appended with ids
`<n>.<old id>`; quote ids re-keyed per source (a quote shared by two sections of one bid still bills
once, two bids' quotes never collapse); `accessoriesCalc`, `metalsCalc`, `nonDlCalc` and the plain
line lists summed exactly as above (`fastenerQty` dropped; every adjust % at the fresh 0);
`membraneAccs.strippingFtBySection` follows the new section ids. Departures: (a) the combined bid's
roof system / attachment / membrane adhesive are the FIRST source's (web sections and parapets
inherit them from the bid; any section or parapet whose source used a different system is stamped
with its own, which is what legacy's per-section RoofSystem already did — money identical); (b)
Non-DL price conflicts are not a modal: the quantities combine (the dialog's OK path), the first
bid's figures are kept and every conflict is listed in the notice; a custom row with a different
price stays a separate line (the Cancel path); (c) pipe stacks also key by colour (the web entry
carries one); (d) the legacy Description text is carried as `SavedBidState.combineInfo` and shown
as a dismissible notice on the estimate (Dismiss removes it from the bid). The combined bid is
unsaved until saved (legacy `NewBid = true`); it has no frozen snapshot, so it prices from live
admin data like any new bid, freezing at first save. Also fixed alongside: hydrating any bid now
moves the new-section / parapet / curb id counters past the ids in use (previously a section added
to a loaded bid could reuse `s1`).

### 22.42 Fire-rated (DensDeck Prime) adhered-layer labor — parity check (2026-09-22)

Owner report: "the fire rated adhesive labor cost seems to be way overcounting", seen on the
Summit Project (Section 10, 80 × 100 Steel deck, Duro-Fleece adhered, complexity Medium, layers
L1 2" ISO None, L2 2" ISO mechanical, L3 1/4" DensDeck Prime adhered with Duro-Grip CR-20; no
perimeter enhancement). No legacy Summit screenshot exists in the Drive "parity comparisons"
folders (searched: summit / fire / adhesive / dens — Knox County only), so the check is IL vs
engine, both re-read today:

- Legacy `UnderlaymentBaseHours` (0x4c284): per layer `AreaTotal × LayoutTime / 2500`
  (`AreaTotal = Length × Width`, 0x4b5a4); adhered → `AreaField × L / 2500 + AreaPerimeter × L /
  2500` where `L = RoofSystem("insulations").AdhesiveLaborRate(1, AdhesiveSubgroup of the nearest
  non-empty layer below, adhesive)` = `RSAdhesiveCoverage.UnderlaymentAdhesiveLabor[subgroup]`
  (bottom layer: `AdhesiveLaborRate(0, DeckType.ID)` = `DeckTypesAdhesiveLabor[deck]`), 0xa274;
  `AreaField = AreaTotal − AreaPerimeter − AreaCorner` (0x4ba54, formulas ≥ 4.0.230); the layer
  total × `ComplexityFactor.SmartValue × SheetSize.SmartSheetMulti`; `UnderlaymentAdjustedBaseHours`
  (0x4cd48) × `(1 + AdjustUnderlaymentLabor / 100)`. The web loop (`bid-builder.ts`, §18) is the
  same expression term for term (`underlaymentAdhesive` = `(field + perim) × labor / 2500`, layout
  on every priced layer, `uScale`).
- Engine run on the saved Summit payload (vite-node, frozen snapshot): 199.932 h underlayment
  labor, no warnings — by hand: L1 8,000/2,500 × 10.775 = 34.48 h; L2 34.48 + 2,500 fasteners
  (Round(8,000/32) × 10, membrane adhered) × 0.462/60 = 53.73 h; L3 8,000/2,500 × 18 = 57.60 h
  layout + 8,000 × 6.5/2,500 = 20.80 h adhesive = 78.40 h; (34.48 + 53.73 + 78.40) × 1.2
  (Duro-Fleece "Medium") = 199.93 h × $45 = $8,996.94. The fire-rated layer is 94.08 h ($4,233.60):
  the adhesive term is 24.96 h of it; the LAYOUT term (69.12 h) dominates because the captured
  legacy layout time for 1/4" DensDeck Prime is 18 h / 2,500 sq ft (Layout & Mechanical grid,
  pale-yellow cell; 2" ISO is 10.775) and the CR-20 labor is 6.5 h / 2,500 sq ft on every substrate
  (Adhesive Times grid).

Conclusion: the web bills the legacy formula on the legacy figures; no over-count is provable from
the app data. Whether legacy's Summit bid showed a different number depends on that install's
own DensDeck Prime layout time / CR-20 labor values (both DualValue custom cells) — the owner's
legacy Summit review screen is needed to go further.

### 22.43 Item numbers come from the Duro-Last price workbook only (2026-09-23)

Owner: "the item numbers should only come from the item column on the Excel price list; the
numbers in Bid-Advantage have not been updated in ages." Migration `20260923010000` drops every
mapping whose number is not on the workbook's "Price List" sheet (13,506 items) — 199 rows, all
from the legacy Part # seed, none ever touched by an import: every adhesive, all CDR rings, conduit
washers, drip edge, gravel stops, termination bars, 128 fasteners / bits, 12 sealants, six fascia
metal covers / corners, five walk pads / wall vents, one dome strainer, ARP. The 229 mappings whose
numbers ARE on the workbook stay (membrane rolls, pipe stacks, drain boots, Panduit, most corners
and drain-boot accessories, some fasteners / sealants / fascia / walk pads). Not a money-model
change: the engine never reads item numbers (they index workbook lines to catalog cells for the
price import, and label stock); catalog prices and the screens' own Part # columns (part of the
row keys) are untouched. Applied live: 428 → 229 rows; the one ledger entry stamped with a dropped
number (1106) had its stamp cleared, quantity unchanged. Of the 406 priced products, 287 now have
no number; the Import price sheet page's gap list proposes a workbook line by name for 45 of them
(name matching, admin confirms each); the rest (underlayment boards, tabs / parapet prefabs,
Non-DL and EPDM membrane rows, most adhesives) have no line on the Duro-Last list under that name
and are mapped by hand when needed.

### 22.44 Per-page access; "Admin" nav group is now "Estimate Pricing" (2026-09-23)

Owner: rename the Admin nav header to Estimate Pricing; a new Admin tab where an admin assigns
each user access to individual pages — Estimate, Inventory, etc. — in any combination; anyone
with Estimate access is offered as an estimator on Setup; without Inventory access they cannot
open Inventory. Model (`src/lib/access.ts`, migration `20260923020000`): `profiles.role` is
`admin | user`; `profiles.access` is the granted pages ⊆ {estimate, pricing, inventory}; admins
reach everything and manage Admin › Users & access. Existing estimator rows became `user` with
estimate + inventory (what they could open before); field rows `user` with inventory. RLS:
`has_access(page)` (SECURITY DEFINER) — bids need `estimate`; ledger inserts need `estimate`, or
`inventory` for leftovers only; the 23 pricing / labor / catalog write policies that were
admin-only follow `pricing`; profiles, inventory settings and ledger deletes stay admin-only.
Server functions mirror it (`assertPageAccess`); the gate sends a user without a page to the
first page they may open; the Setup estimator list is every account with Estimate access. Not a
money-model change.

### 22.45 Inventory phase 2 — the Order list on Review (2026-09-23)

Owner rule: a bid is priced as if it used no inventory; stock only reduces what to buy. The
Review step's rough "Ordering summary" (4×8 board counts, fastener estimates, adhesive units by
coverage — none of it what the bid billed) is replaced by an **Order list** built from the
engine's own billed lines (`src/lib/order-list.ts`): membrane `MembraneWithOverlap` sq ft per
matrix row (the tier the §1 chain picked, via `sectionMembraneDisplayPricing`; flat families
`System - variant`) and colour column; underlayment sq ft per priced board (area × 1.03 / 1.06,
quote layers excluded); Fasteners & Bits boxes from the accessories module's fastener rows (its
`description|subtype` key resolved to the catalog row key); adhesive units from the Adhesives
lines (calc + extras); every other Accessories line matched to its catalog row by name (longest
row label contained in the line, colour column by name; ties on repeated labels go to the 4"
fascia screen's later row). Each line carries the catalog cell stock is keyed by, the ledger's
on-hand figure (pack unit), and To buy = needed − on hand (whole packs for pack units; sq ft and
ft as-is). A line with no catalog row (the uncaptured Two-Piece metal) still lists, marked "no
stock match". Checked on the saved Knox County and Summit bids: 20 lines, 18 matched, the two
unmatched being Two-Piece base / covers. The edge-footage card (terminations, blocking, ARP)
stays as edge footage only. Nothing here touches a price or a bid payload.

### 22.46 Inventory phase 3 — pull from stock on a bid, return, record leftovers (2026-09-23)

The Order list (§22.45) gains **From stock** and **Pull / return**: an estimator with a SAVED
bid pulls up to `min(on hand, needed − already pulled)` of a product onto the job — a ledger
entry `consumed` (negative, `bid_id` set) — and can put it all back (`released`, positive). The
server refuses a pull beyond the shelf's balance and either reason without a bid id; only
Estimate access (or admin) may write them (RLS `inventory_movements_insert`). The list nets the
bid's own pulls: To buy = needed − pulled − what the shelf still covers. "Record leftovers for
this bid" opens Inventory › Record stock with the job preselected (`/inventory?bid=`). Units:
every line now carries the unit the engine bills it in (membrane / underlayment sq ft, fastener
boxes, adhesive packs, term bar / fascia / drip edge / gravel stop runs in ft, their corners
each, sealants per tube, Panduit per bag, ARP / T-Patch per package, vents / corners / pipe stacks
/ drains / walk pads each); stock is netted only when the shelf keeps the product in the same
unit — drip edge and gravel stop are kept by the piece while the bid needs feet, so those show
"shelf in piece" and are not netted (no piece length is captured to convert). The sealant stock
unit is now "tube". No reservation state: a pull is a real ledger movement the moment it is
recorded, so nothing on the shelf can be promised twice. Prices untouched throughout.

### 22.47 Order list: compact, printable, exportable; ordering summary removed (2026-09-23)

The old "Ordering summary (informational)" card is gone (its termination footage is on the
Order list as the Term Bar line; blocking / capstones / ARP auto-price, §8). The Order list is
collapsed by default with a one-line summary ("N products · M to buy"), and has **Print / PDF**
(a clean print page — the browser's Save as PDF) and **Excel** (`xlsx`, numbers kept numeric)
buttons; both carry the bid name, client, job site and print time. Quantities read in the unit
you BUY: "3 box", "7 × 5-gal. Box Set (28 cartridges)", "210 ft". Pack sizes exist only where
the catalog states them — Fasteners/Box, Panduit Parts/Bag, Membrane Accs Parts/Package, the
adhesive unit types — and those lines already round up to whole packs (13 fasteners over a box
→ one more box). Duro-Last sells caulk by the tube (the price list's "CAULK DURO PLUS" lines are
EA at $10.20), so 15 tubes is 15; no case size exists to round to. A per-product "order pack"
for the rest (bars per bundle, pieces per box) is not captured anywhere and would be an admin
entry if wanted.

### 22.48 Order list: To buy counts only inventory actually used (2026-09-23)

Owner: with 5 sq ft on the shelf and 1 needed, To buy read 0 before "Use from inventory" was
clicked. Now To buy = needed − what this bid actually took (ledger `consumed` − `released`),
whole packs for pack units; on hand is shown and limits what can be pulled but is never assumed
used. Also: `bids.updated_by_name` (migration `20260923040000`, applied live) — saveBid stamps
the saver's display name and the Bids page reads "Last saved <when> by <name>".

### 22.49 Setup "6. Notes" per-diem chart; Non-DL custom item Enter → Quantity (2026-09-23)

Owner request. Setup step 6 gains an "Add per diem chart" button: title line "Per diem based on
N men N days" (both fillable), then the legacy job-cost headings on the left (Mobilization,
Supervision, Boom truck, Fork lift, Equipment, Rental equipment, Fuel, Dumpsters / trash,
Security bond, Fringe benefits, Hotel, Food, Porta jon, Mechanical seamer, New cons / multiple
trips, Miscellaneous) with a tick box each and a price input on the right (a price > 0 ticks the
row). Saved as `CustomerInfo.perDiemChart` and printed under the proposal notes. It is
INFORMATIONAL ONLY — it does not feed the engine's Per diem figure, labor, or any total, so bid
money is unchanged (no legacy equivalent exists; nothing to reconcile). Also: on the Non-DL
screens, pressing Enter in a new custom item's name now adds the row and moves focus to its
Quantity box.
