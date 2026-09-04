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
  `wrapSqFt = (2A'+2B' + (2D'+C')) × (B' + 2D' + C')/144` (verbatim stack order);
  multiplier ×2.17777.
- Styles 3 and 4: `cost = -1` (quote required — the app shows these as needs-quote).
- Style 6: `inc2` dims; `wrapSqFt = (2A'+2B') × 30 / 144`; `cost = ((wrapSqFt × rate) + 0.3099 +
  4.8081×1.7819) × 3.04`; if `inc2(dimC) > 18`: `+ ((inc2(dimC)−18) × 2A' + 2B')/144 × 0.3484 ×
  3.04` (verbatim); × qty; `Round(..., 8)`.
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

Still DB-resident, uncaptured (for the record): `lookup_Decktimes` contents and live gutter
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
(`SELECT TabSpacing, DeckType, FastenerSpacing, Value ... FROM lookup_Decktimes` — MySQL), sheet
`NumSheetsReq`, subs/services material row placement at validation.
