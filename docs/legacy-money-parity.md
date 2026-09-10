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
multiple of 10 → x; otherwise `Ceil(x)` rounded UP to the next multiple of 10 (11 → 20, 10.3 →
20, 1.03 → 10). `In2Ft(i)` = `Round(i/12, 2)`. `Round(x, n)` is VB/.NET `Math.Round` (banker's).
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
  `GetTotalLengthByColor(c) − MetalCoverLength(c)` (ft; White includes both Additional boxes),
  editable; `WhiteCost = R10(whiteQty) × WhiteVinylCoverPrice` (per foot, ten-rounded, NO 1.03),
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
  `Cost = Boxes × (NumberPerBox × Price)`; no labor. The "Boxes" column is the billed unit.
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
