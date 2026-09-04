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

import { areaWithEdgeOverlap } from "./quantities";
import { in2Ft, bankersRound } from "./rounding";
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
} from "./adapters";

/**
 * One insulation/underlayment layer on a section (§4.3, up to 4). Mechanical bills the app's own
 * header formula (layout hrs/2500 + fastener minutes × count); adhesive bills area ÷ coverage units
 * of adhesive (whole-unit rounding happens per adhesive at the estimate level) + labor at
 * hrs/1000 sqft (confirmed scale).
 */
export interface UnderlaymentLayer {
  board: string; // from the Underlayment prices screen
  attachment: "mechanical" | "adhesive";
  fastenersPerBoard: number; // mechanical: fasteners per 4×8 board (app default 5)
  adhesiveName: string; // adhesive: from the Adhesive Times table
  substrate: string; // adhesive: substrate row in that adhesive's grid
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
 * exact per the seeded matrix: (length/50) × hrs-per-50-LF[deck][band][drill×cant]. Material
 * prices at the bid's default (first section's) membrane thickness/color, Parapets tier.
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
}

/**
 * An Exceptional Metals line (gutters, downspouts, pitch pans, collection boxes, two-piece).
 * Same economics as a non-DL line (unit cost + labor/unit at the line's own rate), but the
 * MATERIAL belongs to the Duro-Last material subtotal M0 (§4.8 dMaterial metals slot), not
 * OtherMaterial. Labor $ routes to services (LaborSubtotal2) — FLAGGED FOR BID VALIDATION.
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

export interface BuildResult {
  inputs: EstimateInputs;
  /** Warnings for the UI (e.g. missing price / labor combo). */
  warnings: string[];
  /** Parapet membrane material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  parapetMaterial: number;
  /** Exceptional Metals material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  metalsMaterial: number;
  /** Adhesive material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  adhesiveMaterial: number;
  /** Curb wrap membrane $ (inside duroLastMaterial/M0); split out for display/proposal. */
  curbMaterial: number;
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
    const isRollGoodSheet =
      rsId === 4
        ? false
        : rsId !== 1 || !lt?.rollGoodsSheetLabel || s.sheetSizeLabel === lt.rollGoodsSheetLabel;
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

    // Insulation layers (§4.3, up to 4): board material → dTotals[6]; mechanical layout+fastener
    // labor and adhesive labor → direct labor; adhesive units × price → M0.
    for (const layer of sectionLayers(s)) {
      const area = s.length * s.width;
      const uPrice = admin.underlaymentPrices?.[layer.board];
      if (uPrice === undefined) {
        warnings.push(`No underlayment price for "${layer.board}" — section "${s.name}".`);
      } else {
        // Legacy waste factor (RoofSection.UnderlaymentCost, parity doc §6): area × 1.06 (6%
        // waste) on every board, × 1.03 for the board named "Geotextile".
        const waste = layer.board.trim().toLowerCase() === "geotextile" ? 1.03 : 1.06;
        underlaymentMaterial += area * waste * uPrice;
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
          } else {
            underlaymentLaborHours += underlaymentMechanicalHours({
              areaSqFt: area,
              layoutHoursPer2500: layout,
              minutesPerFastener: minPerFast,
              fastenersPerBoard: layer.fastenersPerBoard > 0 ? layer.fastenersPerBoard : 5,
            });
          }
        }
      } else if (admin.adhesiveTimes) {
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
          if (admin.adhesivePrices?.[layer.adhesiveName] === undefined) {
            warnings.push(`No adhesive price for "${layer.adhesiveName}" — section "${s.name}".`);
          }
          // Fractional units accumulate per adhesive; whole-unit rounding happens ONCE per
          // adhesive after all sections (legacy AggregateCalcQtys), below.
          adhesiveUnitsByName[layer.adhesiveName] =
            (adhesiveUnitsByName[layer.adhesiveName] ?? 0) + a.units;
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

    // Carve the perimeter/corner enhancement zones out of the field area (§2, _230 subtracts both).
    // When per-side edges are defined, the perimeter-marked edges are the source of truth for the
    // perimeter length (the UI keeps perimLengthFt in sync; recomputed here so saved bids agree).
    const perimLengthFt = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
    const perimArea = perimLengthFt * s.enhancementWidthFt;
    const cornerArea = s.cornerLengthFt * s.enhancementWidthFt;
    const fieldArea = Math.max(0, s.length * s.width - perimArea - cornerArea);

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
        const topBoard = layers[layers.length - 1]?.board;
        let coverage: number | undefined;
        if (layers.length === 0) coverage = cov.byDeckName[s.deckType];
        else if (topBoard && /tapered|crickets/i.test(topBoard)) coverage = undefined;
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
  // §2.4): fractional units summed per adhesive across the WHOLE estimate, then Ceiling ONCE per
  // adhesive; the whole units price into M0. Membrane and parapet-wall adhesive (above) join the
  // same aggregate, exactly as in the legacy app.
  let adhesiveMaterial = 0;
  for (const [name, units] of Object.entries(adhesiveUnitsByName)) {
    adhesiveMaterial += Math.ceil(units) * (admin.adhesivePrices?.[name] ?? 0);
  }

  // Accessory material folds into M0 (dMaterial[4] sits within Σ dMaterial[0..6]).
  const accessoryMaterial = bid.accessories.reduce((sum, a) => sum + a.price * a.quantity, 0);

  // Accessory install labor (Σ per-unit hrs × qty) → direct labor (LaborSubtotal1) at the crew rate.
  const accessoryLaborHours = bid.accessories.reduce(
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
  if (bid.parapets.length > 0) {
    const first = bid.sections[0];
    const anyWall = bid.parapets.some((p) => parapetGirthInches(p) > 0 && p.lengthFt > 0);
    let pPrice = first
      ? priceMatrixLookup(admin.priceMatrix, first.thickness, "parapet", first.color)
      : null;
    if (pPrice === null && first) {
      pPrice = priceMatrixLookup(admin.priceMatrix, first.thickness, "rollGoods", first.color);
      if (pPrice !== null && anyWall) {
        warnings.push(
          "No Parapets-tier membrane price (bid-default thickness/color) — using roll goods.",
        );
      }
    }
    if (anyWall && (pPrice ?? 0) === 0) {
      warnings.push("No membrane price for the parapet material (bid-default thickness/color).");
    }
    const isDuroTuff = bid.roofSystem === "Duro-Tuff";
    for (const p of bid.parapets) {
      const tDeck = TEAROFF_DECK_BY_LABOR_DECK[p.deckType] ?? p.deckType;
      const entry = admin.parapetLabor?.lookup[tDeck]?.[p.heightBand];
      if (!entry) {
        if (p.lengthFt > 0)
          warnings.push(
            `No parapet labor for ${p.deckType} / ${p.heightBand || "(no band)"} — "${p.name}".`,
          );
      } else {
        parapetLaborHours += (p.lengthFt / 50) * parapetModeRate(entry, p.predrill, p.canted);
      }
      const girth = parapetGirthInches(p);
      const pieces = p.pieces ?? 1;
      const adjustedLengthFt = pieces >= 1 ? p.lengthFt + 1 + pieces : 0;
      let billedHeightFt: number;
      if (isDuroTuff) {
        const adjustedHeightFt = Math.ceil(girth / 6) / 2; // 6-inch increments, in feet
        billedHeightFt = Math.ceil((adjustedHeightFt * 12) / 24) * in2Ft(30); // 24" panels @ 30"
      } else {
        billedHeightFt = in2Ft(Math.ceil(girth));
      }
      parapetMaterial += bankersRound(billedHeightFt * adjustedLengthFt * (pPrice ?? 0), 2);
    }
  }

  // Curbs (§5.3): qty × (setup min + min/LF[deck] × type multiplier × perimeter LF) / 60 → direct
  // labor. Perimeter = 2 × (In2Ft(A) + In2Ft(B)). Curb membrane material is NOT auto-computed
  // (flagged for the validation bid).
  let curbLaborHours = 0;
  for (const c of bid.curbs) {
    if (c.quantity <= 0) continue;
    const tDeck = TEAROFF_DECK_BY_LABOR_DECK[c.deckType] ?? c.deckType;
    const minutesPerLF = admin.curbLabor?.minutesByDeck[tDeck];
    const typeMultiplier = admin.curbLabor?.multiplierByType[c.curbType];
    if (minutesPerLF === undefined || typeMultiplier === undefined) {
      warnings.push(
        `No curb labor for ${c.deckType} / ${c.curbType || "(no type)"} — "${c.name}".`,
      );
      continue;
    }
    curbLaborHours += curbHoursCalc({
      quantity: c.quantity,
      setupMinutes: admin.curbLabor?.setupMinutes ?? 0,
      minutesPerLF,
      typeMultiplier,
      perimeterFt: 2 * (in2Ft(c.widthIn) + in2Ft(c.lengthIn)),
    });
  }

  // Curb membrane (legacy Curb.Cost, parity doc §2): the hardcoded prefab-wrap model at the
  // bid-default thickness/color wrap rate → M0. Styles 3/4 are quote-required (warned, $0);
  // curbs without a legacy style (older saved bids) stay manual, exactly as before. An unknown
  // thickness/color bills rate 0 — legacy behavior: the base constants still price.
  let curbMaterial = 0;
  {
    const first = bid.sections[0];
    for (const c of bid.curbs) {
      if (c.styleId === undefined || c.quantity <= 0) continue;
      const rate = first ? curbWrapRate(first.thickness, first.color) : 0;
      if (first && rate === 0) {
        warnings.push(
          `No curb wrap rate for ${first.thickness}mil ${first.color} — curb "${c.name}" bills the base constants only (legacy rate 0).`,
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

  // Exceptional Metals: material (price × qty) → M0 (dMaterial metals slot); labor at the line's
  // own rate → services (LaborSubtotal2), like non-DL labor.
  const metalsMaterial = bid.metals.reduce((sum, m) => sum + m.price * m.quantity, 0);
  // Metals labor is DIRECT labor at each line's own rate (legacy dLabor[5] inside LaborSubtotal1,
  // docs/legacy-money-parity.md §6); its hours join LS1 hours (man-days).
  const metalsLaborCost = bid.metals.reduce(
    (sum, m) => sum + m.laborPerUnit * m.laborRate * m.quantity,
    0,
  );
  const metalsLaborHours = bid.metals.reduce((sum, m) => sum + m.laborPerUnit * m.quantity, 0);

  // Apply the template factors to the category hour seams.
  parapetLaborHours *= tf("Parapets Labor");
  curbLaborHours *= tf("Curbs Labor");
  underlaymentLaborHours *= tf("Underlayment Labor");

  // M0 = membrane + accessories + parapet + curb + metals material (dMaterial[0..6] slots).
  const duroLastMaterial =
    membraneMaterial +
    accessoryMaterial +
    parapetMaterial +
    curbMaterial +
    metalsMaterial +
    adhesiveMaterial;
  const materialUnderlayment = underlaymentMaterial + bid.materialUnderlayment;

  // Non-DL catalog lines, routed by curated category (docs/legacy-money-parity.md §6):
  //  - Subcontractors / 3rd Party Services: labor AND material → LaborSubtotal2 (legacy
  //    NonDL.MaterialCost EXCLUDES them, so their material never reaches OtherMaterial/tax).
  //  - The six other categories: material → OtherMaterial (dTotals[7], taxable); labor at the
  //    line's OWN rate → direct labor (dLabor[14..19] inside LaborSubtotal1), hours → man-days.
  //  - Uncategorized (older saved lines): previous web routing preserved (material →
  //    OtherMaterial, labor → services).
  let nonDlMaterial = 0;
  let nonDlServices = 0;
  let nonDlSubs = 0;
  let nonDlOwnRateCost = 0;
  let nonDlOwnRateHours = 0;
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
    dumpsterUnitYardage: 30,
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

  return { inputs, warnings, parapetMaterial, metalsMaterial, adhesiveMaterial, curbMaterial };
}
