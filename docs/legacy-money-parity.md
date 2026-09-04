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
  Tab-tier zone pricing is DuroLastSystem logic and is scoped to Duro-Last; the other systems'
  own MaterialCost implementations (DuroTuffSystem rva 0x18915-area, DuroRoofSystem rva 0xd724,
  DuroBond/DuroFleece) are NOT ported — those systems stay roll goods.

## 2. Curb membrane material (`Curb.Cost`, rva 0x32e3c)

Curbs bill membrane as a **self-contained prefab-wrap model hardcoded in code** — it does NOT use
`lookup_DuroLastPrices`. Components:

- Wrap rate $/sqft, hardcoded by thickness × color (colors 1..4 in BAColor order; capture-era
  prices): 40mil → 0.3481/0.3481/0.3481/0.3544; 50mil → 0.45/0.45/0.45/0.471875;
  60mil → 0.5625/0.5625/0.5437/0.5906. Other thickness/color → rate 0.
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
these constants (2020-vintage baked-in pricing). Port as defaults with the constants surfaced as
data, or keep manual entry — either way validation bids will price curbs through this model.

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
  - `AdjustedSqFt` (rva 0x4217c), non-Duro-Tuff: `AdjustedHeight × AdjustedLength`. (Duro-Tuff:
    `Ceil(Ft2In(AdjustedHeight)/24) × 30 × AdjustedLength` — 24" panels billed 30" each.)
- Web-engine divergences settled: parapet girth × length was priced at roll goods with no
  Ceil/AdjustedLength; legacy uses the Parapets tier, whole-inch girth, and length+1+pieces.

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
  the board named "Geotextile". The web engine bills area × price with no waste factor —
  divergence flagged for wiring (not changed in this pass; needs the board-name join decision).

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
