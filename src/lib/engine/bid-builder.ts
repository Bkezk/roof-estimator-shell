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

import { areaWithEdgeOverlap, tearOffVolume } from "./quantities";
import { in2Ft, bankersRound } from "./rounding";
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
  type NonDlResult,
  type NonDlState,
} from "./nondl";
import { curbWrapCost, curbWrapRate } from "./curb-wrap";
import { edgesArpSqFt, perimeterFromEdges, type EdgeInput } from "./edges";
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
  underlaymentMechanicalHours,
  underlaymentAdhesive,
  laborTemplateFactor,
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
  attachment: "mechanical" | "adhesive";
  fastenersPerBoard: number; // mechanical: fasteners per 4×8 board (app default 5)
  adhesiveName: string; // adhesive: from the Adhesive Times table
  substrate: string; // adhesive: substrate row in that adhesive's grid
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
 * The legacy "Calculate Pieces" flute-filler calculator (frmFluteFillerCalc, docs §10.7 —
 * rva 0x24a00), VERBATIM: per section (inches; secWid = Round(Width)×12; ff = length ft × 12;
 * r2r = ridge-to-ridge inches): across = Round(ff/r2r); x = secWid/ff;
 * rows = Round(x + (1 − frac(x))); trim = frac(x) ≥ 0.5 ? Round((1 − frac(x)) × across) : 0;
 * pieces += Round(across × rows − trim). With waste: Ceil(total × (1 + plus/100)).
 */
export function fluteFillerPieces(i: {
  sections: Array<{ widthFt: number }>;
  pieceLengthFt: number;
  ridgeToRidgeIn: number;
  wastePct?: number;
}): { pieces: number; piecesWithWaste: number } {
  const ff = i.pieceLengthFt * 12;
  if (ff <= 0 || i.ridgeToRidgeIn <= 0) return { pieces: 0, piecesWithWaste: 0 };
  let total = 0;
  for (const s of i.sections) {
    const secWid = bankersRound(s.widthFt, 0) * 12;
    const across = bankersRound(ff / i.ridgeToRidgeIn, 0);
    const x = secWid / ff;
    const frac = x - Math.floor(x);
    const rows = bankersRound(x + (1 - frac), 0);
    const trim = frac >= 0.5 ? bankersRound((1 - frac) * across, 0) : 0;
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
   * Legacy Enhancement Options (docs §10.3, frmUnderlaymentAdv): custom MECHANICAL fastener
   * densities in fasteners per sq ft, applied per zone to every mechanical layer:
   * count = Round(field × AreaField) + Round(perim × AreaPerimeter) + Round(corner × AreaCorner)
   * (banker's Round, per layer — replaces the default per-board density). Absent = default.
   */
  uCustomFastenerDensity?: { field: number; perim: number; corner: number };
  /**
   * Legacy custom adhesive RIBBON spacing (inches, docs §10.3): adhered-layer adhesive units
   * × 12 / spacing (default ×1). Absent/0 = default coverage.
   */
  uAdhesiveSpacingIn?: number;
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
  crewLaborRatePerHour: number;
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
  /** Auto-priced NDL items (§8.3/§8.4) for the non-DL ledger rows. */
  auto: {
    counterflash: { material: number; laborCost: number; hours: number };
    blocking: { laborCost: number; hours: number };
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
  const rsId = LEGACY_RS_ID_BY_NAME[roofSystem] ?? -1;
  if (rsId === 2 || rsId === 3 || rsId === 5) {
    const variantKey = rsId === 5 ? `${s.thickness}mil` : String(s.thickness);
    return {
      pricePerSqFt: admin.familyMembranePrices?.[roofSystem]?.[variantKey] ?? 0,
      tierLabel: `${roofSystem} flat price`,
    };
  }
  const lt = admin.labor[comboKey(roofSystem, attachment)];
  const midThresholdIn = rsId === 4 ? 57 : 60;
  const hasTabTable = admin.sheetTabSpacings?.[rsId] !== undefined;
  const isRollGoodSheet =
    rsId === 4
      ? !hasTabTable
      : rsId !== 1 ||
        !hasTabTable ||
        !lt?.rollGoodsSheetLabel ||
        s.sheetSizeLabel === lt.rollGoodsSheetLabel;
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

/** Build the engine EstimateInputs from a bid + assembled admin data. */
export function buildEstimateInputs(bid: BidInput, admin: EngineAdminData): BuildResult {
  const warnings: string[] = [];
  const version = CURRENT_FORMULAS_VERSION;
  const isDuroRoof = bid.roofSystem === "Duro-Roof";

  const lt = admin.labor[comboKey(bid.roofSystem, bid.attachment)];
  if (!lt) {
    warnings.push(`No labor table for ${bid.roofSystem} / ${bid.attachment}; labor will be 0.`);
  }

  // Per-category labor template (§3.2): value/100 scales that category's hours; 0 = use default.
  // Applied via the engine's existing adjust knobs (install/setup/inspection/tear-off) and by
  // scaling the parapet/curb/underlayment hour seams. The three accessory sub-areas (Pipe Stacks /
  // Drains / Edge Termination) are NOT applied — the accessory hours are one lump and attributing
  // them would be a fabricated split (FLAGGED; all-zero in the seeded Standard template anyway).
  const tplAreas = bid.laborTemplateName
    ? admin.laborTemplates?.byName[bid.laborTemplateName]
    : undefined;
  if (bid.laborTemplateName && admin.laborTemplates && !tplAreas) {
    warnings.push(`Unknown labor template "${bid.laborTemplateName}" — no adjustment applied.`);
  }
  const tf = (area: string) => laborTemplateFactor(tplAreas, area);

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
    blocking: { laborCost: 0, hours: 0 },
    masonry: { material: 0, laborCost: 0, hours: 0 },
  };
  /** Fractional adhesive units by adhesive name, summed across every section's layers. */
  const adhesiveUnitsByName: Record<string, number> = {};

  const rsId = LEGACY_RS_ID_BY_NAME[bid.roofSystem] ?? -1;
  const sections: RoofSection[] = bid.sections.map((s) => {
    const membraneWithOverlap = areaWithEdgeOverlap(s.length, s.width, version);
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
      const fPrice = admin.familyMembranePrices?.[bid.roofSystem]?.[variantKey];
      if (fPrice === undefined) {
        warnings.push(
          `No ${bid.roofSystem} membrane price for "${variantKey}" — section "${s.name}".`,
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
          !lt?.rollGoodsSheetLabel ||
          s.sheetSizeLabel === lt.rollGoodsSheetLabel;
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
      const zonePerimLengthFt = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
      const shares = membraneZoneShares({
        areaTotal: s.length * s.width,
        areaPerimeter: zonePerimLengthFt * s.enhancementWidthFt,
        areaCorner: s.cornerLengthFt * s.enhancementWidthFt,
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
    // both). When per-side edges are defined, the perimeter-marked edges are the source of truth
    // for the perimeter length (the UI keeps perimLengthFt in sync; recomputed here so saved
    // bids agree). Computed BEFORE the layer loop — the §10.3 custom fastener densities bill
    // per zone area.
    const perimLengthFt = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
    const perimArea = perimLengthFt * s.enhancementWidthFt;
    const cornerArea = s.cornerLengthFt * s.enhancementWidthFt;
    const fieldArea = Math.max(0, s.length * s.width - perimArea - cornerArea);

    // Insulation layers (§4.3, up to 4): board material → dTotals[6]; mechanical layout+fastener
    // labor and adhesive labor → direct labor; adhesive units × price → M0.
    const sLayers = sectionLayers(s);
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
        const qHours = layer.quote.laborInDays ? amt * admin.settings.hoursPerDay : amt;
        underlaymentLaborHours += qHours;
        addSub(uHrsBySub, uTile, qHours);
        continue;
      }
      const uPrice = admin.underlaymentPrices?.[layer.board];
      if (uPrice === undefined) {
        warnings.push(`No underlayment price for "${layer.board}" — section "${s.name}".`);
      } else {
        // Legacy waste factor (RoofSection.UnderlaymentCost, parity doc §6): area × 1.06 (6%
        // waste) on every board, × 1.03 for the board named "Geotextile".
        const waste = layer.board.trim().toLowerCase() === "geotextile" ? 1.03 : 1.06;
        underlaymentMaterial += area * waste * uPrice;
        addSub(uMatBySub, uTile, area * waste * uPrice);
      }
      if (layer.attachment === "mechanical") {
        if (admin.underlaymentLabor) {
          const layout = admin.underlaymentLabor.layoutHoursByProduct[layer.board];
          const uDeck = UNDERLAYMENT_DECK_BY_LABOR_DECK[s.deckType] ?? s.deckType;
          const minPerFast = admin.underlaymentLabor.fastenerMinutesByDeck[uDeck];
          if (layout === undefined || minPerFast === undefined) {
            warnings.push(
              `No underlayment labor for "${layer.board}" on ${s.deckType} — section "${s.name}".`,
            );
          } else if (s.uCustomFastenerDensity) {
            // Enhancement Options custom fastening (docs §10.3, rva 0x4d23c/0x4d00c): the
            // per-layer fastener COUNT is Round(density × zone area) per zone (banker's
            // Round), replacing the default per-board density entirely.
            const d = s.uCustomFastenerDensity;
            const count =
              bankersRound(d.field * fieldArea, 0) +
              bankersRound(d.perim * perimArea, 0) +
              bankersRound(d.corner * cornerArea, 0);
            const mh = (area / 2500) * layout + (minPerFast / 60) * count;
            underlaymentLaborHours += mh;
            addSub(uHrsBySub, uTile, mh);
          } else {
            const mh = underlaymentMechanicalHours({
              areaSqFt: area,
              layoutHoursPer2500: layout,
              minutesPerFastener: minPerFast,
              fastenersPerBoard: layer.fastenersPerBoard > 0 ? layer.fastenersPerBoard : 5,
            });
            underlaymentLaborHours += mh;
            addSub(uHrsBySub, uTile, mh);
          }
        }
      } else if (admin.adhesiveTimes) {
        // §10.7 target 3 (UnderlaymentAdhesive, rva 0x4d470): an adhered layer over a board
        // whose adhesive group ∈ {16 Tapered ISO, 18 Tapered Rigid, 19 Crickets/Other} skips
        // the coverage formula and bills the layer's raw QuoteAdhesiveUnits verbatim (no
        // custom-spacing multiplier — that rides the coverage formula).
        const lowerBoard = li > 0 ? sLayers[li - 1]!.board : undefined;
        const lowerGroup = lowerBoard
          ? admin.underlaymentGroups?.adhesiveGroupIdByBoard?.[lowerBoard]
          : undefined;
        if (lowerGroup !== undefined && QUOTE_ADHESIVE_GROUPS.has(lowerGroup)) {
          const units = layer.quoteAdhesiveUnits ?? 0;
          if (units > 0) {
            if (admin.adhesivePrices?.[layer.adhesiveName] === undefined) {
              warnings.push(`No adhesive price for "${layer.adhesiveName}" — section "${s.name}".`);
            }
            adhesiveUnitsByName[layer.adhesiveName] =
              (adhesiveUnitsByName[layer.adhesiveName] ?? 0) + units;
          } else {
            warnings.push(
              `Adhesive over "${lowerBoard}" needs quote adhesive containers (tapered surface) — section "${s.name}".`,
            );
          }
          continue;
        }
        const entry = admin.adhesiveTimes.bySubstrate[layer.adhesiveName]?.[layer.substrate];
        if (!entry || entry.coverageSqFt <= 0) {
          warnings.push(
            `No adhesive coverage for ${layer.adhesiveName || "(no adhesive)"} / ${layer.substrate || "(no substrate)"} — section "${s.name}".`,
          );
        } else {
          const a = underlaymentAdhesive({
            areaSqFt: area,
            coverageSqFt: entry.coverageSqFt,
            laborPer1000SqFt: entry.labor,
          });
          underlaymentLaborHours += a.hours;
          addSub(uHrsBySub, uTile, a.hours);
          if (admin.adhesivePrices?.[layer.adhesiveName] === undefined) {
            warnings.push(`No adhesive price for "${layer.adhesiveName}" — section "${s.name}".`);
          }
          // Enhancement Options custom ribbon spacing (docs §10.3, rva 0x4d470): units
          // × 12 / spacing (default ×1); the spacing is ribbon on-center inches.
          const spacingMult =
            s.uAdhesiveSpacingIn && s.uAdhesiveSpacingIn > 0 ? 12 / s.uAdhesiveSpacingIn : 1;
          // Fractional units accumulate per adhesive; whole-unit rounding happens ONCE per
          // adhesive after all sections (legacy AggregateCalcQtys), below.
          adhesiveUnitsByName[layer.adhesiveName] =
            (adhesiveUnitsByName[layer.adhesiveName] ?? 0) + a.units * spacingMult;
        }
      }
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

    return {
      id: s.id,
      length: s.length,
      width: s.width,
      fieldArea,
      perimArea,
      cornerArea,
      membraneWithOverlap,
      // §2.3: ARP-covered edges are subtracted from the bid's total membrane sq ft.
      arpSqFt: edgesArpSqFt(s.edges ?? []),
      thickness: s.thickness,
      thicknessLabor: lt?.thicknessLaborByMil[s.thickness] ?? 1,
      designTable: 60,
      pullTest: 0, // unused: fastenerOc supplied directly
      fieldLap: s.fieldLap,
      perimLap: s.fieldLap,
      cornerLap: s.fieldLap,
      customFieldFastenerSpacing: s.fastenerOc,
      customPerimFastenerSpacing: s.perimFastenerOc,
      customCornerFastenerSpacing: s.cornerFastenerOc,
      deckTypeId: lt?.deckTypeIds[s.deckType] ?? 0,
      sheetSizeMulti: lt?.sheetSizeMultiByLabel[s.sheetSizeLabel] ?? 1,
      complexity: 1,
      fieldAttachment: bid.attachment,
      perimAttachment: bid.attachment,
      adhesiveBaseHoursPer1000: 0,
      rollGoods: true,
      rollGoodWidthMulti: 1,
      adheredPerimeterBump: false,
      tearOff: s.tearOff,
      tearOffLaborLookup,
      tearOffAdditionalPct: (tf("Tear-Off Labor") - 1) * 100,
      toThicknessInches: s.toThicknessInches,
    };
  });

  // Membrane adhesive units for fully-adhered systems (§2.4): (field+perim+corner area) ÷
  // coverage — bare deck keyed by deck type; over insulation the captured coverage tables are
  // uniform per adhesive (the board→group mapping lives in uncaptured MySQL, so a non-uniform
  // table warns instead of guessing). Tapered/cricket top boards are quote-only → warned.
  if (bid.attachment === "adhered") {
    const advName = bid.membraneAdhesiveName || "Water Based Adhesive";
    const rsId = LEGACY_RS_ID_BY_NAME[bid.roofSystem];
    const cov = rsId !== undefined ? admin.membraneAdhesives?.[rsId]?.[advName] : undefined;
    if (!cov) {
      warnings.push(
        `No membrane-adhesive coverage data for ${bid.roofSystem} / ${advName} — membrane adhesive units not billed.`,
      );
    } else {
      for (const s of bid.sections) {
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
        else coverage = cov.underlaymentUniform ?? undefined;
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
      if (bid.parapets.length > 0) {
        if (cov.wallCoverage) {
          const wallArea = bid.parapets.reduce(
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
  /** Σ parapet slipsheet polyethylene sq ft (§8.6) — the §14 Others "Slipsheet" CalcQty. */
  let parapetPolySqFt = 0;
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
    const isDuroTuff = bid.roofSystem === "Duro-Tuff";
    for (const p of bid.parapets) {
      const tDeck = TEAROFF_DECK_BY_LABOR_DECK[p.deckType] ?? p.deckType;
      const girth = parapetGirthInches(p);
      const pieces = p.pieces ?? 1;
      const adjustedLengthFt = pieces >= 1 ? p.lengthFt + 1 + pieces : 0;
      const entry = admin.parapetLabor?.lookup[tDeck]?.[p.heightBand];
      let itemHours = 0;
      if (!entry) {
        if (p.lengthFt > 0)
          warnings.push(
            `No parapet labor for ${p.deckType} / ${p.heightBand || "(no band)"} — "${p.name}".`,
          );
      } else {
        // Legacy BaseManHours (docs §8.5): (value / 50) × ADJUSTEDLENGTH — the padded
        // length + 1 ft + 1 ft/piece, the same basis the membrane bills — not raw Length.
        itemHours +=
          (adjustedLengthFt / 50) *
          parapetModeRate(
            entry,
            parapetEffectivePredrill(p, bid.attachment),
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
      // wrapping the whole item (matrix labor + slipsheet labor).
      parapetLaborHours += itemHours * (1 + (p.adjustLaborPct ?? 0) / 100);
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
    }
  }

  // Curbs (§5.3): qty × (setup min + min/LF[deck] × type multiplier × perimeter LF) / 60 → direct
  // labor. Perimeter = 2 × (In2Ft(A) + In2Ft(B)); insulation-on-curb ISO labor adds per §2.
  // Membrane material auto-computes below via the legacy wrap model.
  let curbLaborHours = 0;
  for (const c of bid.curbs) {
    if (c.quantity <= 0) continue;
    // Per-item hours accumulate here, then × (1 + adjustLaborPct/100), Round 8dp — the legacy
    // Curb.ManHours composition (docs §8.7) wrapping type labor + ISO + lift labor.
    let itemHours = 0;
    const addItem = () => {
      curbLaborHours += bankersRound(itemHours * (1 + (c.adjustLaborPct ?? 0) / 100), 8);
    };
    // Legacy "Insulation on Curb(s)" (parity doc §2): ISO_Labor = Round((0.25 + LinealFt ×
    // 0.0167) × qty, 2) hours, LinealFt = (A+B)/6 (the footprint perimeter in feet).
    if (c.hasInsulation) {
      const linealFt = (c.widthIn + c.lengthIn) / 6;
      itemHours += bankersRound((0.25 + linealFt * 0.0167) * c.quantity, 2);
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
    itemHours += curbHoursCalc({
      quantity: c.quantity,
      setupMinutes: admin.curbLabor?.setupMinutes ?? 0,
      minutesPerLF,
      typeMultiplier,
      perimeterFt: 2 * (in2Ft(c.widthIn) + in2Ft(c.lengthIn)),
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
  let autoNdlMaterial = 0;
  let autoOwnRateCost = 0;
  let autoOwnRateHours = 0;
  const addAutoItem = (
    qty: number,
    rate: NdlAutoRateItem,
    laborOnly: boolean,
    slot: { material?: number; laborCost: number; hours: number },
  ) => {
    if (!laborOnly) {
      autoNdlMaterial += qty * rate.price;
      if (slot.material !== undefined) slot.material += qty * rate.price;
    }
    autoOwnRateCost += qty * rate.laborPerUnit * rate.laborRate;
    autoOwnRateHours += qty * rate.laborPerUnit;
    slot.laborCost += qty * rate.laborPerUnit * rate.laborRate;
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
  // The legacy dialog total is labor-only (TotalCost = LaborCost), but ReviewCalc bills the
  // row's material into dMaterial[14] (§14) — the §14 module does; this older path keeps its
  // previous labor-only behaviour for frozen snapshots.
  const parapetBlockingLinealFt = bid.parapets.reduce(
    (sum, p) => (p.hasBlocking ? sum + p.lengthFt : sum),
    0,
  );
  if (!nonDlOwnsAuto && parapetBlockingLinealFt > 0) {
    const qty = Math.ceil(parapetBlockingLinealFt * 1.03);
    const rate = admin.autoRates?.parapetBlocking;
    if (rate) addAutoItem(qty, rate, true, bAuto.blocking);
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
      parapetEdgeFasteners: parapetEdgeFastenersCount(bid.parapets, bid.roofSystem, bid.attachment),
    });
    warnings.push(...accessoriesCalcResult.warnings);
    // The ARP row keeps its own dMaterial slot (review-ledger attribution); the rest of the
    // module's material joins the accessory slot.
    arpMaterial = accessoriesCalcResult.membraneAccs.arpCost;
    accessoryMaterial +=
      accessoriesCalcResult.totalCost - accessoriesCalcResult.membraneAccs.arpCost;
    accessoryLaborHours += accessoriesCalcResult.manHours;
  }

  // Apply the template factors to the category hour seams.
  parapetLaborHours *= tf("Parapets Labor");
  curbLaborHours *= tf("Curbs Labor");
  underlaymentLaborHours *= tf("Underlayment Labor");
  for (const k of Object.keys(uHrsBySub)) uHrsBySub[Number(k)]! *= tf("Underlayment Labor");

  // M0 = membrane + accessories + parapet + curb + metals + ARP material (dMaterial[0..6] slots).
  const duroLastMaterial =
    membraneMaterial +
    accessoryMaterial +
    parapetMaterial +
    curbMaterial +
    metalsMaterial +
    adhesiveMaterial +
    arpMaterial;
  const materialUnderlayment = underlaymentMaterial + bid.materialUnderlayment;

  // Non-DL catalog lines, routed by curated category (docs/legacy-money-parity.md §6):
  //  - Subcontractors / 3rd Party Services: labor AND material → LaborSubtotal2 (legacy
  //    NonDL.MaterialCost EXCLUDES them, so their material never reaches OtherMaterial/tax).
  //  - The six other categories: material → OtherMaterial (dTotals[7], taxable); labor at the
  //    line's OWN rate → direct labor (dLabor[14..19] inside LaborSubtotal1), hours → man-days.
  //  - Uncategorized (older saved lines): previous web routing preserved (material →
  //    OtherMaterial, labor → services).
  let nonDlMaterial = autoNdlMaterial;
  let nonDlServices = 0;
  let nonDlSubs = 0;
  let nonDlOwnRateCost = autoOwnRateCost;
  let nonDlOwnRateHours = autoOwnRateHours;
  for (const l of bid.nonDlLines) {
    const material = l.price * l.quantity;
    const labor = l.laborPerUnit * l.laborRate * l.quantity;
    if (l.category !== undefined && NON_DL_LS2_CATEGORIES.has(l.category)) {
      if (l.category === "Subcontractors") nonDlSubs += material + labor;
      else nonDlServices += material + labor;
    } else if (l.category !== undefined) {
      nonDlMaterial += material;
      nonDlOwnRateCost += labor;
      nonDlOwnRateHours += l.laborPerUnit * l.quantity;
    } else {
      nonDlMaterial += material;
      nonDlServices += labor;
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
    nonDlMaterial += nonDlResult.otherMaterial;
    nonDlOwnRateCost += nonDlResult.ownRateLaborCost;
    nonDlOwnRateHours += nonDlResult.ownRateLaborHours;
    nonDlSubs += nonDlResult.subsCost;
    nonDlServices += nonDlResult.servicesCost;
  }
  const otherMaterial = bid.otherMaterial + nonDlMaterial;
  const servicesCost = bid.servicesCost + nonDlServices;
  const materialTotalBeforeTax = duroLastMaterial + materialUnderlayment + otherMaterial;

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
    adjustLaborPct: ((1 + bid.adjustLaborPct / 100) * tf("Roof Section Labor") - 1) * 100,
    adjustSetupLaborPct: ((1 + (bid.adjustSetupPct ?? 0) / 100) * tf("Setup Time Labor") - 1) * 100,
    adjustInspectionPct:
      ((1 + (bid.adjustInspectionPct ?? 0) / 100) * tf("Inspection Time Labor") - 1) * 100,
    accessoryLaborHours,
    ownRateDirectLaborCost: metalsLaborCost + nonDlOwnRateCost,
    ownRateDirectLaborHours: metalsLaborHours + nonDlOwnRateHours,
    parapetLaborHours,
    curbLaborHours,
    underlaymentLaborHours,
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
    salesTax: admin.settings.salesTax,
    taxMaterialOnly: admin.settings.taxMaterialOnly,
    taxExempt: bid.taxExempt,
    perDiem: bid.perDiem,
    perDiemInMarkup: bid.perDiemInMarkup,
    commission: bid.commission,
    commissionInMarkup: bid.commissionInMarkup,
    hoursPerDay: admin.settings.hoursPerDay,
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
    ...(accessoriesCalcResult ? { accessories: accessoriesCalcResult } : {}),
    ...(metalsResult ? { metalsScreen: metalsResult } : {}),
    ...(nonDlResult ? { nonDl: nonDlResult } : {}),
    adhesiveWholeUnits,
  };
}
