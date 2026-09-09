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
  `ISO_Labor = Round((0.25 + LinealFt × 0.0167) × qty, 2)`;
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
  UnderlaymentCost`, rva 0x4bcc4): `length × width × 1.06 × $/sqft` (6% waste), or × **1.03** for
  the board named "Geotextile". PORTED (2026-09-04): the web engine now bills area × waste ×
  price (1.03 keyed on the exact board name "Geotextile", case-insensitive).

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
tubes `Ceil(Ceil(length)/40)`.

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
  intermediate tabs; `AdheredSystem` → one tab at 60" when vert' > 59. (vert' = `Round6Inch`:
  >102 → 102; ≤30 → as-is; else nearest 6" of (v+2), except values just above 30 that would
  round DOWN to 30 stay as-is.) The remaining height + wrap fills the last tab.
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
- `DeckFasteners` (= ToInt32(AdjustedLength)) has NO consumers — dead code.

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
- **Capstone masonry** (§8.4): remove = Ceil(Σ option-1 CapstoneLength/2) on "Remove Only";
  reinstall = Ceil(Σ option-2 /2) on "Replace Capstones" (verbatim: option-2 walls feed reinstall
  ONLY). Option-2 sealant tubes (Ceil(Ceil(len)/40)) stay an ordering quantity — the sealant
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
