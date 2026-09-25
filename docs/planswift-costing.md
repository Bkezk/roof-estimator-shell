# PlanSwift costing version: the rules and the price feed

Companion to `docs/planswift-mapping.md`. That document is the **quantities-only** template
set, which is what Bid-O-Matic imports. This one is for the owner's second ask (Sep 25): a
PlanSwift template set that **also computes quantities and cost inside PlanSwift**, for a number
on the spot before the job reaches the estimator.

## 1. How to keep it honest

The estimator's numbers come from about forty tables (price list, labor combos, fastener
lookups, adhesive coverage, setup and inspection bands, parapet and curb matrices, shipping
steps, tax, markup). A PlanSwift copy is only right on the day it is written, so the rule is:

1. **Bid-O-Matic is the bid.** The PlanSwift total is a field estimate. Every job still goes
   through the import (`planswift-mapping.md`), and the estimator's total is the one quoted.
2. **Generate, don't transcribe.** The costing templates are built from
   `bid-o-matic-feed.json`, an export of the live tables (delivered alongside this document;
   later an "Export PlanSwift feed" button on Estimate Pricing, so it can be regenerated after
   every price import). Nothing in the templates is typed from memory.
3. **Fidelity is labelled.** Each rule below is marked **exact** (the estimator's formula on
   the same inputs), **near** (same formula, one simplification), or **rough** (a stand-in
   the estimator does not use). Where a rule is rough, the PlanSwift part carries a note so
   nobody mistakes it for the bid.

## 2. Inputs the costing items need beyond the quantities set

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

## 3. Geometry PlanSwift must derive

The estimator lays out sheets and rolls on a rectangle with the section's area and perimeter.
From PlanSwift's `[Area]` (A) and `[Perimeter]` (P):

```
half = P / 2
L    = (half + Sqrt(half*half - 4*A)) / 2        ' the longer side
W    = half - L                                   ' the shorter side
AWEO = A + P/2 + 1                                ' = (L+1)(W+1): area with edge overlap
```

If `half*half - 4*A` is negative (a rounder-than-square outline) use `L = W = Sqrt(A)`.

## 4. Roof section parts

### 4.1 Membrane (exact for roll goods and sheets on a rectangle)

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

### 4.2 Install labor (exact chain)

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

### 4.3 Membrane fasteners and plates (exact for the row-style systems)

For Duro-Last, Duro-Roof, Duro-Tuff, Duro-Tech TPO, Non-DL TPO, EPDM on a mechanical attachment:

```
rows   = RoundUp((W + 1) / (TabSpacing / 12))
screws = Round(rows * (L + 1) * 12 / FieldFastenerOC)
plates = screws
```

Screw $ = screws × (Price/Box ÷ Fasteners/Box) of the chosen fastener row; plate $ likewise.
**Near**: the estimator adds perimeter-row fasteners at the perimeter spacing; add
`RoundUp(P * 12 / PerimOC)` screws if the job uses a tighter perimeter spacing.

### 4.4 Underlayment (material exact; labor rough)

Per layer: `sqft = A * 1.03` (`1.06` for Geotextile); material $ = sqft × `Cost/Sq. Ft.`
(feed `pricing_catalog[duro_last:underlayment]`). Boards = `RoundUp(sqft / 32)` for 4×8 boards,
`/ 16` for the `4'x 4'` names. Mechanical layer fasteners: 5 per board (the estimator's default
for a converted legacy layer; its full rule depends on board type and deck and is not in the
feed). Adhesive layer: gallons = `A / coverage_sqft` from feed `adhesive_coverage_deck` (first
layer on the deck) or `adhesive_coverage_underlayment` (a layer on a board group) for the
adhesive id (feed `legacy_adhesive`). Layer labor: **rough**, carry `1.5 h per 1,000 sq ft per
mechanical layer` as a placeholder and label it; the estimator's layout hours come from the
labor template and are not in the feed yet.

### 4.5 Membrane adhesive, adhered systems (exact)

`units = RoundUp(A / coverage_sqft)` per adhesive from `adhesive_coverage_deck` (bare deck) or
`adhesive_coverage_underlayment` (over the top board's group), summed over sections before the
round-up; price from feed `legacy_adhesive.price` per `unit_type`.

### 4.6 Vents (exact)

Systems with `needs_vents` = 1 on a mechanical attachment: `RoundUp(A / 1000)` vents per
section; price from `pricing_catalog[duro_last:vents]` by colour; 0.5 h each
(`accessory_labor[vents]`).

## 5. Edge parts (per `BOM Roof Edge` or per section side at the job default)

| Edge option                  | Material                                                                           | Labor (feed `accessory_labor`)                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `T-Bar`                      | ft × `termination_bars[Color]` (per ft)                                            | `termination_bars`: 0.035 h/ft pre-drill, 0.0175 no-drill       |
| `1-3/4" Fascia`, `4" Fascia` | ft × bar price + vinyl / metal cover per ft (`facia_bars_vinyl_covers`)            | `fascia_bars`: 0.0374 / 0.0187 h/ft (1¾"), 0.0395 / 0.0197 (4") |
| `2" Gravel Stop`, `4" …`     | ft × price (`gravel_stops`, colour column) + corners each                          | `gravel_stops`: 0.0275 h/ft, 0.2 h per corner                   |
| `2" Drip Edge`, `4" …`       | ft × price (`drip_edge`, colour column) + clips / corners                          | `drip_edges`: 0.0275 h/ft                                       |
| `3"…8" 2-pc Metal`           | ft × Non-DL sheet metal price (`non_dl:sheet_metal_work`)                          | `two_piece_metals`: 0.043 h/ft, 0.2 h per corner                |
| `ARP (in)`                   | `1.03 * ((ARP + 6) / 12) * ft` sq ft of membrane at the section's roll-goods price | `membrane_accs[ARP (SqFt)]`: 0                                  |
| Wood blocking                | ft × `non_dl:roof_edge_blocking` row price; labor per unit from the same row       | row `LaborPerUnit` × ft at the row's rate                       |

**Confirm before use**: whether the catalog's fascia / gravel stop / drip edge prices are per
foot or per stick (the estimator's Accessories screens know; the feed rows carry the price
only). The estimator bills pre-drill on Concrete / Gypsum / LWC decks.

## 6. Parapets (`BOM Parapet Wall`)

- Material sq ft = `(Length + 1 + Pieces) * Girth / 12`, Girth = skirt + cant + vertical + wall
  top + drop in inches (default skirt 6 + `Height`); price = the mil's `Parapets` row, colour
  column. **Exact.**
- Labor hours = `Length / 50 * rate`, rate from feed `labor_parapet` by `Parapet: Deck`, the
  height band from `Height` (`0"-30"`, `31"-48"`, `49"-72"`, `73"-99"`, `100"+`), and
  pre-drill × canted (`no_drill_no_cant`, `no_drill_canted`, `predrill_no_cant`,
  `predrill_canted`). **Exact.**
- Slipsheet: `Height * Length * 1.25` sq ft × $0.01375 and 0.25 h per 100 sq ft. **Exact.**
- Wall adhesive (adhered walls): sq ft ÷ `adhesive_wall_coverage.coverage_sqft`. **Exact.**

## 7. Curbs (`BOM Curb`)

- Labor minutes per curb = `labor_curb.setup_minutes + labor_curb_deck[Deck].minutes * labor_curb_type[Type].multiplier * PerimeterFt`, Perimeter = `2 * (Width + Length) / 12`; hours = minutes × qty ÷ 60. **Exact.**
- Wrap material = `PerimeterFt * (Height + 6) / 12` sq ft at the mil's `Parapets` row. **Near** (the estimator's wrap model has six legacy styles; this is style 1, Open).
- Curb ISO (if insulated): `RoundUp(Σ Round((Width + Length) / 6, 8) * qty)` sq ft at $0.30 (feed `non_dl:others` row 2). **Exact.**

## 8. Counts

| Item             | Material                                                                                           | Labor                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOM Drain`      | boot (`drain_boots`, + `+ for Color` if coloured) + ring (`cdr_rings`) per drain, 0 if reuse rings | `drain_roof_types[Existing Roof]` area-prep hours + boot hours (`drain_boots` labor) or reinstall hours if reuse. **Exact.**                               |
| `BOM Pipe Stack` | `pipe_stacks` row by size, colour column                                                           | usage multiplier (`pipe_stack_usages`: Plumbing 0.5, Hot Stack 1, Pitch Pan 1.5) × the stack's base hours in `accessory_labor` (**confirm** the base row). |
| `BOM Vent`       | see §4.6                                                                                           |                                                                                                                                                            |
| `BOM Walk Pad`   | `walk_pads_wall_vents` row                                                                         | `accessory_others`: 0.5 h each                                                                                                                             |
| `BOM Scupper`    | Non-DL sheet metal row                                                                             | row `LaborPerUnit`                                                                                                                                         |

## 9. Job-level lines (exact)

- Setup hours = `Max(labor_setup.minimum_hours (16), RoofSqFt × labor_setup_steps band multiplier (0.003))`.
- Inspection hours from `labor_inspection_steps` by roof sq ft: 0→5 h, 5,001→7, 10,001→10, 20,001→13, 50,001→16, 100,001→19, 150,001→23.
- Material before tax = every material line. Tax = material × 0.0625 (material only). Shipping from `shipping_steps` by material $: 0→$800, 5,001→975, 7,500→1,050, 10,000→1,100, 15,001→1,200, 20,001→1,300, 40,001→2,000, 80,001→2,600, 120,001→3,300, 170,000→4,000.
- Labor $ = Σ hours × crew rate. Cost = material + tax + shipping + labor. Price at gross profit 35 % = cost ÷ 0.65.

## 10. Not modelled in the costing version

Tear-off and disposal, perimeter / corner zone labor and material tiers, Duro-Tuff custom rows,
quote-only boards (Flute Filler, Tapered, ISO-Rigid), complexity factors, high-wind warranty
upcharges, per diem and commission, metals (gutters, coping) beyond 2-pc edge metal, the
Non-DL custom lines. Each of these exists in Bid-O-Matic and is why the import remains the bid.
