/**
 * Bid builder (Phase 5) — maps the estimator UI's simple bid model onto the engine's EstimateInputs,
 * pulling prices and labor multipliers from the assembled admin data. Pure and tested; the UI holds
 * the bid state and calls this before computeEstimate.
 *
 * v1 SIMPLIFICATIONS (documented, to lift as we go):
 *  - One roof system + attachment for the whole bid (the orchestrator takes one admin table set).
 *  - Roll-goods membrane: material sq ft = AreaWithEdgeOverlap (the simple edge-overlap path); the
 *    full roll-goods perimeter geometry (§2.2) is not applied.
 *  - Perimeter/corner enhancement zones: areas are carved from the field by
 *    length × enhancement-width (§2), billed at the perimeter/corner rate. With per-side edge
 *    definitions the perimeter length derives from the perimeter-marked edges, and ARP edges feed
 *    the §2.3 ARPSqFt slot; corner sizing is still entered. Termination hardware footage is a
 *    display-only ordering summary (no auto-pricing until a captured bid validates the join).
 *  - On-center spacing per section (fastenerOc) is entered or auto-filled from the extracted
 *    pull-test lookup (fastener-spacing.ts); it feeds customFieldFastenerSpacing so the engine's
 *    OC lookup is bypassed.
 *  - Freight wired: percent-of-material or the stepped "from" table (strict >), on the material
 *    total before tax (dMaterial[20]). Membrane tier per legacy: roll-good sheet → roll goods;
 *    tab sheets → field share at the fieldLap tab tier (zones unpriced at default -1 laps).
 *  - Tear-off labor wired from the seeded Tearoff Times table (per deck × tear-off type).
 *  - Insulation layers wired (§4.3, up to 4 per section): board material → dTotals[6]; mechanical
 *    labor per the app's header formula (layout hrs/2500 + fastener min × count/board); adhesive
 *    units = area ÷ coverage, summed per adhesive across the estimate and Ceilinged ONCE per
 *    adhesive (legacy AggregateCalcQtys) → whole units × price into M0; labor at hrs/1000 sqft
 *    (scale CONFIRMED from the binary — RSAdhesiveCoverage.HoursPerKSqFt).
 *    A legacy single underlaymentBoard converts to one mechanical layer (5 fasteners/board).
 *  - Setup & inspection hours wired from the seeded band tables (§2.4/§2.5) when present; they roll
 *    into direct labor. The per-estimate Adjust Setup/Inspection % knobs are exposed and composed
 *    multiplicatively with the labor-template factors.
 *  - Accessory material wired: a bid carries accessory line items (description + snapshot price +
 *    quantity); the total folds into M0. Accessory LABOR is wired too: each line carries per-unit
 *    hours (prefilled from the accessory_labor single-hours screens where an exact description
 *    matches, else entered); Σ(hrs × qty) folds into direct labor. Per-foot / drill-variant /
 *    fastener-derived accessory labor is entered manually until a captured bid validates it.
 *  - Non-DL catalog lines wired and routed by category: six categories → OtherMaterial +
 *    own-rate direct labor; Subcontractors / 3rd Party Services → LaborSubtotal2 whole
 *    (labor + material); uncategorized legacy lines keep the old services routing.
 *  - Exceptional Metals wired: line items (unit cost + labor/unit × own rate); material → M0,
 *    labor → DIRECT labor at the line's own rate (legacy dLabor[5] in LaborSubtotal1; hours join
 *    man-days). Gutter prices are largely $0 pending live capture (flagged).
 *  - Parapets wired: labor = (length/50) × the seeded deck × height-band × drill/cant matrix
 *    → direct labor; material per legacy MembraneCost (Parapets tier, Ceil(girth) inches,
 *    length+1+pieces, Round2 per wall; Duro-Tuff 24"-panel variant) → M0. Girth derives from the
 *    legacy profile dims (Skirt/Cant/Vertical/WallTop/Drop); wall adhesive bills on
 *    WallPlusTopSqFt = Length × (Vertical+WallTop)/12. Height band is still picked by hand.
 */

import {
  duroTuffMembraneCalc,
  legacyMembraneWithOverlap,
  sheetRollsFromLabel,
  tearOffVolume,
} from "./quantities";
import { in2Ft, bankersRound, goodSingle } from "./rounding";
import { universalFastenerSpacing, type MechFastenerRow } from "./fastener-spacing";
import { directLookup } from "./labor";
import {
  computeAccessories,
  normalizeAccessoriesState,
  parapetEdgeFastenersCount,
  type AccessoriesState,
  type AccessoriesResult,
} from "./accessories";
import { computeMetals, normalizeMetalsState, type MetalsState, type MetalsResult } from "./metals";
import {
  computeNonDl,
  normalizeNonDlState,
  parseInches,
  type NonDlGeometry,
  type NonDlGroup,
  type NonDlResult,
  type NonDlState,
} from "./nondl";
import { curbWrapCost, curbWrapRate } from "./curb-wrap";
import {
  edgePerimLength,
  edgeSideIndex,
  edgesArpSqFt,
  effectiveCorners,
  resolveSectionZones,
  type EdgeInput,
  type PerimCorners,
} from "./edges";
import { underlaymentLayerFasteners } from "./underlayment-fasteners";
import {
  membraneMaterialCost,
  membraneZoneShares,
  priceMatrixLookup,
  selectMembranePriceTier,
  shippingTotal,
  freightStepped,
  freightPercent,
  type PriceTier,
} from "./pricing";
import { CURRENT_FORMULAS_VERSION } from "./version";
import type { EstimateInputs, RoofSection, Attachment } from "./estimate";
import type { MarkupMode } from "./money";
import {
  TEAROFF_DECK_BY_LABOR_DECK,
  UNDERLAYMENT_DECK_BY_LABOR_DECK,
  parapetModeRate,
  curbLaborHours as curbHoursCalc,
  deriveAdhesiveSubstrate,
  parapetBandForVertical,
  underlaymentAdhesive,
  LEGACY_RS_ID_BY_NAME,
  type EngineAdminData,
  type NdlAutoRateItem,
} from "./adapters";

/**
 * One insulation/underlayment layer on a section (§4.3, up to 4). Mechanical bills the app's own
 * header formula (layout hrs/2500 + fastener minutes × count); adhesive bills area ÷ coverage units
 * of adhesive (whole-unit rounding happens per adhesive at the estimate level) + labor at
 * hrs/1000 sqft (confirmed scale).
 */
export interface UnderlaymentLayer {
  board: string; // from the Underlayment prices screen (or a NeedQuote entry when quoted)
  /** Legacy Attached With: mechanical, an adhesive, or "none" (layout labor only, no fasteners). */
  /**
   * "durobond" = the legacy "Section Fastened w/ Durobond" option (docs §22.17): the board is
   * held by the membrane's induction plates, so the layer bills LAYOUT LABOR ONLY — no
   * per-board fastening, no adhesive; the plate fastening is in the Duro-Bond section labor.
   */
  attachment: "mechanical" | "adhesive" | "none" | "durobond";
  /**
   * LEGACY-WEB FIELD, no longer priced: the legacy fastener count is a rule of the board's
   * SubType and the membrane attachment (docs §18; override via Enhancement Options). Kept so
   * older saved bids stay valid; 0 on new layers.
   */
  fastenersPerBoard: number;
  adhesiveName: string; // adhesive: from the Adhesive Times table
  /**
   * adhesive: the Adhesive Times substrate row. The engine DERIVES it (deck type for the bottom
   * layer, the board below's adhesive group otherwise — legacy behaviour) and only falls back to
   * this stored value when it cannot (older bids / unknown groups).
   */
  substrate: string;
  /**
   * Legacy custom-quote layer (docs §10.5/§10.7 — NeedQuote entries: Flute Filler,
   * Tapered/Other, ISO/Rigid Quote). Bills the QUOTED amounts VERBATIM, IL-exact per §10.7:
   * material = LumpSum (piece mode keeps LumpSum = pieces × cost/piece), NO waste factor, into
   * the underlayment-material slot (legacy dMaterial[5] — the same bucket priced boards use);
   * labor = LaborUnits normalized to hours (days × HoursPerDay) into underlayment labor at the
   * crew rate. A quote ID shared across sections bills ONCE (legacy CustomQuotes dedup set).
   * No auto fasteners; adhesive over tapered groups uses quoteAdhesiveUnits (§10.7 target 3).
   */
  quote?: {
    /** Shared quote identity: the same id applied to several sections bills once. */
    id?: string;
    name: string;
    /** false/absent = Lump Sum Quote; true = Piece Quote (pieces × cost per piece). */
    pieceMode?: boolean;
    lumpSum?: number;
    pieces?: number;
    costPerPiece?: number;
    /** Labor "Total Amount" — hours, or days when laborInDays. */
    laborAmount?: number;
    laborInDays?: boolean;
  };
  /**
   * Legacy QuoteAdhesiveUnits (docs §10.7 target 3): when THIS adhered layer sits over a board
   * whose AdhesiveGroupID ∈ {16 Tapered ISO, 18 Tapered Rigid, 19 Crickets/Other}, the coverage
   * formula is skipped and this raw container count bills verbatim.
   */
  quoteAdhesiveUnits?: number;
}

/** Adhesive groups whose surface can't be auto-covered (legacy AdhesiveNeedsQuoteAdhesiveUnits). */
export const QUOTE_ADHESIVE_GROUPS: ReadonlySet<number> = new Set([16, 18, 19]);

/**
 * The legacy "Calculate Pieces" flute-filler calculator (frmFluteFillerCalc.calculateButton_Click,
 * rva 0x24a00, re-read 2026-09-21 — docs §22.18). "Pieces are calculated assuming that the
 * Width side runs from Ridge to Gutter": the flutes run along the width, so per section
 * (inches; secLen = Round(Length) × 12, secWid = Round(Width) × 12, ff = piece length ft × 12,
 * r2r = ridge-to-ridge inches):
 *   across = Round(secLen / r2r)                      — flute rows across the LENGTH
 *   x = secWid / ff; rows = Round(x + (1 − frac(x)))  — pieces per flute row, partial rounded up
 *   trim = frac(x) < 0.5 ? Round((1 − frac(x)) × across) : 0   — short remainders dropped
 *   pieces += Round(across × rows − trim)
 * With waste: Ceil(total × (1 + plus/100)). Knox County: 188 × 182, 8 ft pieces, 12" ridges →
 * 188 × 23 = 4,324 — the owner's legacy quote. (The first transcription keyed `across` on the
 * piece length and inverted the trim test; it produced 182.)
 */
export function fluteFillerPieces(i: {
  sections: Array<{ lengthFt: number; widthFt: number }>;
  pieceLengthFt: number;
  ridgeToRidgeIn: number;
  wastePct?: number;
}): { pieces: number; piecesWithWaste: number } {
  const ff = i.pieceLengthFt * 12;
  if (ff <= 0 || i.ridgeToRidgeIn <= 0) return { pieces: 0, piecesWithWaste: 0 };
  let total = 0;
  for (const s of i.sections) {
    const secLen = bankersRound(s.lengthFt, 0) * 12;
    const secWid = bankersRound(s.widthFt, 0) * 12;
    const across = bankersRound(secLen / i.ridgeToRidgeIn, 0);
    const x = secWid / ff;
    const frac = x - Math.floor(x);
    const rows = bankersRound(x + (1 - frac), 0);
    const trim = frac < 0.5 ? bankersRound((1 - frac) * across, 0) : 0;
    total += bankersRound(across * rows - trim, 0);
  }
  return {
    pieces: total,
    piecesWithWaste: Math.ceil(total * (1 + (i.wastePct ?? 0) / 100)),
  };
}

export interface BidSectionInput {
  id: string;
  name: string;
  /** Free-text estimator notes for this section (persisted with the bid; not priced). */
  notes?: string;
  length: number;
  width: number;
  deckType: string; // e.g. "Wood"
  thickness: number; // 40 / 50 / 60
  color: string; // e.g. "White"
  fieldLap: number; // tab lap inches
  fastenerOc: number; // field on-center inches (entered, or auto-filled from the pull-test lookup)
  /** Pull test (lbs) — UI-level input for the MechFastenerLookup autofill; 0/absent = manual OC. */
  pullTest?: number;
  /** Wind design table (psf, 60–210); keys the pull-test lookup. Default 60. */
  designTable?: number;
  // perimeter / corner enhancement zones (§2)
  perimLengthFt: number; // total perimeter enhancement edge length
  cornerLengthFt: number; // total corner enhancement length
  enhancementWidthFt: number; // zone depth in from the edge (e.g. 3)
  perimFastenerOc: number; // tighter OC in the perimeter zone
  cornerFastenerOc: number; // tighter OC in the corner zone
  /** Custom perimeter-zone lap (in). Absent/-1 = legacy default: the perim share is unpriced. */
  perimLap?: number;
  /** Custom corner-zone lap (in). Absent/-1 = legacy default: the corner share is unpriced. */
  cornerLap?: number;
  /**
   * Duro-Tuff mechanical "Use Custom Spacings" (legacy frmRoofSectionAdv `grpDTCustomSettings`,
   * docs §22.15): present = RoofSection.UseCustomSettings. `rows` = NumCustomRows(0 / 1) of the
   * FIXED 30" outer / 60" inner rows (the form's width boxes are disabled at "30" / "60"),
   * `perimOc` / `cornerOc` = Custom{Perimeter,Corner}FastenerSpacing(0 / 1), `fieldLapIn` =
   * CustomFieldLap (a RollGoodWidths pick; absent = −1), `fieldOc` = CustomFieldFastenerSpacing
   * (absent = the section's Fastener OC).
   */
  tuffCustom?: {
    rows: [number, number];
    perimOc: [number, number];
    cornerOc: [number, number];
    fieldLapIn?: number;
    fieldOc?: number;
  };
  underlaymentBoard: string; // LEGACY single board ("" = none); superseded by `layers`
  /** Insulation layers (up to 4). When absent, a legacy underlaymentBoard converts to one layer. */
  layers?: UnderlaymentLayer[];
  /**
   * Per-side edge definitions (A–D). When present: perimeter-marked edges drive the perimeter
   * length (kept in sync with perimLengthFt by the UI) and ARP edges feed the §2.3 ARPSqFt slot.
   * Termination/blocking footage is an ordering summary only (no auto-pricing until validated).
   */
  edges?: EdgeInput[];
  /**
   * Legacy IsPerimCorner(0..3): corner i sits between side i and side i+1 (0 = A∧B … 3 = D∧A)
   * and only counts while both sides are perimeter edges (docs §16). Each marked corner adds one
   * enhancement-width square to the corner zone and removes it from BOTH adjacent perimeter
   * runs. Absent = no corner data (older bids keep their manual cornerLengthFt).
   */
  perimCorners?: PerimCorners;
  /**
   * Per-section Roof System / Attached With / adhesive (legacy: RoofSystem and the attachment
   * systems are section properties; the Home > Defaults panel only seeds new sections). Absent =
   * the bid-level values, which stay the defaults for new sections.
   */
  roofSystem?: string;
  attachment?: Attachment;
  membraneAdhesiveName?: string;
  /**
   * Per-section AdjustLabor % delta (legacy RoofSection.AdjustLabor; the estimate-level adjust
   * writes every section's value, the section's Labor link edits one). Absent = bid-level.
   */
  adjustLaborPct?: number;
  /**
   * Legacy Complexity (ComplexityID 0 Open … 5 Extreme; default 2 Moderate). Only roof systems
   * with RSComplexityFactor rows (Duro-Tuff, Duro-Fleece) have a factor ≠ 1; for the others the
   * legacy combo shows "None" (1.0) — see `sectionComplexityFactor`.
   */
  complexity?: number;
  /**
   * Legacy Quick Bid (default true) vs "Enter D/L Roof Sheets": a non-quick-bid section derives
   * its average sheet size from its area (RoofSection.get_SheetSize) and hides the perimeter
   * edge options.
   */
  isQuickBid?: boolean;
  /**
   * Legacy Enhancement Options (docs §10.3, frmUnderlaymentAdv): custom MECHANICAL fastener
   * densities in fasteners per sq ft, applied per zone to every mechanical layer:
   * count = Round(field × AreaField) + Round(perim × AreaPerimeter) + Round(corner × AreaCorner)
   * (banker's Round, per layer — replaces the default per-board density). Absent = default.
   */
  uCustomFastenerDensity?: { field: number; perim: number; corner: number };
  /**
   * Legacy custom adhesive RIBBON spacing — FIELD zone (inches, docs §10.3 / §22.6,
   * `UCustomAdhesiveSpacing(0)`): adhered-layer adhesive units × ToInteger(12 / spacing)
   * (banker's; default ×1). Absent/0 = default coverage.
   */
  uAdhesiveSpacingIn?: number;
  /**
   * PERIMETER + CORNER zone ribbon spacing (`UCustomAdhesiveSpacing(1)`). Legacy applies the
   * custom multipliers only when BOTH spacings are set; absent here = the field spacing (the
   * web's single-entry form).
   */
  uAdhesiveSpacingPerimIn?: number;
  /**
   * Per-section AdjustUnderlaymentLabor % (legacy Underlayment screen "Adjustable Labor for
   * selected Roof Sections" link; the labor template writes the same field). Absent = the labor
   * template's Underlayment Labor factor. Quote labor is never adjusted (legacy).
   */
  adjustUnderlaymentLaborPct?: number;
  /**
   * Per-section TO_Additional % (legacy RoofSection.TO_Additional — an INTEGER percent seeded
   * from the labor template's Tear-Off Labor on section creation / template change; no other
   * legacy UI writes it). Absent = 0.
   */
  tearOffAdditionalPct?: number;
  sheetSizeLabel: string; // e.g. "1500 sf"
  tearOff: boolean;
  tearOffType: string; // e.g. "BUR < 2\"" (from the Tearoff Times table)
  toThicknessInches: number;
}

/** An accessory line on a bid: price snapshotted from the catalog when added. */
export interface AccessoryLine {
  description: string;
  price: number;
  quantity: number;
  /** Install labor hours per unit (prefilled where known, else entered); folds into direct labor. */
  laborHoursPerUnit?: number;
}

/**
 * A non-Duro-Last catalog line (Sheet Metal Work, Blocking, Subcontractors, Services, …). Each unit
 * carries a material Price and a labor component (LaborPerUnit hours × its own Labor Rate $/hr),
 * snapshotted when added. Routing is per `category` — see that field's doc.
 */
export interface NonDlLine {
  description: string;
  /**
   * Curated catalog category (exact string from the seeded non-DL screens). Routes the line per
   * the legacy split (docs/legacy-money-parity.md §6): Subcontractors / 3rd Party Services →
   * LaborSubtotal2 (labor AND material); every other category → material into OtherMaterial and
   * labor into own-rate DIRECT labor (dLabor[14..19]). Absent on older saved lines → the previous
   * web routing (material → OtherMaterial, labor → services) is preserved.
   */
  category?: string;
  price: number; // material $/unit
  laborPerUnit: number; // labor hours/unit
  laborRate: number; // $/hr for this line's labor
  quantity: number;
}

/** Non-DL categories whose whole cost (labor + material) belongs to LaborSubtotal2. */
export const NON_DL_LS2_CATEGORIES: ReadonlySet<string> = new Set([
  "Subcontractors",
  "3rd Party Services",
]);

/** Curated non-DL catalog category → legacy ReviewCalc.NonDL group slot (docs §14.3 / §22.2). */
const NDL_SLOT_BY_CATEGORY: Record<string, number> = {
  "Roof Edge Blocking": 1,
  "Parapet Wall Blocking": 1,
  "Structural Deck Materials": 2,
  "Sheet Metal Work": 3,
  Masonry: 4,
  "Preset Custom Applications": 5,
};
/** §14 module group → legacy ReviewCalc.NonDL group slot (subs/services are LaborSubtotal2). */
const NDL_SLOT_BY_GROUP: Record<Exclude<NonDlGroup, "services" | "subcontractors">, number> = {
  roofEdgeBlocking: 1,
  wallBlocking: 1,
  deckMaterials: 2,
  sheetMetal: 3,
  masonry: 4,
  customApps: 5,
  others: 6,
};

/**
 * LEGACY QUIRK (ReviewCalc.Recalculate rva 0x4550c, docs §22.4): the six NonDL groups fill
 * dLabor[14..19], then Setup labor is written to dLabor[19] — the Others group's row — before
 * LaborSubtotal1 sums dLabor[0..21]. The Others group's labor cost and hours are therefore
 * dropped from Labor Subtotal 1 and man-days in the shipped Bid-Advantage. Reproduced for parity;
 * flip to `false` to bill that labor (a deliberate departure from legacy).
 */
export const LEGACY_NDL_OTHERS_LABOR_DROPPED = true;

/**
 * A parapet wall on a bid (§4.4/§5.3). The height BAND is picked from the seeded band list. Wall
 * geometry follows the legacy profile dims (Skirt/Cant/Vertical/WallTop/Drop, inches): girth =
 * their sum, and the wall-adhesive basis is legacy WallPlusTopSqFt = Length × (Vertical +
 * WallTop)/12. When the dims are absent (older saved bids), the entered girthInches carries the
 * girth and wall adhesive falls back to the full-girth stand-in those bids priced with. Labor is
 * exact per the seeded matrix: (AdjustedLength/50) × hrs-per-50-LF[deck][band][drill×cant]
 * (AdjustedLength = length + 1 + pieces — the legacy BaseManHours basis, docs §8.5). Material
 * prices at the PARAPET's own membrane thickness/color when set (legacy Membrane Options,
 * docs/legacy-money-parity.md §8.5), else the bid default (first section's), Parapets tier.
 */
export interface ParapetInput {
  id: string;
  name: string;
  lengthFt: number;
  heightBand: string; // picked from the seeded wall-height bands
  deckType: string; // labor deck name (Wood/Steel/…), bridged via TEAROFF_DECK_BY_LABOR_DECK
  predrill: boolean;
  canted: boolean;
  girthInches: number; // membrane girth over the wall profile (fallback when dims are absent)
  /** Number of wall pieces (legacy Pieces, default 1): AdjustedLength = length + 1 + pieces. */
  pieces?: number;
  /**
   * Per-item labor adjustment percent (legacy AdjustLabor, the "Labor: X h (Y%)" link — docs
   * §8.7): the item's ENTIRE hours × (1 + pct/100). 0/absent = unchanged; below-zero allowed.
   */
  adjustLaborPct?: number;
  /**
   * Legacy "Use Slipsheet" (UsePlastic, docs §8.6): polyethylene = AdjustedHeight × Length ×
   * 1.25 sq ft — labor 0.25 h / 100 sq ft is auto-priced; the material is an NDL item (rate
   * DB-resident), so the sq ft stays an ordering quantity.
   */
  useSlipsheet?: boolean;
  /** Per-parapet membrane mil (legacy Membrane Options); absent = bid default. Docs §8.5. */
  thicknessMil?: number;
  /** Per-parapet membrane color (legacy Membrane Options); absent = bid default. Docs §8.5. */
  color?: string;
  /**
   * Legacy "Wood Blocking on Top of Wall" (docs §8.4): CalcQty on the TopOfParapet NDL item =
   * Ceil(Σ Length × 1.03) across blocked walls — the item is LABOR-ONLY in the legacy collection
   * (TotalCost = LaborCost; its material price is ignored).
   */
  hasBlocking?: boolean;
  /**
   * Legacy capstone option (docs §8.4): 0/absent none, 1 Remove Only, 2 Remove & Reinstall.
   * Remove qty = Ceil(Σ option-1 CapstoneLength / 2) on Masonry "Remove Only"; reinstall qty =
   * Ceil(Σ option-2 CapstoneLength / 2) on "Replace Capstones" (verbatim legacy: option-2 walls
   * feed the reinstall item ONLY, not the remove item). Option 2 also totals sealant tubes
   * (Ceil(Ceil(len)/40)) as an ordering quantity (its item/rate is not modeled yet).
   */
  capstoneOption?: number;
  /** Capstone length (ft); absent = the wall length (legacy default). */
  capstoneLengthFt?: number;
  /**
   * Legacy parapet ARP size (inches; 0/absent = none). ARPSqFt = ((size + 6) / 12) ×
   * (ARPLength == Length ? AdjustedLength : ARPLength) — NO ×1.03 waste and NO membrane
   * deduction on the parapet side (docs §8.6; both differ from the section §2.3 formula).
   */
  arpSizeIn?: number;
  /** Parapet ARP length (ft); absent = the wall length (which bills at AdjustedLength). */
  arpLengthFt?: number;
  /**
   * Parapet Termination tab (§12.6): the termination id (2 T-Bar, 3/4 fascia, 5/9 gravel,
   * 6/10 drip, 7/8/11–14 two-piece; 0/absent = none). Feeds the §12.2 accessory footages only —
   * no direct money.
   */
  termOptionId?: number;
  /** Termination length (ft); absent = the wall length (legacy default, auto-shifting). */
  termLengthFt?: number;
  /** §12.6 "Use Term Bar on Base": adds Round(Length) ft of WHITE term bar (drill by WallType). */
  useTermBarOnBase?: boolean;
  /**
   * Legacy Membrane Options (frmParapets): the wall's OWN Roof System / Attached With /
   * adhesive. Absent = the bid-level values. Attachment drives the labor key (non-mechanical
   * walls key WallType 4), wall adhesive (adhered walls only) and the edge-fastener tab model.
   */
  roofSystem?: string;
  attachment?: Attachment;
  membraneAdhesiveName?: string;
  /** Legacy wood-blocking length (txtWoodLength): persisted, never priced (docs §8.4). */
  blockingLengthFt?: number;
  /** Free-text notes (legacy Notes link). */
  notes?: string;
  /** Legacy WallType (Setup "2. Wall Type"): 1 = Wood or Metal (no-drill), 4 = Brick or Concrete. */
  wallType?: number;
  // Legacy wall profile dims (inches); girth derives as their sum when any is present.
  skirtInches?: number;
  cantInches?: number;
  verticalInches?: number;
  wallTopInches?: number;
  dropInches?: number;
}

/** True when the wall carries the legacy profile dims (vs a directly entered girth). */
const parapetHasDims = (p: ParapetInput): boolean =>
  p.skirtInches !== undefined ||
  p.cantInches !== undefined ||
  p.verticalInches !== undefined ||
  p.wallTopInches !== undefined ||
  p.dropInches !== undefined;

/**
 * Legacy cant flag (§8.5): the labor lookup keys `Cant > 0`, not a separate toggle — so when the
 * wall carries profile dims, canted follows the Cant dimension; the manual toggle only drives
 * walls saved girth-only (pre-dims bids).
 */
export const parapetEffectiveCanted = (p: ParapetInput): boolean =>
  parapetHasDims(p) ? (p.cantInches ?? 0) > 0 : p.canted;

/**
 * Legacy drill flag (§8.5): the labor lookup keys WallType — mechanical attachment uses the
 * wall's own WallType (1 Wood/Metal → no-drill, 4 Brick/Concrete → pre-drill); every other
 * attachment keys WallType = 4 (pre-drill) FIXED. The manual toggle only drives walls with no
 * WallType saved (pre-Termination-tab bids).
 */
export const parapetEffectivePredrill = (p: ParapetInput, attachment: Attachment): boolean =>
  p.wallType !== undefined ? attachment !== "mechanical" || p.wallType === 4 : p.predrill;

/** Membrane girth (in): Skirt+Cant+Vertical+WallTop+Drop when dims are present, else girthInches. */
/** A parapet's effective roof system / attachment / adhesive (wall override, else bid). */
export function resolveParapetSystem(
  bid: Pick<BidInput, "roofSystem" | "attachment" | "membraneAdhesiveName">,
  p: Pick<ParapetInput, "roofSystem" | "attachment" | "membraneAdhesiveName">,
): { roofSystem: string; attachment: Attachment; adhesiveName: string; rsId: number } {
  const roofSystem = p.roofSystem || bid.roofSystem;
  return {
    roofSystem,
    attachment: p.attachment ?? bid.attachment,
    adhesiveName: p.membraneAdhesiveName || bid.membraneAdhesiveName || "Water Based Adhesive",
    rsId: LEGACY_RS_ID_BY_NAME[roofSystem] ?? -1,
  };
}

/**
 * The labor band a wall prices in: derived from its Vertical dimension like the legacy lookup
 * (`parapetBandForVertical`); walls saved without profile dims keep their picked band.
 */
export function parapetLaborBand(p: ParapetInput, bands: string[]): string {
  if (parapetHasDims(p) && p.verticalInches !== undefined) {
    return parapetBandForVertical(bands, p.verticalInches) ?? p.heightBand;
  }
  return p.heightBand;
}

const parapetGirthInches = (p: ParapetInput): number =>
  parapetHasDims(p)
    ? (p.skirtInches ?? 0) +
      (p.cantInches ?? 0) +
      (p.verticalInches ?? 0) +
      (p.wallTopInches ?? 0) +
      (p.dropInches ?? 0)
    : p.girthInches;

/**
 * A curb on a bid (§4.5/§5.3). Labor is exact per the seeded tables: per curb, setup minutes +
 * (min/LF for the deck × curb-type multiplier) × perimeter, × quantity. Perimeter derives from the
 * A × B footprint (inches → In2Ft). MEMBRANE MATERIAL auto-computes via the legacy Curb.Cost wrap
 * model (curb-wrap.ts) when a legacy styleId is set; style-less curbs (older saved bids) stay
 * manual — cover those via an accessory/extra line.
 */
export interface CurbInput {
  id: string;
  name: string;
  quantity: number;
  widthIn: number; // footprint A (inches)
  lengthIn: number; // footprint B (inches)
  curbType: string; // from the seeded curb types (Open / Closed / …) — labor multiplier key
  deckType: string; // labor deck name, bridged via TEAROFF_DECK_BY_LABOR_DECK
  /** Legacy CurbStyle.ID 1..6 for the wrap-material model (3/4 = quote required). */
  styleId?: number;
  /** Wrap dim C (inches) — curb height. */
  dimCIn?: number;
  /** Wrap dim D (inches). */
  dimDIn?: number;
  /** Per-curb membrane mil for the wrap rate (legacy curb screen); absent = bid default. */
  thicknessMil?: number;
  /** Per-curb membrane color for the wrap rate (legacy curb screen); absent = bid default. */
  color?: string;
  /**
   * Legacy curb termination option (docs §8.3): 0 None, 1 Scupper-Fascia Bar 1¾",
   * 2 Lift & Tuck, 3 Lift & T-Bar, 4 No Lift & T-Bar, 5 No Lift & Counter Flash.
   * The Lift options (2/3) add the legacy lift labor; option 5 auto-prices the "Curb Counter
   * Flashing" Sheet Metal Work item (§8.3); hardware footage for 1/3/4 is an ordering quantity
   * (term-bar/fascia price basis unproven — priced via accessory/non-DL lines for now).
   */
  termOption?: number;
  /**
   * Per-item labor adjustment percent (legacy AdjustLabor, the "Labor: X h (Y%)" link — docs
   * §8.7): the curb's ENTIRE hours (type labor + ISO + lift) × (1 + pct/100), Round 8dp.
   */
  adjustLaborPct?: number;
  /** Legacy "Insulation on Curb(s)": adds ISO labor (0.25 + LinealFt × 0.0167) × qty hours. */
  hasInsulation?: boolean;
  /** Legacy "Plastic on Curb(s)": drives the PolyethyleneSqF ordering quantity (no auto price). */
  hasPlastic?: boolean;
}

/**
 * A flat Exceptional Metals catalog line (older bids; the §13 calculated screen is the primary
 * path now). Same economics as a non-DL line (unit cost + labor/unit at the line's own rate),
 * but the MATERIAL belongs to the Duro-Last material subtotal M0 (§4.8 dMaterial[5] metals
 * slot), not OtherMaterial. CONFIRMED by ReviewCalc IL: dLabor[5,0/1] = Metals.LaborCost/Labor —
 * direct labor at the row's own rate inside LaborSubtotal1 (not LS2 services).
 */
export type MetalLine = NonDlLine;

export interface BidInput {
  roofSystem: string; // "Duro-Last" | "Duro-Roof" | ...
  attachment: Attachment;
  /**
   * Membrane adhesive for fully-adhered systems ("Water Based Adhesive" / "Solvent Based
   * Adhesive"); defaults to Water Based. Drives the §2.4 membrane/wall adhesive units.
   */
  membraneAdhesiveName?: string;
  sections: BidSectionInput[];
  /**
   * Legacy MechFastenerLookup rows (mech_fastener_lookup). Optional: when present the Duro-Tuff
   * mechanical perimeter tiers key their on-centre spacing by ROW WIDTH the way
   * `RoofSystem.MechPerimLaborRate` does; absent → the section's stored spacings are used.
   */
  fastenerLookup?: MechFastenerRow[];
  accessories: AccessoryLine[];
  /** §12 Accessories calculated-screen state (absent on older saved bids → empty state). */
  accessoriesCalc?: Partial<AccessoriesState>;
  /** §13 EXCEPTIONAL Metals screen state (gutters/downspouts/pitch pans/collection boxes). */
  metalsCalc?: Partial<MetalsState>;
  /** §14 Non-Duro-Last Items screen state (the six legacy dialogs). */
  nonDlCalc?: Partial<NonDlState>;
  nonDlLines: NonDlLine[];
  metals: MetalLine[];
  parapets: ParapetInput[];
  curbs: CurbInput[];

  // money params
  markupMode: MarkupMode;
  markup: number;
  /**
   * Per-bid underlayment $/sqft overrides by board name (legacy frmULSqFtPopUp →
   * `DualValue.set_CustomValue` on the estimate's copy of the board; `SmartValue` = custom when
   * > 0 else the admin default — docs §22.9). Absent / ≤ 0 = the admin price.
   */
  underlaymentPriceOverrides?: Record<string, number>;
  crewLaborRatePerHour: number;
  /**
   * Per-estimate hours per man-day (legacy frmLaborTemplate txtHrsPerDay writes
   * Settings.HoursPerDay for the open estimate). Absent = the admin default.
   */
  hoursPerDay?: number;
  commission: number;
  commissionInMarkup: boolean;
  perDiem: number;
  perDiemInMarkup: boolean;
  prepayDiscount: boolean;
  stdSizeDiscount: boolean;
  volumeDiscount: boolean;
  taxExempt: boolean;
  adjustLaborPct: number;
  /** Per-bid setup-time adjustment % (legacy "Setup 16 h (100%)" override); composed with templates. */
  adjustSetupPct?: number;
  /** Per-bid inspection-time adjustment %; composed with templates. */
  adjustInspectionPct?: number;
  /** Per-category labor template name (from labor_templates); "" / unset = no template. */
  laborTemplateName?: string;
  /**
   * Legacy per-estimate sales tax (Estimate.SalesTax fraction / TaxMaterialOnly — frmHome
   * "5. Tax Exempt" group). Absent = the company settings.
   */
  salesTaxRate?: number;
  taxMaterialOnly?: boolean;

  // provided extras (seams)
  extraShipping: number;
  subsCost: number;
  servicesCost: number;
  materialUnderlayment: number;
  otherMaterial: number;

  // warranty
  warrantyCostPerSqFt: number;
  warrantyNonEliteMasterCharge: number;
  warrantyIsHighWind: boolean;
  warrantyHighWindUpcharge: number;
}

/**
 * A section's insulation layers, converting the legacy single `underlaymentBoard` into one
 * mechanical layer at the app's default 5 fasteners/board. Used by the compute path AND the UI
 * hydration so old saved bids read identically everywhere.
 */
export function sectionLayers(s: BidSectionInput): UnderlaymentLayer[] {
  if (s.layers && s.layers.length > 0) return s.layers.slice(0, 4);
  if (s.underlaymentBoard)
    return [
      {
        board: s.underlaymentBoard,
        attachment: "mechanical",
        fastenersPerBoard: 5,
        adhesiveName: "",
        substrate: "",
      },
    ];
  return [];
}

/** Legacy Complexities table (ComplexityID → Description). */
export const COMPLEXITY_LABELS = [
  "Open",
  "Minor",
  "Moderate",
  "Medium",
  "Heavy",
  "Extreme",
] as const;

/**
 * Legacy RSComplexityFactor.DefaultLabor by RoofSystemID → ComplexityID (seeded rows exist only
 * for Duro-Tuff (3) and Duro-Fleece (5), identical: 0.9, 0.98, 1, 1.2, 2.4, 4). Any other system
 * has no rows → the legacy form lists a single "None" = 1.0.
 */
/**
 * Legacy RoofSystem.LapOver → `RoofSystem.OverlapWidth` (in) by roof-system id, from the shipped
 * installer's RoofSystem rows: 6" for every membrane system except Duro-Fleece (3"). Not an
 * admin-editable value in BAManager.
 */
export const LEGACY_OVERLAP_WIDTH_IN: Record<number, number> = { 1: 6, 2: 6, 3: 6, 4: 6, 5: 3 };
/** Legacy MembraneType.DefaultRollLength (ft) — RSMembraneType.RollLength, 100 for every seeded type. */
export const LEGACY_ROLL_LENGTH_FT = 100;

export const RS_COMPLEXITY_FACTORS: Record<number, readonly number[]> = {
  3: [0.9, 0.98, 1, 1.2, 2.4, 4],
  5: [0.9, 0.98, 1, 1.2, 2.4, 4],
};

/** Whether a roof system offers the legacy Complexity list (RSComplexityFactor rows). */
export function roofSystemHasComplexity(roofSystem: string): boolean {
  return RS_COMPLEXITY_FACTORS[LEGACY_RS_ID_BY_NAME[roofSystem] ?? -1] !== undefined;
}

/**
 * The section's ComplexityFactor.SmartValue (multiplied into every mech/adhered labor rate and
 * the tear-off base labor). Legacy `RoofSection.set_SheetSize` resets the factor to "None" (1.0)
 * whenever a non-roll sheet is picked, and `frmRoofSection.UpdatePreview` only enables the
 * Complexity combo while the sheet multiplier is exactly 1.0 — so the factor applies only with a
 * ×1.0 sheet. The legacy default selection is index 2 (Moderate).
 */
export function sectionComplexityFactor(
  rsId: number,
  complexity: number | undefined,
  sheetSizeMulti: number,
): number {
  const table = RS_COMPLEXITY_FACTORS[rsId];
  if (!table || sheetSizeMulti !== 1) return 1;
  return table[complexity ?? 2] ?? 1;
}

/** Sheet-size label → sq ft (legacy SheetSize.Rolls × 100; the seeded labels carry that number). */
export function sheetSizeSqFt(label: string): number {
  const m = /(\d+)\s*sf/i.exec(label);
  return m ? Number(m[1]) : 100;
}

/**
 * Legacy `RoofSection.get_SheetSize` for a NON-quick-bid section ("Enter D/L Roof Sheets"): the
 * sheet is derived from Ceiling(W × L) against each size's Rolls × 100 in list order — the last
 * size the area exceeds picks the NEXT size up (or itself when it is the largest); an exact match
 * picks that size; an area within the first size keeps the first (roll goods) entry.
 */
export function derivedSheetSizeLabel(areaSqFt: number, labels: string[]): string | undefined {
  if (labels.length === 0) return undefined;
  const area = Math.ceil(areaSqFt);
  let pick = labels[0]!;
  for (let i = 0; i < labels.length; i++) {
    const cap = sheetSizeSqFt(labels[i]!);
    if (area > cap) pick = i === labels.length - 1 ? labels[i]! : labels[i + 1]!;
    else if (area === cap) pick = labels[i]!;
  }
  return pick;
}

/**
 * Selectable Field Tab Spacing pitches per system (legacy RSSheetTabSpacing + MechTabMulti;
 * systems not listed keep a free numeric input).
 */
export const TAB_OPTIONS_BY_SYSTEM: Record<string, number[]> = {
  "Duro-Last": [28, 60, 120],
  "Duro-Roof": [57, 87, 120],
  "Duro-Tuff": [30, 60, 120],
};

/**
 * Legacy frmPerimCalculator (frmRoofSectionAdv.LinkLabel1_LinkClicked): perimeter enhancement
 * width = Round(Ceiling(min(0.4 × building height, 0.1 × lesser roof dimension))), never below 5.
 */
export function perimeterEnhancementCalculator(
  buildingHeightFt: number,
  lesserDimFt: number,
): number {
  const a = buildingHeightFt * 0.4;
  const b = lesserDimFt * 0.1;
  const w = Math.round(Math.ceil(a < b ? a : b));
  return w < 5 ? 5 : w;
}

/** A section's effective roof system / attachment / adhesive (section override, else bid). */
export function resolveSectionSystem(
  bid: Pick<BidInput, "roofSystem" | "attachment" | "membraneAdhesiveName">,
  s: Pick<BidSectionInput, "roofSystem" | "attachment" | "membraneAdhesiveName">,
): {
  roofSystem: string;
  attachment: Attachment;
  adhesiveName: string;
  rsId: number;
  comboKey: string;
} {
  const roofSystem = s.roofSystem || bid.roofSystem;
  const attachment = s.attachment ?? bid.attachment;
  return {
    roofSystem,
    attachment,
    adhesiveName: s.membraneAdhesiveName || bid.membraneAdhesiveName || "Water Based Adhesive",
    rsId: LEGACY_RS_ID_BY_NAME[roofSystem] ?? -1,
    comboKey: comboKey(roofSystem, attachment),
  };
}

/** The section's effective average-sheet label (derived from area for non-quick-bid sections). */
export function resolveSectionSheetLabel(s: BidSectionInput, sheetLabels: string[]): string {
  if (s.isQuickBid === false)
    return derivedSheetSizeLabel(s.length * s.width, sheetLabels) ?? s.sheetSizeLabel;
  return s.sheetSizeLabel;
}

/** The DB labor combo key uses "adhesive"; the engine attachment enum uses "adhered". */
const comboKey = (system: string, attachment: Attachment): string =>
  `${system}|${attachment === "adhered" ? "adhesive" : "mechanical"}`;

/**
 * Per-item attribution for the legacy Estimate Review ledger — recorded DURING the build loops
 * (same math, no recomputation), so the ledger's rows always sum to the engine's aggregates.
 */
export interface ReviewBreakdown {
  /** Accessory lines material (dMaterial[4] share of M0). */
  accessoriesMaterial: number;
  /** Auto-priced ARP material (§8.6, MembraneAccs → shown with Accessories). */
  arpMaterial: number;
  /** Exceptional Metals own-rate labor (dLabor[5] share). */
  metalsLaborCost: number;
  metalsLaborHours: number;
  /** Underlayment material/labor by insulation TILE (SubType 1..8; 0 = unmapped board). */
  underlaymentMaterialBySubtype: Record<number, number>;
  underlaymentHoursBySubtype: Record<number, number>;
  /** Per-curb legacy Curb.ManHours (the Curbs screen "Labor: X hours" link), by curb id. */
  curbHoursById: Record<string, number>;
  /** Per-parapet legacy Parapet.ManHours (adjusted) and BaseManHours, by parapet id. */
  parapetHoursById: Record<string, number>;
  parapetBaseHoursById: Record<string, number>;
  /** Auto-priced NDL items (§8.3/§8.4) for the non-DL ledger rows. */
  auto: {
    counterflash: { material: number; laborCost: number; hours: number };
    blocking: { material: number; laborCost: number; hours: number };
    masonry: { material: number; laborCost: number; hours: number };
  };
}

export interface BuildResult {
  inputs: EstimateInputs;
  /** Warnings for the UI (e.g. missing price / labor combo). */
  warnings: string[];
  /** Per-item attribution for the review ledger (display-only; sums to the aggregates). */
  breakdown: ReviewBreakdown;
  /** Parapet membrane material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  parapetMaterial: number;
  /** Exceptional Metals material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  metalsMaterial: number;
  /** Adhesive material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  adhesiveMaterial: number;
  /** Curb wrap membrane $ (inside duroLastMaterial/M0); split out for display/proposal. */
  curbMaterial: number;
  /**
   * Legacy Review "Total Membrane sqft" (dTotals[29]) = SqFtTotalMembrane + Parapets.AdjustedSqFt
   * + Parapets.ARPSqFt + RoofSections.ARPSqFt; the per-membrane-sqft rows divide by it (§22.12).
   */
  reviewMembraneSqFtExtras: {
    parapetAdjustedSqFt: number;
    parapetArpSqFt: number;
    sectionArpSqFt: number;
  };
  /**
   * Slip-Sheet underlayment (insulation tile 1) material $ — legacy dMaterial[6], which sits INSIDE
   * Σ dMaterial[0..6] = Duro-Last Material (M0, prepay-discountable); the other seven tiles form
   * dTotals[6] Underlayment (docs §22.1). Split out for display/proposal.
   */
  slipSheetMaterial: number;
  /** §12 Accessories calculated-screen results (absent when the snapshot lacks the ref data). */
  accessories?: AccessoriesResult;
  /** §13 EXCEPTIONAL Metals screen results (absent when the snapshot lacks the ref data). */
  metalsScreen?: MetalsResult;
  /** §14 Non-Duro-Last Items results (absent when the snapshot lacks the non_dl screens). */
  nonDl?: NonDlResult;
  /** Whole units per adhesive (§2.4 Ceil-once; the Adhesives screen's Calc Qty column). */
  adhesiveWholeUnits?: Record<string, number>;
}

/**
 * The FIELD membrane tier + $/sqft the engine will bill for a section — the same §1 decision
 * chain buildEstimateInputs runs (roll-good sheet vs tab tier, flat families, Duro-Roof 57").
 * Exists so display surfaces (the Show-calculations dialog) can never disagree with the bid
 * total; a test pins helper × MembraneWithOverlap == the engine's membrane material for
 * default-lap sections.
 */
export function sectionMembraneDisplayPricing(
  admin: EngineAdminData,
  roofSystem: string,
  attachment: Attachment,
  s: BidSectionInput,
): { pricePerSqFt: number; tierLabel: string } {
  const sys = resolveSectionSystem({ roofSystem, attachment }, s);
  roofSystem = sys.roofSystem;
  const rsId = sys.rsId;
  if (rsId === 2 || rsId === 3 || rsId === 5) {
    const variantKey = rsId === 5 ? `${s.thickness}mil` : String(s.thickness);
    return {
      pricePerSqFt: admin.familyMembranePrices?.[roofSystem]?.[variantKey] ?? 0,
      tierLabel: `${roofSystem} flat price`,
    };
  }
  const lt = admin.labor[sys.comboKey];
  const sheetLabel = resolveSectionSheetLabel(s, Object.keys(lt?.sheetSizeMultiByLabel ?? {}));
  const midThresholdIn = rsId === 4 ? 57 : 60;
  const hasTabTable = admin.sheetTabSpacings?.[rsId] !== undefined;
  const isRollGoodSheet =
    rsId === 4
      ? !hasTabTable
      : rsId !== 1 ||
        !hasTabTable ||
        !lt?.rollGoodsSheetLabel ||
        sheetLabel === lt.rollGoodsSheetLabel;
  let tier: PriceTier = "rollGoods";
  if (!isRollGoodSheet) {
    const picked = selectMembranePriceTier({
      isDefaultRollGood: false,
      sheetTabSpacings: admin.sheetTabSpacings?.[rsId] ?? [],
      fieldLapInches: s.fieldLap,
      midThresholdIn,
    });
    if (picked !== "custom") tier = picked;
  }
  let price = priceMatrixLookup(admin.priceMatrix, s.thickness, tier, s.color);
  if (price === null && tier !== "rollGoods") {
    price = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color);
  }
  const TIER_LABELS: Record<string, string> = {
    rollGoods: "Roll Goods",
    tab28: '28" Tabs',
    tab60: '60" Tabs',
    tab120: '120" Tabs',
    parapet: "Parapets",
  };
  return { pricePerSqFt: price ?? 0, tierLabel: TIER_LABELS[tier] ?? tier };
}

/**
 * Stripping row pricing per section (legacy `MembraneAccs.RecalcParents` 0x1edb4, docs §22.9): a
 * Duro-Tuff section's `1' of 10" DT` row prices at `lookup_DuroTuffPrices[mil]`; every other
 * Duro-Last-manufacturer section's `1' of 10" DL` row at `lookup_DuroLastPrices[mil, category 5 =
 * Roll Goods][colour]` — the roll-goods $/sqft billed PER FOOT. Labor multiplies the Duro-Last
 * mechanical system's deck multiplier for the section's deck. One legacy row per part number
 * (`baswf` + system + colour + mil), so feet aggregate per part before the Ceiling.
 */
export function strippingBySection(
  bid: BidInput,
  admin: EngineAdminData,
): Record<string, { pricePerFt: number; deckMulti: number; partKey: string }> {
  const out: Record<string, { pricePerFt: number; deckMulti: number; partKey: string }> = {};
  const dlMech = admin.labor[comboKey("Duro-Last", "mechanical")];
  for (const s of bid.sections) {
    const sys = resolveSectionSystem(bid, s);
    let pricePerFt: number;
    if (sys.rsId === 3) {
      pricePerFt = admin.familyMembranePrices?.["Duro-Tuff"]?.[String(s.thickness)] ?? 0;
    } else {
      pricePerFt = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color) ?? 0;
    }
    const deckId = dlMech?.deckTypeIds[s.deckType];
    const deckMulti =
      dlMech && deckId !== undefined ? directLookup(dlMech.deckTypeMulti, deckId) : 1;
    out[s.id] = {
      pricePerFt,
      deckMulti,
      partKey: `baswf${sys.rsId}|${s.color}|${s.thickness}`,
    };
  }
  return out;
}

/** Build the engine EstimateInputs from a bid + assembled admin data. */
export function buildEstimateInputs(bid: BidInput, admin: EngineAdminData): BuildResult {
  const warnings: string[] = [];
  const version = CURRENT_FORMULAS_VERSION;
  const lt = admin.labor[comboKey(bid.roofSystem, bid.attachment)];
  if (!lt) {
    warnings.push(`No labor table for ${bid.roofSystem} / ${bid.attachment}; labor will be 0.`);
  }

  // Labor templates (docs §20.3): the legacy template is NOT a compute-time factor. Selecting one
  // (frmHome.updateTemplate) WRITES its percent adjustments into every item's AdjustLabor field
  // (sections / underlayment / TO_Additional / parapets / curbs / accessories / setup /
  // inspection), and new items seed from it (RoofSection / Parapet / Curb ctors). The web does the
  // same on the Setup step (`applyLaborTemplate`), so the engine reads ONLY the item fields;
  // `bid.laborTemplateName` is informational.

  const hoursPerDay =
    bid.hoursPerDay !== undefined && bid.hoursPerDay > 0
      ? bid.hoursPerDay
      : admin.settings.hoursPerDay;

  let membraneMaterial = 0;
  let underlaymentMaterial = 0;
  let underlaymentLaborHours = 0;
  /** §10.7: a quote ID shared across sections/layers bills ONCE (legacy CustomQuotes dedup). */
  const billedQuoteIds = new Set<string>();
  // Review-ledger attribution (recorded as we bill; display-only).
  const uMatBySub: Record<number, number> = {};
  const uHrsBySub: Record<number, number> = {};
  const addSub = (rec: Record<number, number>, tile: number, v: number) => {
    if (v) rec[tile] = (rec[tile] ?? 0) + v;
  };
  const bAuto = {
    counterflash: { material: 0, laborCost: 0, hours: 0 },
    blocking: { material: 0, laborCost: 0, hours: 0 },
    masonry: { material: 0, laborCost: 0, hours: 0 },
  };
  /** Fractional adhesive units by adhesive name, summed across every section's layers. */
  const adhesiveUnitsByName: Record<string, number> = {};

  const bidComboKey = comboKey(bid.roofSystem, bid.attachment);
  const sections: RoofSection[] = bid.sections.map((s) => {
    // Per-section Roof System / Attached With (legacy section properties; bid-level = default).
    const sys = resolveSectionSystem(bid, s);
    const rsId = sys.rsId;
    const sLt = sys.comboKey === bidComboKey ? lt : admin.labor[sys.comboKey];
    if (!sLt && sys.comboKey !== bidComboKey) {
      warnings.push(
        `No labor table for ${sys.roofSystem} / ${sys.attachment} — section "${s.name}"; labor will be 0.`,
      );
    }
    const isDuroRoof = sys.roofSystem === "Duro-Roof";
    const sheetLabel = resolveSectionSheetLabel(s, Object.keys(sLt?.sheetSizeMultiByLabel ?? {}));
    const zones = resolveSectionZones(s);
    // Legacy MembraneWithOverlap = RoofSystem.CalculateMembraneQty (docs §21): roll goods add
    // the field seam overlap, sheet sizes add the seam length between sheets; both start from
    // AreaWithEdgeOverlap. Feeds the membrane material AND (via the zone shares) install labor.
    const edgeList = s.edges?.length
      ? [...s.edges].sort((a, b) => edgeSideIndex(a) - edgeSideIndex(b))
      : undefined;
    // Duro-Tuff: DuroTuffSystem.CalculateMembraneQty lays 30"/60" perimeter rows + field strips
    // and WRITES the custom laps it used back onto the section (docs §21.4) — those feed the
    // labor tab lookups below. Custom settings (a user perimeter lap) map to one outer row.
    // Duro-Tuff custom settings: the legacy Advanced form's DT group (`s.tuffCustom`: row counts
    // of the fixed 30" / 60" rows, per-tier spacings, field width / spacing). Older saved bids
    // may instead carry a Duro-Last-style `perimLap`: kept as one outer row at that lap.
    const tuffCustom =
      s.tuffCustom !== undefined || (s.perimLap !== undefined && s.perimLap !== -1);
    // In custom mode the legacy form re-asserts CustomPerimeterLap = (30, 60) on load and never
    // writes CustomCornerLap; the corner laps are whatever the last NON-custom recalc wrote back —
    // (30, 60) for a section that started life on BA-default rows (the normal path).
    const tuffCustomRows: [number, number] = s.tuffCustom
      ? s.tuffCustom.rows
      : tuffCustom
        ? [1, 0]
        : [0, 0];
    const tuffCustomPerimLap: [number, number] = s.tuffCustom
      ? [30, 60]
      : [s.perimLap ?? -1, s.perimLap ?? -1];
    const tuffCustomCornerLap: [number, number] = s.tuffCustom
      ? [30, 60]
      : [s.cornerLap ?? -1, s.cornerLap ?? -1];
    const tuff =
      rsId === 3
        ? duroTuffMembraneCalc({
            length: s.length,
            width: s.width,
            overlapWidthIn: LEGACY_OVERLAP_WIDTH_IN[3] ?? 6,
            fieldLapIn: s.fieldLap,
            customFieldLapIn: s.tuffCustom?.fieldLapIn ?? -1,
            mechanical: sys.attachment === "mechanical",
            useCustomSettings: tuffCustom,
            customRows: tuffCustomRows,
            customPerimLapIn: tuffCustomPerimLap,
            customCornerLapIn: tuffCustomCornerLap,
            sides: [0, 1, 2, 3].map((i) => {
              const e = edgeList?.[i];
              return {
                isPerim: e?.isPerimeter ?? false,
                perimLengthFt: e ? edgePerimLength(e) : 0,
                has2ftWall: e?.hasTallWall ?? false,
              };
            }),
            corners: edgeList
              ? effectiveCorners(edgeList, s.perimCorners)
              : [false, false, false, false],
            rollLengthFt: LEGACY_ROLL_LENGTH_FT,
            rollWidthsIn: Object.keys(
              admin.rollGoodWidthMulti?.[3] ?? { 30: 1, 60: 1, 120: 1 },
            ).map(Number),
          })
        : undefined;
    const membraneWithOverlap = tuff
      ? tuff.qty
      : legacyMembraneWithOverlap(
          rsId,
          {
            length: s.length,
            width: s.width,
            overlapWidthIn: LEGACY_OVERLAP_WIDTH_IN[rsId] ?? 6,
            fieldLapIn: s.fieldLap,
            customFieldLapFt: 0,
            customPerimeterLapIn: s.perimLap !== undefined && s.perimLap !== -1 ? s.perimLap : 0,
            perimEnhancementWidthFt: s.enhancementWidthFt,
            sides: (edgeList ?? []).map((e) => ({
              isPerim: e.isPerimeter,
              perimLengthFt: edgePerimLength(e),
            })),
            isQuickBid: s.isQuickBid !== false,
            rolls: sheetRollsFromLabel(sheetLabel),
          },
          version,
        );
    // Membrane tier (legacy MembraneCost_4_0_230, docs/legacy-money-parity.md §1): the combo's
    // FIRST sheet size (the seeded "Roll Good") prices the whole MembraneWithOverlap at the
    // roll-goods tier; other sheets price the FIELD share at the fieldLap's tab tier, with the
    // perim/corner shares priced only when their custom zone lap is set (legacy default -1 =
    // unpriced) and the negative-share carry applied. A lap outside the system's tab list
    // (legacy: manual custom $/sqft, not modeled) falls back to roll goods WITH a warning.
    // Tab-tier zone pricing is DuroLastSystem.MembraneCost logic — Duro-Tuff/Duro-Roof/etc. have
    // their own legacy MaterialCost implementations (not ported): they stay roll goods. A
    // pre-series adminSnapshot has no rollGoodsSheetLabel (undefined, not "") — treated as a
    // roll-good sheet so frozen bids keep their exact pricing, warning-free.
    // Duro-Bond (rs 2) / Duro-Tuff (rs 3) / Duro-Fleece (rs 5): flat single-price membranes
    // (parity doc §7.1) — no color, no tiers, no zones. Fleece keys by membrane TYPE; a
    // thickness-only bid reaches the non-Plus rows ("50mil"/"60mil"; Plus variants flagged).
    if (rsId === 2 || rsId === 3 || rsId === 5) {
      const variantKey = rsId === 5 ? `${s.thickness}mil` : String(s.thickness);
      const fPrice = admin.familyMembranePrices?.[sys.roofSystem]?.[variantKey];
      if (fPrice === undefined) {
        warnings.push(
          `No ${sys.roofSystem} membrane price for "${variantKey}" — section "${s.name}".`,
        );
      }
      membraneMaterial += membraneWithOverlap * (fPrice ?? 0);
    }
    // Duro-Roof (rs 4) shares the Duro-Last zone logic with NO roll-good sheet branch and a
    // 57" middle threshold (its 57" tab maps to the 60"-Tabs price row); ×1.05 rides on
    // membraneMaterialCost's isDuroRoof surcharge.
    const isFlatFamily = rsId === 2 || rsId === 3 || rsId === 5;
    const midThresholdIn = rsId === 4 ? 57 : 60;
    // A pre-series adminSnapshot has no sheetTabSpacings at all — zoned pricing must not engage
    // there (it would warn and misprice); those frozen bids keep roll goods, warning-free.
    const hasTabTable = admin.sheetTabSpacings?.[rsId] !== undefined;
    const isRollGoodSheet =
      rsId === 4
        ? !hasTabTable
        : rsId !== 1 ||
          !hasTabTable ||
          !sLt?.rollGoodsSheetLabel ||
          sheetLabel === sLt.rollGoodsSheetLabel;
    let tier: PriceTier = "rollGoods";
    if (!isRollGoodSheet) {
      const tabList = admin.sheetTabSpacings?.[rsId] ?? [];
      const picked = selectMembranePriceTier({
        isDefaultRollGood: false,
        sheetTabSpacings: tabList,
        fieldLapInches: s.fieldLap,
        midThresholdIn,
      });
      if (picked === "custom") {
        warnings.push(
          `Field lap ${s.fieldLap}" is not a selectable tab pitch — membrane priced at roll goods (legacy uses a manual $/sqft here) — section "${s.name}".`,
        );
      } else {
        tier = picked;
      }
    }
    let price = isFlatFamily
      ? null
      : priceMatrixLookup(admin.priceMatrix, s.thickness, tier, s.color);
    if (!isFlatFamily && price === null && tier !== "rollGoods") {
      warnings.push(
        `No ${tier} price for ${s.thickness}mil ${s.color} — falling back to roll goods — section "${s.name}".`,
      );
      price = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color);
    }
    if (!isFlatFamily && price === null) {
      warnings.push(
        `No price for ${s.thickness}mil ${s.color} (roll goods) — section "${s.name}".`,
      );
    }
    if (isFlatFamily) {
      // membrane already priced above (flat family)
    } else if (isRollGoodSheet) {
      membraneMaterial += membraneMaterialCost(membraneWithOverlap, price ?? 0, isDuroRoof);
    } else {
      const shares = membraneZoneShares({
        areaTotal: s.length * s.width,
        areaPerimeter: zones.perimLengthFt * s.enhancementWidthFt,
        areaCorner: zones.cornerLengthFt * s.enhancementWidthFt,
        membraneWithOverlap,
      });
      membraneMaterial += membraneMaterialCost(shares.field, price ?? 0, isDuroRoof);
      // Custom zone laps (§1): a perim/corner zone is priced only when its custom lap is set
      // (legacy default -1 → unpriced). In-list laps: ≥ 60 → 60" Tabs, ≥ 24 → 28" Tabs — NO 120
      // tier for zones; < 24 unpriced. Out-of-list laps are legacy's manual $/sqft (not
      // modeled) — warned, unpriced.
      const tabList = admin.sheetTabSpacings?.[rsId] ?? [];
      const zoneCost = (lap: number | undefined, share: number, zone: string): number => {
        if (lap === undefined || lap === -1 || share <= 0) return 0;
        if (!tabList.includes(lap)) {
          warnings.push(
            `${zone} lap ${lap}" is not a selectable tab pitch — zone unpriced (legacy uses a manual $/sqft here) — section "${s.name}".`,
          );
          return 0;
        }
        const zTier: PriceTier | null =
          lap >= midThresholdIn ? "tab60" : lap >= 24 ? "tab28" : null;
        if (zTier === null) return 0;
        const zPrice = priceMatrixLookup(admin.priceMatrix, s.thickness, zTier, s.color);
        if (zPrice === null) {
          warnings.push(
            `No ${zTier} price for ${s.thickness}mil ${s.color} — ${zone.toLowerCase()} zone unpriced — section "${s.name}".`,
          );
          return 0;
        }
        return membraneMaterialCost(share, zPrice, isDuroRoof);
      };
      membraneMaterial +=
        zoneCost(s.perimLap, shares.perim, "Perimeter") +
        zoneCost(s.cornerLap, shares.corner, "Corner");
    }

    // Carve the perimeter/corner enhancement zones out of the field area (§2, _230 subtracts
    // both). With per-side edges the legacy geometry (perimeter runs minus the marked corners;
    // corner length from the corner flags — docs §16) is the source of truth; edge-less sections
    // keep their manual lengths. Computed BEFORE the layer loop — the §10.3 custom fastener
    // densities bill per zone area.
    const perimArea = zones.perimLengthFt * s.enhancementWidthFt;
    const cornerArea = zones.cornerLengthFt * s.enhancementWidthFt;
    const fieldArea = Math.max(0, s.length * s.width - perimArea - cornerArea);

    // Legacy MechFieldLaborRate / AdheredFieldLaborRate multiply SheetSize.SmartSheetMulti AND
    // ComplexityFactor.SmartValue (RSComplexityFactor rows only for Duro-Tuff / Duro-Fleece);
    // UnderlaymentBaseHours multiplies both into the section's underlayment hours as well.
    const sheetSizeMulti = sLt?.sheetSizeMultiByLabel[sheetLabel] ?? 1;
    const complexity = sectionComplexityFactor(rsId, s.complexity, sheetSizeMulti);

    // Insulation layers (§4.3, up to 4): board material → dTotals[6]; layout + fastener labor
    // and adhesive labor → direct labor; adhesive units × price → M0. Labor follows legacy
    // RoofSection.UnderlaymentBaseHours (docs §18): per priced layer AreaTotal/2500 × LayoutTime,
    // + fastener time × the legacy count rule (mechanical) or (AreaField + AreaPerimeter) ×
    // labor / 2500 (adhered, substrate derived from the layer below / deck); the section's
    // base hours then × ComplexityFactor × SheetSize multiplier × (1 + AdjustUnderlaymentLabor
    // /100). Quote labor bills verbatim, unadjusted (UnderlaymentQuoteHours).
    const sLayers = sectionLayers(s);
    const uAdjust = 1 + (s.adjustUnderlaymentLaborPct ?? 0) / 100;
    const uScale = complexity * sheetSizeMulti * uAdjust;
    const zoneArea = fieldArea + perimArea; // legacy adhesive LABOR basis (corner squares excluded)
    /**
     * Legacy `RoofSection.UnderlaymentAdhesive` (rva 0x4d470, IL-exact — docs §22.6). For an
     * adhered layer: if the layer's OWN board's adhesive group ∈ {16 Tapered ISO, 18 Tapered
     * Rigid, 19 Crickets/Other} → `+= QuoteAdhesiveUnits` verbatim (no coverage, no spacing
     * multiplier). Otherwise k = coverage of the substrate (the board below's adhesive group,
     * or the deck for the bottom layer) and
     *   units += AreaField/k × m0 + AreaPerimeter/k × m1 + AreaCorner/k × m1,
     * m0/m1 = UUseAdheredCustomSettings ? ToInteger(12 / UCustomAdhesiveSpacing(0|1)) : 1 —
     * both spacings must be set, the multiplier is a banker's-rounded INTEGER, and the corner
     * squares ARE in the units basis (labor keeps field + perimeter, §18). Legacy applies this
     * to quote (NeedQuote) layers too, so `withHours` is false for those (their labor is the
     * quote's own hours). Returns the layer's adhesive LABOR hours.
     */
    const billLayerAdhesive = (layer: UnderlaymentLayer, li: number, withHours: boolean) => {
      if (!admin.adhesiveTimes) return 0;
      const ownGroup = admin.underlaymentGroups?.adhesiveGroupIdByBoard?.[layer.board];
      if (ownGroup !== undefined && QUOTE_ADHESIVE_GROUPS.has(ownGroup)) {
        const units = layer.quoteAdhesiveUnits ?? 0;
        if (units > 0) {
          if (admin.adhesivePrices?.[layer.adhesiveName] === undefined) {
            warnings.push(`No adhesive price for "${layer.adhesiveName}" — section "${s.name}".`);
          }
          adhesiveUnitsByName[layer.adhesiveName] =
            (adhesiveUnitsByName[layer.adhesiveName] ?? 0) + units;
        } else {
          warnings.push(
            `Adhesive on "${layer.board}" needs quote adhesive containers (tapered surface) — section "${s.name}".`,
          );
        }
        return 0;
      }
      // Legacy: the substrate is the layer below's adhesive group, or the deck type.
      const grid = admin.adhesiveTimes.bySubstrate[layer.adhesiveName];
      const derived = deriveAdhesiveSubstrate(admin, s.deckType, sLayers, li).substrate;
      const substrate = derived !== undefined && grid?.[derived] ? derived : layer.substrate;
      const entry = grid?.[substrate];
      if (!entry || entry.coverageSqFt <= 0) {
        warnings.push(
          `No adhesive coverage for ${layer.adhesiveName || "(no adhesive)"} / ${substrate || "(no substrate)"} — section "${s.name}".`,
        );
        return 0;
      }
      if (admin.adhesivePrices?.[layer.adhesiveName] === undefined) {
        warnings.push(`No adhesive price for "${layer.adhesiveName}" — section "${s.name}".`);
      }
      const k = entry.coverageSqFt;
      const fieldSp = s.uAdhesiveSpacingIn ?? 0;
      const perimSp = s.uAdhesiveSpacingPerimIn ?? fieldSp;
      const useCustom = fieldSp > 0 && perimSp > 0;
      const m0 = useCustom ? bankersRound(12 / fieldSp, 0) : 1;
      const m1 = useCustom ? bankersRound(12 / perimSp, 0) : 1;
      // Fractional units accumulate per adhesive; whole-unit rounding happens ONCE per
      // adhesive after all sections (legacy AggregateCalcQtys), below.
      adhesiveUnitsByName[layer.adhesiveName] =
        (adhesiveUnitsByName[layer.adhesiveName] ?? 0) +
        (fieldArea / k) * m0 +
        (perimArea / k) * m1 +
        (cornerArea / k) * m1;
      if (!withHours) return 0;
      return underlaymentAdhesive({
        areaSqFt: zoneArea,
        coverageSqFt: k,
        laborPer2500SqFt: entry.labor,
      }).hours;
    };
    for (const [li, layer] of sLayers.entries()) {
      const area = s.length * s.width;
      // Custom-quote layer (docs §10.5/§10.7): quoted amounts verbatim; nothing else bills.
      // A quote ID applied to several sections bills ONCE (legacy CustomQuotes dedup set);
      // a quote without an id (older saved bids) bills per occurrence.
      const uTile = admin.underlaymentGroups?.groupIdByBoard?.[layer.board] ?? 0;
      if (layer.quote) {
        if (layer.quote.id) {
          if (billedQuoteIds.has(layer.quote.id)) continue;
          billedQuoteIds.add(layer.quote.id);
        }
        const qMaterial = layer.quote.pieceMode
          ? (layer.quote.pieces ?? 0) * (layer.quote.costPerPiece ?? 0)
          : (layer.quote.lumpSum ?? 0);
        underlaymentMaterial += qMaterial;
        addSub(uMatBySub, uTile, qMaterial);
        const amt = layer.quote.laborAmount ?? 0;
        const qHours = layer.quote.laborInDays ? amt * hoursPerDay : amt;
        underlaymentLaborHours += qHours;
        addSub(uHrsBySub, uTile, qHours);
        // Legacy UnderlaymentAdhesive has no NeedQuote test: an ADHERED quote layer still bills
        // its adhesive units (quote containers for the tapered groups, else coverage).
        if (layer.attachment === "adhesive") billLayerAdhesive(layer, li, false);
        continue;
      }
      // SmartValue: the bid's custom $/sqft when > 0, else the admin default (docs §22.9).
      const uOverride = bid.underlaymentPriceOverrides?.[layer.board];
      const uPrice =
        uOverride !== undefined && uOverride > 0
          ? uOverride
          : admin.underlaymentPrices?.[layer.board];
      if (uPrice === undefined) {
        warnings.push(`No underlayment price for "${layer.board}" — section "${s.name}".`);
      } else {
        // Legacy waste factor (RoofSection.UnderlaymentCost 0x4bcc4, docs §22.12 — CORRECTED
        // 2026-09-21): `CompareString(Name, "Geotextile"); brtrue → 1.03 path`, i.e. the branch is
        // taken when the name is NOT Geotextile. So every ordinary board bills area × 1.03 and
        // ONLY Geotextile bills × 1.06 — the reverse of the first transcription. Confirmed on a
        // legacy Review screen: 4x8 ISO $79,120.15 = the web's ×1.06 figure × 1.03 / 1.06 exactly.
        const waste = layer.board.trim().toLowerCase() === "geotextile" ? 1.06 : 1.03;
        underlaymentMaterial += area * waste * uPrice;
        addSub(uMatBySub, uTile, area * waste * uPrice);
      }
      // Layout time applies to every priced layer whatever its attachment (incl. "none").
      const layout = admin.underlaymentLabor?.layoutHoursByProduct[layer.board];
      let layerHours = 0;
      if (admin.underlaymentLabor && layout === undefined) {
        warnings.push(`No underlayment layout time for "${layer.board}" — section "${s.name}".`);
      } else if (layout !== undefined) {
        layerHours += (area / 2500) * layout;
      }
      if (layer.attachment === "mechanical") {
        if (admin.underlaymentLabor) {
          const uDeck = UNDERLAYMENT_DECK_BY_LABOR_DECK[s.deckType] ?? s.deckType;
          const minPerFast = admin.underlaymentLabor.fastenerMinutesByDeck[uDeck];
          if (minPerFast === undefined) {
            warnings.push(
              `No underlayment fastening time for ${s.deckType} — section "${s.name}".`,
            );
          } else {
            // Legacy UnderlaymentLayerField/PerimFasteners (docs §10.3): count by the board's
            // SubType and the MEMBRANE attachment; Enhancement Options densities override.
            const count = underlaymentLayerFasteners({
              areaField: fieldArea,
              areaPerim: perimArea,
              areaCorner: cornerArea,
              subtype: admin.underlaymentGroups?.groupIdByBoard?.[layer.board],
              fourByFour: /4'\s?x\s?4/.test(layer.board),
              membraneMechanical: sys.attachment === "mechanical",
              custom: s.uCustomFastenerDensity,
            }).total;
            layerHours += (minPerFast / 60) * count;
          }
        }
      } else if (layer.attachment === "adhesive" && admin.adhesiveTimes) {
        layerHours += billLayerAdhesive(layer, li, true);
      }
      const scaled = layerHours * uScale;
      underlaymentLaborHours += scaled;
      addSub(uHrsBySub, uTile, scaled);
    }

    let tearOffLaborLookup = 0;
    if (s.tearOff && admin.tearOff) {
      const tDeck = TEAROFF_DECK_BY_LABOR_DECK[s.deckType] ?? s.deckType;
      tearOffLaborLookup = admin.tearOff.lookup[tDeck]?.[s.tearOffType] ?? 0;
      if (tearOffLaborLookup === 0) {
        warnings.push(
          `No tear-off rate for ${s.deckType} / ${s.tearOffType || "(no type)"} — section "${s.name}".`,
        );
      }
    }

    // ── Duro-Bond mechanical ("durobondmech"): a DIFFERENT labor model (docs §22.14) ──
    // DuroBondSystem.RoofSectionLaborHours_4_0_237 (0xba1c):
    //   hours = MembraneType.Labor × MembraneWithOverlap × LayoutTime/2500 × SheetSize.MechSheetMulti
    //         + UnderlaymentFasteners(−1) × SingleFastenerTimeByDT(deck)
    // where UnderlaymentFasteners(−1) on durobondmech = DuroLastFunctions.DuroBondFastenersField
    // + DuroBondFastenersPerim (0xa58b4 / 0xa5934): Round(AreaField/32 × fieldPerBoard) +
    // Round(AreaPerimeter/32 × perimPerBoard + AreaCorner/32 × cornerPerBoard) — the per-4×8-board
    // plate counts from MechFastenerLookup (the section's stored OC values carry them, exactly as
    // the legacy custom-settings path reads CustomField/Perimeter/CornerFastenerSpacing). Raw
    // takeoff areas (RoofSection.AreaField/AreaPerimeter/AreaCorner), .NET banker's rounding.
    let duroBond: RoofSection["duroBond"];
    if (rsId === 2 && sys.attachment === "mechanical") {
      const dbBase = sLt?.duroBondBase;
      if (!dbBase) {
        warnings.push(
          `Duro-Bond labor table has no layout / fastening times — section "${s.name}" falls back to the Duro-Last rate chain (docs §22.14).`,
        );
      } else {
        const per = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
        const fieldPlates = bankersRound((fieldArea / 32) * per(s.fastenerOc), 0);
        const perimPlates = bankersRound(
          (perimArea / 32) * per(s.perimFastenerOc) + (cornerArea / 32) * per(s.cornerFastenerOc),
          0,
        );
        const minutes = dbBase.fastenerMinutesByDeck[s.deckType];
        if (minutes === undefined) {
          warnings.push(
            `No Duro-Bond fastening time for deck "${s.deckType}" — section "${s.name}" bills layout labor only.`,
          );
        }
        duroBond = {
          layoutTime: dbBase.layoutHoursPer2500,
          mechSheetMulti: sheetSizeMulti,
          fastenerCount: fieldPlates + perimPlates,
          singleFastenerTime: (minutes ?? 0) / 60,
        };
      }
    }

    // ── Duro-Tuff mechanical ("durotuffmech"): row-based perimeter / corner labor (docs §22.15) ──
    // DuroTuffSystem.RoofSectionLaborHours_4_0_230 bills each written-back row tier
    // (NumCustomRows(i) rows of CustomPerimeterLap(i) inches along PerimTotalLength /
    // CornerTotalLength) at RoofSystem.MechPerimLaborRate's tier-i rate — tab key
    // CustomPerimeterLap(i) / CustomCornerLap(i), on-centre from MechFastenerLookup keyed by that
    // lap (Custom*FastenerSpacing(i) under custom settings; the corner shares the perimeter's
    // looked-up spacing) — and the field on MembraneWithOverlap minus the row areas.
    let duroTuffMech: RoofSection["duroTuffMech"];
    if (rsId === 3 && sys.attachment === "mechanical" && tuff) {
      const lookup = (bid.fastenerLookup ?? []).filter((r) => r.roofSystemId === 3);
      let lookupMissing = false;
      const tierPerimOc = (lapIn: number, i: 0 | 1): number => {
        // Legacy UseCustomSettings → CustomPerimeterFastenerSpacing(i) (the DT form's boxes).
        if (s.tuffCustom) return s.tuffCustom.perimOc[i];
        if (tuffCustom) return s.perimFastenerOc;
        if (!lookup.length) {
          lookupMissing = true;
          return s.perimFastenerOc;
        }
        const r = universalFastenerSpacing(lookup, {
          roofSystemId: 3,
          thickness: s.thickness,
          designTable: s.designTable ?? 60,
          tabSpacings: [lapIn],
          pullTest: s.pullTest ?? 0,
          columnOffset: 1,
        });
        // A failed lookup leaves the legacy out-parameter at its error code (< 0): no on-centre
        // band matches → multiplier 1.0, which onCenterLookup reproduces for a negative value.
        return r.ok ? r.inches : -1;
      };
      const tiers = ([0, 1] as const).map((i) => {
        const perimOc = tierPerimOc(tuff.perimLapIn[i], i);
        return {
          rows: tuff.rows[i],
          lapIn: tuff.perimLapIn[i],
          cornerLapIn: tuff.cornerLapIn[i],
          perimOc,
          cornerOc: s.tuffCustom
            ? s.tuffCustom.cornerOc[i]
            : tuffCustom
              ? s.cornerFastenerOc
              : perimOc,
        };
      });
      if (
        lookupMissing &&
        tiers.some((t) => t.rows > 0) &&
        (zones.perimLengthFt > 0 || zones.cornerLengthFt > 0)
      ) {
        warnings.push(
          `Duro-Tuff perimeter rows on "${s.name}" use the section's stored fastener spacing — the MechFastenerLookup rows were not supplied, so the legacy per-row-width spacing could not be keyed.`,
        );
      }
      duroTuffMech = {
        perimTotalLengthFt: zones.perimLengthFt,
        cornerTotalLengthFt: zones.cornerLengthFt,
        tiers,
      };
    }

    // ── Install-labor inputs (legacy RoofSystem.RoofSectionLaborHours_4_0_230, docs §20.1) ──
    // Labor areas are the zone SHARES of MembraneWithOverlap (MaterialTotalField/Perim/Corner =
    // AreaX / AreaTotal × MembraneWithOverlap), not the raw takeoff areas.
    const areaTotal = s.length * s.width;
    const laborArea = (zone: number): number =>
      areaTotal > 0 ? (zone / areaTotal) * membraneWithOverlap : 0;
    // Perimeter / corner tab multipliers key `CustomPerimeterLap ≠ -1 ? CustomPerimeterLap :
    // PerimeterLap` — and legacy never assigns PerimeterLap (`_perimTabSizeOrRollWidth` has no
    // writer), so the default is 0 → the descending tab walk returns its LAST entry (the smallest
    // tab, e.g. Duro-Last 28" → 1.5125). Corner: CustomCornerLap ≠ -1 ? CustomCornerLap : 0.
    // Duro-Tuff: the membrane routine's written-back CustomPerimeterLap(0) / CustomCornerLap(0)
    // (30" by default) and, on overflow, CustomFieldLap are what the labor lookups then read.
    const laborPerimLap =
      tuff && tuff.rows[0] > 0
        ? tuff.perimLapIn[0]
        : s.perimLap !== undefined && s.perimLap !== -1
          ? s.perimLap
          : 0;
    const laborCornerLap =
      tuff && tuff.rows[0] > 0
        ? tuff.cornerLapIn[0]
        : s.cornerLap !== undefined && s.cornerLap !== -1
          ? s.cornerLap
          : 0;
    const laborFieldLap = tuff && tuff.customFieldLapIn !== -1 ? tuff.customFieldLapIn : s.fieldLap;
    // Adhered attachment (AdheredField/PerimLaborRate): base = AdhesiveCoverage hours / 1000 sq ft
    // for the section's adhesive; × RollGoodWidthAdhesiveMulti(FieldLap) on the roll-good sheet,
    // else × SheetSize.SmartSheetMulti; × ComplexityFactor. Perimeter/corner ×1.2 only for the
    // "durogrip" adhesive with a PerimeterSpacing (code constant).
    let adhesiveBaseHoursPer1000 = 0;
    let adheredSheetMulti = sheetSizeMulti;
    let rollGoods = true;
    let rollGoodWidthMulti = 1;
    let adheredPerimeterBump = false;
    if (sys.attachment === "adhered") {
      adhesiveBaseHoursPer1000 = sLt?.adhesiveBaseHoursByName[sys.adhesiveName] ?? 0;
      if (adhesiveBaseHoursPer1000 <= 0 && sLt) {
        warnings.push(
          `No adhesive install labor (hours / 1,000 sq ft) for ${sys.roofSystem} / ${sys.adhesiveName} — section "${s.name}" bills 0 membrane install hours.`,
        );
      }
      const rollLabel = sLt?.rollGoodsSheetLabel ?? "";
      // SheetSize.SmartSheetMulti on an adhered section is the PER-ADHESIVE table (legacy
      // SSAdheredMulti, seeded in rdl_adhered_sheet_multi); the combo's single column is the
      // fallback when no per-adhesive row exists.
      const perAdhesive = admin.adheredSheetMulti?.[rsId]?.[sheetLabel]?.[sys.adhesiveName];
      if (perAdhesive !== undefined) adheredSheetMulti = perAdhesive;
      rollGoods =
        rollLabel === "" ||
        sheetLabel === rollLabel ||
        (perAdhesive === undefined && !sLt?.sheetSizeMultiByLabel[sheetLabel]);
      if (rollGoods) {
        const w = admin.rollGoodWidthMulti?.[rsId]?.[s.fieldLap];
        if (w === undefined) {
          rollGoodWidthMulti = 1;
          if (adhesiveBaseHoursPer1000 > 0)
            warnings.push(
              `No adhered roll-goods labor multiplier for ${sys.roofSystem} at a ${s.fieldLap}" roll width — section "${s.name}" uses ×1.`,
            );
        } else rollGoodWidthMulti = w;
      }
      const flags = admin.adhesiveFlags?.[sys.adhesiveName];
      adheredPerimeterBump =
        !!flags && flags.shortName === "durogrip" && flags.perimSpacingIn !== -1;
    }

    return {
      id: s.id,
      length: s.length,
      width: s.width,
      fieldArea: laborArea(fieldArea),
      perimArea: laborArea(perimArea),
      cornerArea: laborArea(cornerArea),
      membraneWithOverlap,
      // §2.3: ARP-covered edges are subtracted from the bid's total membrane sq ft.
      arpSqFt: edgesArpSqFt(s.edges ?? []),
      thickness: s.thickness,
      thicknessLabor: sLt?.thicknessLaborByMil[s.thickness] ?? 1,
      designTable: 60,
      pullTest: 0, // unused: fastenerOc supplied directly
      fieldLap: laborFieldLap,
      perimLap: laborPerimLap,
      cornerLap: laborCornerLap,
      // Duro-Tuff custom settings carry their own field spacing (CustomFieldFastenerSpacing).
      customFieldFastenerSpacing: s.tuffCustom?.fieldOc ?? s.fastenerOc,
      customPerimFastenerSpacing: s.perimFastenerOc,
      customCornerFastenerSpacing: s.cornerFastenerOc,
      deckTypeId: sLt?.deckTypeIds[s.deckType] ?? 0,
      sheetSizeMulti: sys.attachment === "adhered" ? adheredSheetMulti : sheetSizeMulti,
      complexity,
      fieldAttachment: sys.attachment,
      perimAttachment: sys.attachment,
      ...(sys.comboKey !== bidComboKey
        ? {
            laborTables: {
              deckTypeMulti: sLt?.deckTypeMulti ?? {},
              tabBands: sLt?.tabBands ?? [],
              onCenterBands: sLt?.onCenterBands ?? [],
              fastenerSpacing: [],
            },
          }
        : {}),
      // Per-section AdjustLabor (legacy RoofSection.AdjustLabor); absent = the bid-level value.
      ...(s.adjustLaborPct !== undefined ? { adjustLaborPct: s.adjustLaborPct } : {}),
      ...(duroBond ? { duroBond } : {}),
      ...(duroTuffMech ? { duroTuffMech } : {}),
      adhesiveBaseHoursPer1000,
      rollGoods,
      rollGoodWidthMulti,
      adheredPerimeterBump,
      tearOff: s.tearOff,
      tearOffLaborLookup,
      // Legacy TearOffBaseLabor: W × L × lookup × SheetSize.SmartSheetMulti × ComplexityFactor.
      tearOffSheetComplexityMulti: sheetSizeMulti * complexity,
      // Legacy TearOffLabor = base × (1 + TO_Additional/100), TO_Additional per section.
      tearOffAdditionalPct: s.tearOffAdditionalPct ?? 0,
      toThicknessInches: s.toThicknessInches,
    };
  });

  // Membrane adhesive units for fully-adhered systems (§2.4): (field+perim+corner area) ÷
  // coverage — bare deck keyed by deck type; over insulation the captured coverage tables are
  // uniform per adhesive (the board→group mapping lives in uncaptured MySQL, so a non-uniform
  // table warns instead of guessing). Tapered/cricket top boards are quote-only → warned.
  // Sections group by their effective (roof system, adhesive) — per-section overrides allowed.
  const adheredGroups = new Map<
    string,
    { roofSystem: string; rsId: number; advName: string; sections: BidSectionInput[] }
  >();
  for (const s of bid.sections) {
    const sys = resolveSectionSystem(bid, s);
    if (sys.attachment !== "adhered") continue;
    const key = `${sys.roofSystem}|${sys.adhesiveName}`;
    const g = adheredGroups.get(key) ?? {
      roofSystem: sys.roofSystem,
      rsId: sys.rsId,
      advName: sys.adhesiveName,
      sections: [],
    };
    g.sections.push(s);
    adheredGroups.set(key, g);
  }
  // Adhered PARAPETS (their own Membrane Options attachment, else the bid's) add their combo
  // so the wall adhesive is examined even when no section is adhered.
  for (const p of bid.parapets) {
    const ps = resolveParapetSystem(bid, p);
    if (ps.attachment !== "adhered") continue;
    const key = `${ps.roofSystem}|${ps.adhesiveName}`;
    if (!adheredGroups.has(key))
      adheredGroups.set(key, {
        roofSystem: ps.roofSystem,
        rsId: ps.rsId,
        advName: ps.adhesiveName,
        sections: [],
      });
  }
  for (const g of adheredGroups.values()) {
    const advName = g.advName;
    const cov = admin.membraneAdhesives?.[g.rsId]?.[advName];
    if (!cov) {
      warnings.push(
        `No membrane-adhesive coverage data for ${g.roofSystem} / ${advName} — membrane adhesive units not billed.`,
      );
    } else {
      for (const s of g.sections) {
        const area = s.length * s.width;
        const layers = sectionLayers(s);
        const topLayer = layers[layers.length - 1];
        const topBoard = topLayer?.board;
        let coverage: number | undefined;
        if (layers.length === 0) coverage = cov.byDeckName[s.deckType];
        // Tapered/cricket AND custom-quote top boards are quote-only (§10.5: legacy quote
        // boards take manual QuoteAdhesiveUnits) — never auto-covered.
        else if (topLayer?.quote || (topBoard && /tapered|crickets/i.test(topBoard)))
          coverage = undefined;
        else {
          // Legacy UnderlaymentCoverage[AdheredTo group]: the top board's group when the admin
          // Adhesives grid gave a per-group cell (docs §22.9), else the uniform seed value.
          const topGid = topBoard
            ? admin.underlaymentGroups?.adhesiveGroupIdByBoard?.[topBoard]
            : undefined;
          const byGroup = topGid !== undefined ? cov.byUnderlaymentGroup?.[topGid] : undefined;
          coverage = byGroup !== undefined ? byGroup : (cov.underlaymentUniform ?? undefined);
        }
        if (coverage && coverage > 0) {
          adhesiveUnitsByName[advName] = (adhesiveUnitsByName[advName] ?? 0) + area / coverage;
        } else {
          warnings.push(
            `Membrane adhesive coverage unknown for section "${s.name}" (${advName} ${
              topBoard ? `over ${topBoard}` : `on ${s.deckType}`
            }) — units not billed; needs a quote.`,
          );
        }
      }
      // Parapet wall adhesive (§2.4 wall coverage). Basis = legacy WallPlusTopSqFt (parity doc
      // §3): Length × (Vertical + WallTop)/12 — vertical + top only, no skirt/cant/drop. Walls
      // without profile dims (older saved bids) keep the full-girth stand-in they priced with.
      // Legacy Parapet.WallAdhesive: ONLY walls whose OWN attachment is adhered (Membrane
      // Options), grouped here by the wall's (roof system, adhesive).
      const adheredWalls = bid.parapets.filter((p) => {
        const ps = resolveParapetSystem(bid, p);
        return (
          ps.attachment === "adhered" &&
          ps.roofSystem === g.roofSystem &&
          ps.adhesiveName === advName
        );
      });
      if (adheredWalls.length > 0) {
        if (cov.wallCoverage) {
          const wallArea = adheredWalls.reduce(
            (sum, p) =>
              sum +
              (parapetHasDims(p)
                ? (p.lengthFt * ((p.verticalInches ?? 0) + (p.wallTopInches ?? 0))) / 12
                : in2Ft(p.girthInches) * p.lengthFt),
            0,
          );
          adhesiveUnitsByName[advName] =
            (adhesiveUnitsByName[advName] ?? 0) + wallArea / cov.wallCoverage;
        } else {
          warnings.push(
            `Parapet wall adhesive coverage unavailable or ambiguous for ${advName} — wall adhesive units not billed.`,
          );
        }
      }
      if (admin.adhesivePrices?.[advName] === undefined) {
        warnings.push(`No adhesive price for "${advName}" — membrane adhesive bills at $0.`);
      }
    }
  }

  // Adhesive whole units (legacy AdheredSystems.AggregateCalcQtys, docs/legacy-consumption-rules
  // §2.4 + §12.4): fractional units summed per adhesive across the WHOLE estimate, then Ceiling
  // ONCE per adhesive; whole units (+ any user EXTRA units from the Adhesives accessory screen)
  // price into M0, each adhesive's cost rounded to WHOLE DOLLARS (legacy AdheredSystem.Cost —
  // §12.4). Membrane and parapet-wall adhesive (above) join the same aggregate.
  const accState: AccessoriesState = normalizeAccessoriesState(bid.accessoriesCalc);
  let adhesiveMaterial = 0;
  /** Whole units per adhesive (the Adhesives screen's Calc Qty column). */
  const adhesiveWholeUnits: Record<string, number> = {};
  {
    const extraSeen = new Set<string>();
    for (const [name, units] of Object.entries(adhesiveUnitsByName)) {
      const extra = accState.adhesivesExtra[name] ?? 0;
      extraSeen.add(name);
      adhesiveWholeUnits[name] = Math.ceil(units);
      adhesiveMaterial += bankersRound(
        (Math.ceil(units) + extra) * (admin.adhesivePrices?.[name] ?? 0),
        0,
      );
    }
    for (const [name, extra] of Object.entries(accState.adhesivesExtra)) {
      if (extra > 0 && !extraSeen.has(name)) {
        adhesiveMaterial += bankersRound(extra * (admin.adhesivePrices?.[name] ?? 0), 0);
      }
    }
  }

  // Accessory material folds into M0 (dMaterial[4] sits within Σ dMaterial[0..6]).
  let accessoryMaterial = bid.accessories.reduce((sum, a) => sum + a.price * a.quantity, 0);

  // Accessory install labor (Σ per-unit hrs × qty) → direct labor (LaborSubtotal1) at the crew rate.
  let accessoryLaborHours = bid.accessories.reduce(
    (sum, a) => sum + (a.laborHoursPerUnit ?? 0) * a.quantity,
    0,
  );

  // Parapets: labor = (length/50) × hrs-per-50-LF[deck][band][drill×cant] → direct labor.
  // Material per legacy Parapet.MembraneCost (docs/legacy-money-parity.md §3): the PARAPETS
  // price tier (Category 3) at the bid-default thickness/color, girth ceiled to a whole inch
  // (AdjustedHeight), length + 1 ft + 1 ft per piece (AdjustedLength; pieces < 1 → 0), each
  // parapet Round2'd → M0. Duro-Tuff bills its 24"-panel variant: heights round up to 6"
  // increments (Ceil(girth/6)/2 ft), then whole 24" panels billed 30" each (the 30" in feet for
  // the sqft basis). Falls back to roll goods (with a warning) when the seeded matrix has no
  // Parapets row for that thickness.
  let parapetLaborHours = 0;
  let parapetMaterial = 0;
  /** Σ parapet ARP sq ft (§8.6) — joins the section ARP in the MembraneAccs CalcQty below. */
  let parapetArpSqFt = 0;
  /** Σ Parapet.AdjustedSqFt (billed height × adjusted length) — legacy Parapets.AdjustedSqFt, the
   *  Review's "Total Membrane sqft" adds it to SqFtTotalMembrane (dTotals[29], docs §22.12). */
  let parapetAdjustedSqFt = 0;
  /** Σ parapet slipsheet polyethylene sq ft (§8.6) — the §14 Others "Slipsheet" CalcQty. */
  let parapetPolySqFt = 0;
  /** Per-parapet legacy ManHours / BaseManHours (the Parapets screen "N MHS (x%)" link). */
  const parapetHoursById: Record<string, number> = {};
  const parapetBaseHoursById: Record<string, number> = {};
  if (bid.parapets.length > 0) {
    const first = bid.sections[0];
    const anyWall = bid.parapets.some((p) => parapetGirthInches(p) > 0 && p.lengthFt > 0);
    // Parapets-tier price for a (thickness, color), with the roll-goods fallback; warnings are
    // deduped per distinct (thickness, color) so a many-wall bid doesn't repeat itself.
    const tierWarned = new Set<string>();
    const parapetTierPrice = (thickness: number, color: string, label: string): number => {
      let price = priceMatrixLookup(admin.priceMatrix, thickness, "parapet", color);
      if (price === null) {
        price = priceMatrixLookup(admin.priceMatrix, thickness, "rollGoods", color);
        if (price !== null && anyWall && !tierWarned.has(`rg|${thickness}|${color}`)) {
          tierWarned.add(`rg|${thickness}|${color}`);
          warnings.push(`No Parapets-tier membrane price (${label}) — using roll goods.`);
        }
      }
      if (anyWall && (price ?? 0) === 0 && !tierWarned.has(`0|${thickness}|${color}`)) {
        tierWarned.add(`0|${thickness}|${color}`);
        warnings.push(`No membrane price for the parapet material (${label}).`);
      }
      return price ?? 0;
    };
    let defaultPrice = 0;
    if (first) {
      defaultPrice = parapetTierPrice(first.thickness, first.color, "bid-default thickness/color");
    } else if (anyWall) {
      // No sections at all: keep the old diagnostic — real walls are pricing at $0.
      warnings.push("No membrane price for the parapet material (bid-default thickness/color).");
    }
    for (const p of bid.parapets) {
      // Per-wall Roof System / Attached With (legacy Membrane Options), bid-level by default.
      const ps = resolveParapetSystem(bid, p);
      const isDuroTuff = ps.roofSystem === "Duro-Tuff";
      const tDeck = TEAROFF_DECK_BY_LABOR_DECK[p.deckType] ?? p.deckType;
      const girth = parapetGirthInches(p);
      const pieces = p.pieces ?? 1;
      const adjustedLengthFt = pieces >= 1 ? p.lengthFt + 1 + pieces : 0;
      // Legacy LookupParapetTimes keys the band from the Vertical dimension (docs §19).
      const band = parapetLaborBand(p, admin.parapetLabor?.bands ?? []);
      const entry = admin.parapetLabor?.lookup[tDeck]?.[band];
      let itemHours = 0;
      if (!entry) {
        if (p.lengthFt > 0)
          warnings.push(
            `No parapet labor for ${p.deckType} / ${band || "(no band)"} — "${p.name}".`,
          );
      } else {
        // Legacy BaseManHours (docs §8.5): (value / 50) × ADJUSTEDLENGTH — the padded
        // length + 1 ft + 1 ft/piece, the same basis the membrane bills — not raw Length.
        itemHours +=
          (adjustedLengthFt / 50) *
          parapetModeRate(
            entry,
            parapetEffectivePredrill(p, ps.attachment),
            parapetEffectiveCanted(p),
          );
      }
      // Legacy AdjustedHeight (family-dependent): Duro-Tuff ceils to 6" increments (half-foot
      // steps); everyone else In2Ft(Ceil(girth)).
      const adjustedHeightFt = isDuroTuff ? Math.ceil(girth / 6) / 2 : in2Ft(Math.ceil(girth));
      let billedHeightFt: number;
      if (isDuroTuff) {
        billedHeightFt = Math.ceil((adjustedHeightFt * 12) / 24) * in2Ft(30); // 24" panels @ 30"
      } else {
        billedHeightFt = adjustedHeightFt;
      }
      // Use Slipsheet (docs §8.6): poly = AdjustedHeight × Length × 1.25 sq ft;
      // labor 0.25 h / 100 sq ft (the legacy BaseManHours poly term).
      if (p.useSlipsheet) {
        const polySqFt = adjustedHeightFt * p.lengthFt * 1.25;
        itemHours += (polySqFt / 100) * 0.25;
        parapetPolySqFt += polySqFt;
      }
      // Per-item labor % (docs §8.7): legacy ManHours = BaseManHours × (1 + AdjustLabor/100),
      // wrapping the whole item (matrix labor + slipsheet labor). The labor template WRITES
      // the same AdjustLabor field (§19/§20.3), so only the wall's own value applies.
      const pAdjust = 1 + (p.adjustLaborPct ?? 0) / 100;
      const manHours = itemHours * pAdjust;
      parapetLaborHours += manHours;
      parapetBaseHoursById[p.id] = itemHours;
      parapetHoursById[p.id] = manHours;
      // Parapet ARP (docs §8.6): ((size+6)/12) × (ARPLength == Length ? AdjustedLength :
      // ARPLength) — no ×1.03, no membrane deduction (both section-side-only).
      if ((p.arpSizeIn ?? 0) > 0) {
        const arpLen = p.arpLengthFt ?? p.lengthFt;
        parapetArpSqFt +=
          (((p.arpSizeIn ?? 0) + 6) / 12) * (arpLen === p.lengthFt ? adjustedLengthFt : arpLen);
      }
      // Legacy prices at the PARAPET's own mil/color (docs §8.5); bid default when unset.
      const ownPrice =
        p.thicknessMil !== undefined || p.color !== undefined
          ? parapetTierPrice(
              p.thicknessMil ?? first?.thickness ?? 0,
              p.color ?? first?.color ?? "",
              `parapet "${p.name}" thickness/color`,
            )
          : defaultPrice;
      parapetMaterial += bankersRound(billedHeightFt * adjustedLengthFt * ownPrice, 2);
      parapetAdjustedSqFt += billedHeightFt * adjustedLengthFt;
    }
  }

  // Curbs (§5.3 / §8.2): (min/LF[deck] × perimeter LF × qty + setup[deck] × qty) / 60 × type
  // multiplier → direct labor. Perimeter = (A + B) × 2 / 12; insulation-on-curb ISO labor adds per §2.
  // Membrane material auto-computes below via the legacy wrap model.
  let curbLaborHours = 0;
  /** Per-curb Curb.ManHours (the legacy "Labor: X hours" link on the Curbs screen). */
  const curbHoursById: Record<string, number> = {};
  for (const c of bid.curbs) {
    if (c.quantity <= 0) continue;
    // Per-item hours accumulate here, then × (1 + adjustLaborPct/100), Round 8dp — the legacy
    // Curb.ManHours composition (docs §8.7) wrapping type labor + ISO + lift labor.
    let itemHours = 0;
    const addItem = () => {
      const manHours = bankersRound(itemHours * (1 + (c.adjustLaborPct ?? 0) / 100), 8);
      curbLaborHours += manHours;
      curbHoursById[c.id] = manHours;
    };
    // Legacy "Insulation on Curb(s)" — Curb.ISO_Labor (rva 0x33718, re-read 2026-09-21, docs
    // §22.12): Round(0.25 + LinealFt × 0.0167 × Qty, 2). The 0.25 h is added ONCE per curb entry;
    // only the per-foot part scales with quantity (the earlier port multiplied both by qty).
    if (c.hasInsulation) {
      const linealFt = (c.widthIn + c.lengthIn) / 6;
      itemHours += bankersRound(0.25 + linealFt * 0.0167 * c.quantity, 2);
    }
    // Legacy "Plastic on Curb(s)" labor (BaseHours: PolyethyleneSqF / 400 hours, docs §8.2),
    // PolyethyleneSqF = Round(LinealFt × (C + D) × 5 / 48 × qty, 8).
    if (c.hasPlastic) {
      const linealFt = (c.widthIn + c.lengthIn) / 6;
      const polySqFt = bankersRound(
        ((linealFt * ((c.dimCIn ?? 0) + (c.dimDIn ?? 0)) * 5) / 48) * c.quantity,
        8,
      );
      itemHours += polySqFt / 400;
    }
    // Lift termination labor (docs §8.2/§8.3): TermOption 2 (Lift & Tuck) / 3 (Lift & T-Bar)
    // add 1 + LF × 0.020833 (12 < LF ≤ 32) or 1 + LF × 0.041667 (LF > 32) hours — ONCE per
    // curb entry (the legacy adder sits outside the × qty terms), LF = (A+B)/6.
    if (c.termOption === 2 || c.termOption === 3) {
      const lf = (c.widthIn + c.lengthIn) / 6;
      if (lf > 32) itemHours += 1 + lf * 0.041667;
      else if (lf > 12) itemHours += 1 + lf * 0.020833;
    }
    const tDeck = TEAROFF_DECK_BY_LABOR_DECK[c.deckType] ?? c.deckType;
    const minutesPerLF = admin.curbLabor?.minutesByDeck[tDeck];
    const typeMultiplier = admin.curbLabor?.multiplierByType[c.curbType];
    if (minutesPerLF === undefined || typeMultiplier === undefined) {
      warnings.push(
        `No curb labor for ${c.deckType} / ${c.curbType || "(no type)"} — "${c.name}".`,
      );
      addItem();
      continue;
    }
    // Legacy lookup_CurbTimes.Base is per deck (col 3 for the curb's deck); the global value is
    // the fallback for decks without an override (docs §22.19).
    itemHours += curbHoursCalc({
      quantity: c.quantity,
      setupMinutes:
        admin.curbLabor?.setupMinutesByDeck?.[tDeck] ?? admin.curbLabor?.setupMinutes ?? 0,
      minutesPerLF,
      typeMultiplier,
      // Legacy BaseHours: (A + B) × 2 / 12 raw — NOT per-dimension In2Ft (which rounds each to
      // 2 dp: 98×110 gave 34.68 vs 34.6667 ft, +0.0055 h on the Knox curb A; docs §22.19).
      perimeterFt: ((c.widthIn + c.lengthIn) * 2) / 12,
    });
    addItem();
  }

  // Curb membrane (legacy Curb.Cost, parity doc §2): the hardcoded prefab-wrap model → M0, at
  // the CURB's own mil/color (the legacy curb screen carries Deck/Mil/Color per curb; bid
  // default when unset). Styles 3/4 are quote-required (warned, $0); curbs without a legacy
  // style (older saved bids) stay manual, exactly as before. An unknown thickness/color bills
  // rate 0 — legacy behavior: the base constants still price.
  let curbMaterial = 0;
  {
    const first = bid.sections[0];
    for (const c of bid.curbs) {
      if (c.styleId === undefined || c.quantity <= 0) continue;
      const mil = c.thicknessMil ?? first?.thickness ?? 0;
      const color = c.color ?? first?.color ?? "";
      const rate = curbWrapRate(mil, color);
      if (rate === 0) {
        warnings.push(
          `No curb wrap rate for ${mil}mil ${color} — curb "${c.name}" bills the base constants only (legacy rate 0).`,
        );
      }
      const cost = curbWrapCost({
        styleId: c.styleId,
        dimAIn: c.widthIn,
        dimBIn: c.lengthIn,
        dimCIn: c.dimCIn ?? 0,
        dimDIn: c.dimDIn ?? 0,
        rate,
        quantity: c.quantity,
      });
      if (cost < 0) {
        warnings.push(
          `Curb style ${c.styleId} requires a quote (legacy) — curb "${c.name}" not auto-priced.`,
        );
        continue;
      }
      curbMaterial += cost;
    }
  }

  // §13 EXCEPTIONAL Metals (docs/legacy-money-parity.md §13). Extracted wiring (ReviewCalc IL):
  // dMaterial[5] = Metals.MaterialCost → inside M0; dLabor[5,0/1] = Metals.LaborCost/Labor —
  // DIRECT labor at each row's OWN LaborRate (never the crew rate), hours join man-days.
  // The calculated screen (metalsCalc) is the legacy 4-dialog model; flat `bid.metals` lines
  // (older bids / extra catalog picks) keep billing identically alongside it.
  let metalsResult: MetalsResult | undefined;
  if (admin.metals) {
    metalsResult = computeMetals(normalizeMetalsState(bid.metalsCalc), admin.metals);
  }
  const metalsMaterial =
    bid.metals.reduce((sum, m) => sum + m.price * m.quantity, 0) +
    (metalsResult?.materialCost ?? 0);
  const metalsLaborCost =
    bid.metals.reduce((sum, m) => sum + m.laborPerUnit * m.laborRate * m.quantity, 0) +
    (metalsResult?.laborCost ?? 0);
  const metalsLaborHours =
    bid.metals.reduce((sum, m) => sum + m.laborPerUnit * m.quantity, 0) +
    (metalsResult?.laborHours ?? 0);

  // ── Auto-priced NDL items (docs §8.3/§8.4/§8.6) ────────────────────────────────────────────
  // The legacy app computed these items' CalcQty from bid geometry and priced them off their
  // seeded ref_ndl rates (admin.autoRates). Routing matches their catalog categories: material →
  // OtherMaterial, labor at the row's OWN rate → direct labor (LS1) with its hours in man-days —
  // exactly how a hand-added line from the same screen routes. A missing rate row leaves the
  // quantity unpriced WITH a warning (no silent $0 when the geometry asked for the item).
  // The bAuto slots below are the ONLY accumulator (they feed the legacy group slots later).
  // Legacy NDLCollectionBase.ReadRefData substitutes the estimate crew rate when a ref row's
  // Labor Rate is 0 (docs §14.1) — the same fallback applies to these seeded rate rows.
  const addAutoItem = (
    qty: number,
    rate: NdlAutoRateItem,
    laborOnly: boolean,
    slot: { material?: number; laborCost: number; hours: number },
  ) => {
    const laborRate = rate.laborRate !== 0 ? rate.laborRate : bid.crewLaborRatePerHour;
    if (!laborOnly && slot.material !== undefined) slot.material += qty * rate.price;
    slot.laborCost += qty * rate.laborPerUnit * laborRate;
    slot.hours += qty * rate.laborPerUnit;
  };

  // When the §14 Non-DL ref data is present, that module OWNS every auto-quantity row
  // (counterflash, blocking, masonry, dumpster, slipsheet/ISO) — the legacy path below only
  // runs on older frozen snapshots without the non_dl screens.
  const nonDlOwnsAuto = admin.nonDl !== undefined;

  // Curb counter flashing (§8.3, termination option 5 "No Lift & Counter Flash"): inches =
  // Σ (A+B) × qty × 2 → Round 2dp → fractional inch UP to the next 0.25 → ÷12 → Round 2dp → Ceil.
  const curbCounterflashFt = (() => {
    const inchesRaw = bid.curbs.reduce(
      (sum, c) =>
        c.termOption === 5 && c.quantity > 0
          ? sum + (c.widthIn + c.lengthIn) * c.quantity * 2
          : sum,
      0,
    );
    if (inchesRaw <= 0) return 0;
    const r2 = bankersRound(inchesRaw, 2);
    const whole = Math.floor(r2);
    const cents = Math.round((r2 - whole) * 100);
    const inches = whole + (Math.ceil(cents / 25) * 25) / 100;
    return Math.ceil(bankersRound(inches / 12, 2));
  })();
  if (!nonDlOwnsAuto && curbCounterflashFt > 0) {
    const rate = admin.autoRates?.counterflash;
    if (rate) addAutoItem(curbCounterflashFt, rate, false, bAuto.counterflash);
    else
      warnings.push(
        `Curb counter flashing: ${curbCounterflashFt} ft needed but no "Curb Counter Flashing" rate row (Sheet Metal Work) — not auto-priced.`,
      );
  }

  // Parapet wood blocking (§8.4, TopOfParapet): CalcQty = Ceil(Σ blocked-wall Length × 1.03).
  // The legacy dialog FOOTER is labor-only, but ReviewCalc.NonDL case 1 bills
  // WallBlockings.MaterialCost into dMaterial[14] (§14.3) — so this frozen-snapshot fallback
  // bills the row's material too (corrected 2026-09-18, docs §22.7).
  const parapetBlockingLinealFt = bid.parapets.reduce(
    (sum, p) => (p.hasBlocking ? sum + p.lengthFt : sum),
    0,
  );
  if (!nonDlOwnsAuto && parapetBlockingLinealFt > 0) {
    const qty = Math.ceil(parapetBlockingLinealFt * 1.03);
    const rate = admin.autoRates?.parapetBlocking;
    if (rate) addAutoItem(qty, rate, false, bAuto.blocking);
    else
      warnings.push(
        `Parapet wood blocking: ${qty} ft needed but no '2" x 4" W/ 8" ISO' rate row (Parapet Wall Blocking) — not auto-priced.`,
      );
  }

  // Capstone masonry (§8.4/§14): remove qty = Ceil(Σ option-1 CapstoneLength / 2) on RefID 1
  // "Remove Only"; re-lay qty = Ceil(Σ option-2 CapstoneLength / 2) on RefID 2 (the Masonry
  // "install" index = the Mortar Mix row in the seed; the §14 module keys by RefID). Option-2
  // sealant tubes (Ceil(Ceil(len)/40)) stay an ordering quantity — the legacy sealant item/rate
  // join is not modeled yet.
  const capLen = (p: ParapetInput) => p.capstoneLengthFt ?? p.lengthFt;
  const capstoneRemoveLf = bid.parapets.reduce(
    (sum, p) => (p.capstoneOption === 1 ? sum + capLen(p) : sum),
    0,
  );
  const capstoneReplaceLf = bid.parapets.reduce(
    (sum, p) => (p.capstoneOption === 2 ? sum + capLen(p) : sum),
    0,
  );
  if (!nonDlOwnsAuto) {
    const removeLen = capstoneRemoveLf;
    const reinstallLen = capstoneReplaceLf;
    if (removeLen > 0) {
      const qty = Math.ceil(removeLen / 2);
      const rate = admin.autoRates?.masonryRemove;
      if (rate) addAutoItem(qty, rate, false, bAuto.masonry);
      else
        warnings.push(
          `Capstone removal: ${qty} units needed but no "Remove Only" rate row (Masonry) — not auto-priced.`,
        );
    }
    if (reinstallLen > 0) {
      const qty = Math.ceil(reinstallLen / 2);
      const rate = admin.autoRates?.masonryReplace;
      if (rate) addAutoItem(qty, rate, false, bAuto.masonry);
      else
        warnings.push(
          `Capstone reinstallation: ${qty} units needed but no "Replace Capstones" rate row (Masonry) — not auto-priced.`,
        );
      const tubes = Math.ceil(Math.ceil(reinstallLen) / 40);
      warnings.push(
        `Capstone sealant: ${tubes} tube${tubes === 1 ? "" : "s"} to order (quantity only — the legacy sealant rate is not auto-priced yet; add it as a catalog line).`,
      );
    }
  }

  // ARP material (§8.6/§12.4, the MembraneAccs "ARP (SqFt)" item → M0): CalcQty = Ceil(Σ section
  // ARP) + Ceil(Σ parapet ARP) — each side ceiled separately, exactly as the legacy collections
  // aggregate. (Section ARP also deducts from membrane sq ft — §2.3, already applied above.)
  // When the §12 accessories ref data is present, the accessories module OWNS the ARP row
  // (calc + user extra, identical math at extra = 0); the legacy fallback below covers older
  // frozen snapshots without it.
  let arpMaterial = 0;
  const arpCalcQty =
    Math.ceil(bid.sections.reduce((sum, s) => sum + edgesArpSqFt(s.edges ?? []), 0)) +
    Math.ceil(parapetArpSqFt);
  if (!admin.accessories) {
    if (arpCalcQty > 0) {
      const price = admin.autoRates?.arpPricePerSqFt;
      if (price !== undefined) arpMaterial = arpCalcQty * price;
      else
        warnings.push(
          `ARP: ${arpCalcQty} sq ft needed but no "ARP (SqFt)" price row (Membrane Accs) — not auto-priced.`,
        );
    }
  }

  // §12 Accessories calculated screens: the whole tab's money path (edge terminations, flashing
  // accessories, calculated items, fasteners) — material joins dMaterial[4], hours join the
  // crew-rate direct labor. Runs only when the admin snapshot carries the §12 ref data (older
  // frozen snapshots keep their previous totals).
  let accessoriesCalcResult: AccessoriesResult | undefined;
  if (admin.accessories) {
    accessoriesCalcResult = computeAccessories({
      state: accState,
      ref: admin.accessories,
      sections: bid.sections,
      parapets: bid.parapets,
      curbs: bid.curbs,
      roofSystem: bid.roofSystem,
      attachment: bid.attachment,
      arpCalcSqFt: arpCalcQty,
      strippingBySection: strippingBySection(bid, admin),
      parapetEdgeFasteners: parapetEdgeFastenersCount(bid.parapets, bid.roofSystem, bid.attachment),
      ...(admin.underlaymentGroups?.groupIdByBoard
        ? { underlaymentSubtypeByBoard: admin.underlaymentGroups.groupIdByBoard }
        : {}),
    });
    warnings.push(...accessoriesCalcResult.warnings);
    // The ARP row keeps its own dMaterial slot (review-ledger attribution); the rest of the
    // module's material joins the accessory slot.
    arpMaterial = accessoriesCalcResult.membraneAccs.arpCost;
    accessoryMaterial +=
      accessoriesCalcResult.totalCost - accessoriesCalcResult.membraneAccs.arpCost;
    accessoryLaborHours += accessoriesCalcResult.manHours;
  }

  // M0 = Σ dMaterial[0..6] (ReviewCalc.Recalculate, docs §22.1/§22.2): each slot is GoodSingle'd
  // as it is stored — [1] GoodSingle(MembraneCostBeforeDiscount), [2] Parapets.TotalCost,
  // [3] Curbs.TotalCost, [4] Accessories.TotalCost (edge terms, flashing, fasteners, ADHESIVES
  // and the MembraneAccs ARP row all live inside it), [5] Metals.MaterialCost, [6] the SLIP-SHEET
  // underlayment tile (RoofSections.UnderlaymentCost(1)) — and dTotals[0] rounds the sum (money.ts).
  const slipSheetMaterial = goodSingle(uMatBySub[1] ?? 0);
  const duroLastMaterial =
    goodSingle(membraneMaterial) +
    goodSingle(parapetMaterial) +
    goodSingle(curbMaterial) +
    goodSingle(accessoryMaterial + adhesiveMaterial + arpMaterial) +
    goodSingle(metalsMaterial) +
    slipSheetMaterial;
  // dTotals[6] = GoodSingle(MaterialTotalUnderlayment(False)) = Σ GoodSingle(dMaterial[7..13]) —
  // tiles 2..8 only (tile 1 is Duro-Last material above). Unmapped boards (tile 0) and the manual
  // seam stay in the underlayment bucket.
  const materialUnderlayment =
    Object.entries(uMatBySub).reduce(
      (sum, [tile, v]) => (Number(tile) === 1 ? sum : sum + goodSingle(v)),
      0,
    ) + bid.materialUnderlayment;

  // Non-DL catalog lines, routed by curated category (docs/legacy-money-parity.md §6):
  //  - Subcontractors / 3rd Party Services: labor AND material → LaborSubtotal2 (legacy
  //    NonDL.MaterialCost EXCLUDES them, so their material never reaches OtherMaterial/tax).
  //  - The six other categories: material → OtherMaterial (dTotals[7], taxable); labor at the
  //    line's OWN rate → direct labor (dLabor[14..19] inside LaborSubtotal1), hours → man-days.
  //  - Uncategorized (older saved lines): previous web routing preserved (material →
  //    OtherMaterial, labor → services).
  // Legacy dMaterial[14..19] / dLabor[14..19] — one slot per ReviewCalc.NonDL group (docs §14.3):
  // 1 = Wall + Edge Blocking, 2 = Deck Materials, 3 = Sheet Metal, 4 = Masonry, 5 = Custom Apps,
  // 6 = Others. Each slot is GoodSingle'd where it is stored (docs §22.2/§22.3).
  const ndlSlots: Array<{ material: number; laborCost: number; hours: number }> = Array.from(
    { length: 7 },
    () => ({ material: 0, laborCost: 0, hours: 0 }),
  );
  ndlSlots[1]!.material += bAuto.blocking.material;
  ndlSlots[1]!.laborCost += bAuto.blocking.laborCost;
  ndlSlots[1]!.hours += bAuto.blocking.hours;
  ndlSlots[3]!.material += bAuto.counterflash.material;
  ndlSlots[3]!.laborCost += bAuto.counterflash.laborCost;
  ndlSlots[3]!.hours += bAuto.counterflash.hours;
  ndlSlots[4]!.material += bAuto.masonry.material;
  ndlSlots[4]!.laborCost += bAuto.masonry.laborCost;
  ndlSlots[4]!.hours += bAuto.masonry.hours;
  let nonDlServices = 0;
  let nonDlSubs = 0;
  for (const l of bid.nonDlLines) {
    const material = l.price * l.quantity;
    // Legacy NDLCollectionBase.ReadRefData: a ref Labor Rate of 0 means "use the estimate crew
    // rate" (docs §14.1) — the flat catalog lines carry the seeded 0 verbatim.
    const lineRate = l.laborRate !== 0 ? l.laborRate : bid.crewLaborRatePerHour;
    const labor = l.laborPerUnit * lineRate * l.quantity;
    if (l.category !== undefined && NON_DL_LS2_CATEGORIES.has(l.category)) {
      // dLabor[24+k] = GoodSingle(MaterialCost + LaborCost) per subs/services item.
      if (l.category === "Subcontractors") nonDlSubs += goodSingle(material + labor);
      else nonDlServices += goodSingle(material + labor);
    } else if (l.category !== undefined) {
      const slot = ndlSlots[NDL_SLOT_BY_CATEGORY[l.category] ?? 6]!;
      slot.material += material;
      slot.laborCost += labor;
      slot.hours += l.laborPerUnit * l.quantity;
    } else {
      ndlSlots[6]!.material += material;
      nonDlServices += goodSingle(labor);
    }
  }

  // §14 Non-Duro-Last Items (docs/legacy-money-parity.md §14): the six legacy dialogs + the
  // auto-quantity hooks. Six material groups → OtherMaterial (dMaterial[14..19], taxable) with
  // labor at each row's own rate → direct labor (LS1) + man-days; Subcontractors / Services →
  // LaborSubtotal2 as material + labor per item.
  const dumpsterUnitYardage = admin.nonDl?.dumpsterYardage ?? 30;
  let nonDlResult: NonDlResult | undefined;
  if (admin.nonDl) {
    let curbPolySqFt = 0;
    let curbIsoSqFt = 0;
    for (const c of bid.curbs) {
      if (c.quantity <= 0) continue;
      const linealFt = (c.widthIn + c.lengthIn) / 6;
      // Curb.PolyethyleneSqF = Round(LinealFt × (C + D) × 5 / 48 × qty, 8); Curb.SF_ISO =
      // LinealFt × qty (IL-exact).
      if (c.hasPlastic)
        curbPolySqFt += bankersRound(
          ((linealFt * ((c.dimCIn ?? 0) + (c.dimDIn ?? 0)) * 5) / 48) * c.quantity,
          8,
        );
      if (c.hasInsulation) curbIsoSqFt += linealFt * c.quantity;
    }
    const geometry: NonDlGeometry = {
      sections: bid.sections
        .filter((s) => s.length * s.width > 0)
        .map((s) => ({
          blockingLinealFt: (s.edges ?? []).reduce((sum, e) => sum + (e.blockingFt ?? 0), 0),
          underlaymentThicknessIn: sectionLayers(s).reduce(
            (sum, l) => sum + (l.quote ? 0 : parseInches(l.board)),
            0,
          ),
        })),
      parapetBlockingLinealFt,
      curbCounterflashFt,
      capstoneRemoveLf,
      capstoneReplaceLf,
      disposalUnits: tearOffVolume(
        bid.sections.map((s) => ({
          length: s.length,
          width: s.width,
          tearOff: s.tearOff,
          toThicknessInches: s.toThicknessInches,
        })),
        1,
        dumpsterUnitYardage,
      ),
      polyethyleneSqFt: parapetPolySqFt + curbPolySqFt,
      curbIsoSqFt,
    };
    nonDlResult = computeNonDl({
      state: normalizeNonDlState(bid.nonDlCalc),
      ref: admin.nonDl,
      geometry,
      crewRate: bid.crewLaborRatePerHour,
    });
    warnings.push(...nonDlResult.warnings);
    for (const [group, slotIx] of Object.entries(NDL_SLOT_BY_GROUP)) {
      const t = nonDlResult.byGroup[group as NonDlGroup];
      const slot = ndlSlots[slotIx]!;
      slot.material += t.material;
      slot.laborCost += t.laborCost;
      slot.hours += t.hours;
    }
    for (const ln of nonDlResult.lines) {
      if (ln.group === "subcontractors") nonDlSubs += goodSingle(ln.materialCost + ln.laborCost);
      else if (ln.group === "services") nonDlServices += goodSingle(ln.materialCost + ln.laborCost);
    }
  }
  // The manual "other material" seam rides the Others slot (dMaterial[19]).
  ndlSlots[6]!.material += bid.otherMaterial;
  // dTotals[7] = GoodSingle(NonDL.MaterialCost) — the RAW six-group sum (rounded in money.ts);
  // dMaterial[20] (tax / freight basis) sums the GoodSingle'd per-group slots instead.
  const otherMaterial = ndlSlots.reduce((sum, g) => sum + g.material, 0);
  const otherMaterialSlotsRounded = ndlSlots.reduce((sum, g) => sum + goodSingle(g.material), 0);
  // dLabor[14..19]: each group's own-rate labor is GoodSingle'd per row. LEGACY QUIRK (docs
  // §22.4): Recalculate then writes Setup labor into dLabor[19] — the Others group's row — so the
  // Others group's labor $ AND hours never reach LaborSubtotal1 / man-days. Reproduced, flagged.
  let nonDlOwnRateCost = 0;
  let nonDlOwnRateHours = 0;
  for (let g = 1; g <= 6; g++) {
    const slot = ndlSlots[g]!;
    if (g === 6 && LEGACY_NDL_OTHERS_LABOR_DROPPED) {
      if (slot.laborCost > 0 || slot.hours > 0) {
        warnings.push(
          `Non-DL "Other" labor (${slot.hours.toFixed(2)} h, $${slot.laborCost.toFixed(2)}) is NOT in Labor Subtotal 1 — legacy ReviewCalc overwrites that group's labor slot with Setup labor (parity quirk, docs §22.4).`,
        );
      }
      continue;
    }
    nonDlOwnRateCost += goodSingle(slot.laborCost);
    nonDlOwnRateHours += slot.hours;
  }
  const servicesCost = bid.servicesCost + nonDlServices;
  // dMaterial[20] = Σ dMaterial[0..19] — every stored (GoodSingle'd) slot; the manual seams
  // (web-only hand-entered $) ride along raw.
  const materialTotalBeforeTax =
    duroLastMaterial + materialUnderlayment + otherMaterialSlotsRounded;

  // Freight (dMaterial[22]) — percent-of-material or the stepped "from" table, on
  // MATERIAL TOTAL BEFORE TAX (dMaterial[20] = ALL material: DL + underlayment + non-DL), per
  // ReviewCalc.Recalculate (docs/legacy-money-parity.md §5). Stepped lookup is STRICTLY greater
  // than the threshold. Percent mode: the legacy IL multiplies the stored value RAW (a fraction);
  // our admin field is entered as a whole percent, hence the /100 — the entry convention is
  // flagged in the parity doc.
  let freight = 0;
  if (admin.settings.shippingMode === "percent") {
    freight = freightPercent(materialTotalBeforeTax, admin.settings.shippingPercent / 100);
  } else if (admin.shippingSteps) {
    freight = freightStepped(materialTotalBeforeTax, admin.shippingSteps);
  }
  const shipping = shippingTotal(freight, bid.extraShipping);

  const inputs: EstimateInputs = {
    formulasVersion: version,
    sections,
    admin: {
      deckTypeMulti: lt?.deckTypeMulti ?? {},
      tabBands: lt?.tabBands ?? [],
      onCenterBands: lt?.onCenterBands ?? [],
      fastenerSpacing: [], // gap — sections supply customFieldFastenerSpacing
      ...(admin.setupTable ? { setupTable: admin.setupTable } : {}),
      ...(admin.inspectionTable ? { inspectionTable: admin.inspectionTable } : {}),
    },
    // Legacy per-estimate adjusts (RoofSection.AdjustLabor default / Estimate.AdjustSetupLabor /
    // Estimate.AdjustInspectionTime) — the labor template seeds these fields (§20.3).
    adjustLaborPct: bid.adjustLaborPct,
    adjustSetupLaborPct: bid.adjustSetupPct ?? 0,
    adjustInspectionPct: bid.adjustInspectionPct ?? 0,
    accessoryLaborHours,
    // dLabor[5,0] = GoodSingle(Metals.LaborCost); dLabor[14..18,0] GoodSingle'd per group above.
    ownRateDirectLaborCost: goodSingle(metalsLaborCost) + nonDlOwnRateCost,
    ownRateDirectLaborHours: metalsLaborHours + nonDlOwnRateHours,
    parapetLaborHours,
    curbLaborHours,
    underlaymentLaborHours,
    underlaymentLaborHoursByTile: uHrsBySub,
    crewLaborRatePerHour: bid.crewLaborRatePerHour,
    tearOffFillFraction: 1,
    dumpsterUnitYardage,
    duroLastMaterial,
    membraneCostBeforeDiscount: membraneMaterial,
    materialUnderlayment,
    otherMaterial,
    materialTotalBeforeTax,
    shipping,
    subsCost: bid.subsCost + nonDlSubs,
    servicesCost,
    prepayDiscount: bid.prepayDiscount,
    stdSizeDiscount: bid.stdSizeDiscount,
    volumeDiscount: bid.volumeDiscount,
    markupMode: bid.markupMode,
    markup: bid.markup,
    salesTax: bid.salesTaxRate ?? admin.settings.salesTax,
    taxMaterialOnly: bid.taxMaterialOnly ?? admin.settings.taxMaterialOnly,
    taxExempt: bid.taxExempt,
    perDiem: bid.perDiem,
    perDiemInMarkup: bid.perDiemInMarkup,
    commission: bid.commission,
    commissionInMarkup: bid.commissionInMarkup,
    hoursPerDay,
    warranty: {
      costPerSqFt: bid.warrantyCostPerSqFt,
      nonEliteMasterCharge: bid.warrantyNonEliteMasterCharge,
      masterEliteCont: admin.settings.masterEliteCont,
      isHighWind: bid.warrantyIsHighWind,
      highWindUpcharge: bid.warrantyHighWindUpcharge,
    },
  };

  const breakdown: ReviewBreakdown = {
    accessoriesMaterial: accessoryMaterial,
    arpMaterial,
    metalsLaborCost,
    metalsLaborHours,
    underlaymentMaterialBySubtype: uMatBySub,
    underlaymentHoursBySubtype: uHrsBySub,
    curbHoursById,
    parapetHoursById,
    parapetBaseHoursById,
    auto: bAuto,
  };
  return {
    inputs,
    warnings,
    breakdown,
    parapetMaterial,
    metalsMaterial,
    adhesiveMaterial,
    curbMaterial,
    slipSheetMaterial,
    reviewMembraneSqFtExtras: {
      parapetAdjustedSqFt,
      parapetArpSqFt,
      sectionArpSqFt: bid.sections.reduce((sum, s) => sum + edgesArpSqFt(s.edges ?? []), 0),
    },
    ...(accessoriesCalcResult ? { accessories: accessoriesCalcResult } : {}),
    ...(metalsResult ? { metalsScreen: metalsResult } : {}),
    ...(nonDlResult ? { nonDl: nonDlResult } : {}),
    adhesiveWholeUnits,
  };
}
