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
 *    length × enhancement-width (§2), billed at the perimeter/corner rate; the exact perimeter
 *    geometry (which edges, corner sizing) is entered by the estimator rather than derived.
 *  - On-center spacing is entered per section (fastenerOc) because the pull-test→spacing table isn't
 *    captured yet; it feeds customFieldFastenerSpacing so the OC lookup is bypassed.
 *  - Freight wired: percent-of-material or the stepped "from" table, on the DL material subtotal
 *    (M0). Membrane price tier assumed roll-goods.
 *  - Tear-off labor wired from the seeded Tearoff Times table (per deck × tear-off type).
 *  - Underlayment material wired from the seeded Underlayment prices (board $/sqft × deck area).
 *  - Setup & inspection hours wired from the seeded band tables (§2.4/§2.5) when present; they roll
 *    into direct labor. The per-estimate Adjust Setup/Inspection % knobs stay 0 until the UI adds
 *    them (the engine already accepts them).
 *  - Accessory material wired: a bid carries accessory line items (description + snapshot price +
 *    quantity); the total folds into M0. Accessory LABOR is wired too: each line carries per-unit
 *    hours (prefilled from the accessory_labor single-hours screens where an exact description
 *    matches, else entered); Σ(hrs × qty) folds into direct labor. Per-foot / drill-variant /
 *    fastener-derived accessory labor is entered manually until a captured bid validates it.
 *  - Non-DL catalog lines wired: material (Price × qty) → OtherMaterial (taxable); labor
 *    (LaborPerUnit × Labor Rate × qty) → services (LaborSubtotal2).
 *  - Parapets wired (§5.3): labor = (length/50) × the seeded deck × height-band × drill/cant matrix
 *    → direct labor; material = In2Ft(girth) × length × bid-default membrane $/sqft → M0. Height
 *    band + girth are entered (profile-dims derivation flagged for the validation bid).
 */

import { areaWithEdgeOverlap } from "./quantities";
import { in2Ft } from "./rounding";
import {
  membraneMaterialCost,
  priceMatrixLookup,
  shippingTotal,
  freightStepped,
  freightPercent,
} from "./pricing";
import { CURRENT_FORMULAS_VERSION } from "./version";
import type { EstimateInputs, RoofSection, Attachment } from "./estimate";
import type { MarkupMode } from "./money";
import { TEAROFF_DECK_BY_LABOR_DECK, parapetModeRate, type EngineAdminData } from "./adapters";

export interface BidSectionInput {
  id: string;
  name: string;
  length: number;
  width: number;
  deckType: string; // e.g. "Wood"
  thickness: number; // 40 / 50 / 60
  color: string; // e.g. "White"
  fieldLap: number; // tab lap inches
  fastenerOc: number; // field on-center inches (entered; auto-lookup pending capture)
  // perimeter / corner enhancement zones (§2)
  perimLengthFt: number; // total perimeter enhancement edge length
  cornerLengthFt: number; // total corner enhancement length
  enhancementWidthFt: number; // zone depth in from the edge (e.g. 3)
  perimFastenerOc: number; // tighter OC in the perimeter zone
  cornerFastenerOc: number; // tighter OC in the corner zone
  underlaymentBoard: string; // board name (from Underlayment prices); "" = none
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
 * snapshotted when added. Material folds into OtherMaterial; the labor $ folds into services.
 */
export interface NonDlLine {
  description: string;
  price: number; // material $/unit
  laborPerUnit: number; // labor hours/unit
  laborRate: number; // $/hr for this line's labor
  quantity: number;
}

/**
 * A parapet wall on a bid (§4.4/§5.3). SIMPLIFIED GEOMETRY, FLAGGED FOR BID VALIDATION: the
 * height BAND is picked from the seeded band list and the membrane girth (skirt+cant+vertical+
 * top+drop) is entered directly in inches — the legacy profile-dims→band/girth derivation and the
 * exact parapet membrane overlap model need a captured bid. Labor is exact per the seeded matrix:
 * (length/50) × hrs-per-50-LF[deck][band][drill×cant]. Material prices at the bid's default
 * (first section's) membrane thickness/color, roll-goods tier.
 */
export interface ParapetInput {
  id: string;
  name: string;
  lengthFt: number;
  heightBand: string; // picked from the seeded wall-height bands
  deckType: string; // labor deck name (Wood/Steel/…), bridged via TEAROFF_DECK_BY_LABOR_DECK
  predrill: boolean;
  canted: boolean;
  girthInches: number; // membrane girth over the wall profile, for material area
}

export interface BidInput {
  roofSystem: string; // "Duro-Last" | "Duro-Roof" | ...
  attachment: Attachment;
  sections: BidSectionInput[];
  accessories: AccessoryLine[];
  nonDlLines: NonDlLine[];
  parapets: ParapetInput[];

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

/** The DB labor combo key uses "adhesive"; the engine attachment enum uses "adhered". */
const comboKey = (system: string, attachment: Attachment): string =>
  `${system}|${attachment === "adhered" ? "adhesive" : "mechanical"}`;

export interface BuildResult {
  inputs: EstimateInputs;
  /** Warnings for the UI (e.g. missing price / labor combo). */
  warnings: string[];
  /** Parapet membrane material $ (inside duroLastMaterial/M0); split out for display/proposal. */
  parapetMaterial: number;
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

  let membraneMaterial = 0;
  let underlaymentMaterial = 0;

  const sections: RoofSection[] = bid.sections.map((s) => {
    const price = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color);
    if (price === null) {
      warnings.push(
        `No price for ${s.thickness}mil ${s.color} (roll goods) — section "${s.name}".`,
      );
    }
    const membraneWithOverlap = areaWithEdgeOverlap(s.length, s.width, version);
    membraneMaterial += membraneMaterialCost(membraneWithOverlap, price ?? 0, isDuroRoof);

    // Underlayment material: board $/sqft × roof-deck area (§ dTotals[6], a separate purchase line).
    if (s.underlaymentBoard) {
      const uPrice = admin.underlaymentPrices?.[s.underlaymentBoard];
      if (uPrice === undefined) {
        warnings.push(`No underlayment price for "${s.underlaymentBoard}" — section "${s.name}".`);
      } else {
        underlaymentMaterial += s.length * s.width * uPrice;
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
    const perimArea = s.perimLengthFt * s.enhancementWidthFt;
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
      arpSqFt: 0,
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
      tearOffAdditionalPct: 0,
      toThicknessInches: s.toThicknessInches,
    };
  });

  // Accessory material folds into M0 (dMaterial[4] sits within Σ dMaterial[0..6]).
  const accessoryMaterial = bid.accessories.reduce((sum, a) => sum + a.price * a.quantity, 0);

  // Accessory install labor (Σ per-unit hrs × qty) → direct labor (LaborSubtotal1) at the crew rate.
  const accessoryLaborHours = bid.accessories.reduce(
    (sum, a) => sum + (a.laborHoursPerUnit ?? 0) * a.quantity,
    0,
  );

  // Parapets (§5.3): labor = (length/50) × hrs-per-50-LF[deck][band][drill×cant] → direct labor;
  // material = In2Ft(girth) × length × the bid-default membrane $/sqft → M0 (dMaterial[1] slot).
  let parapetLaborHours = 0;
  let parapetMaterial = 0;
  if (bid.parapets.length > 0) {
    const first = bid.sections[0];
    const pPrice = first
      ? (priceMatrixLookup(admin.priceMatrix, first.thickness, "rollGoods", first.color) ?? 0)
      : 0;
    if (bid.parapets.some((p) => p.girthInches > 0 && p.lengthFt > 0) && pPrice === 0) {
      warnings.push("No membrane price for the parapet material (bid-default thickness/color).");
    }
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
      parapetMaterial += in2Ft(p.girthInches) * p.lengthFt * pPrice;
    }
  }

  // M0 = membrane + accessories + parapet material (dMaterial[0..6] slots).
  const duroLastMaterial = membraneMaterial + accessoryMaterial + parapetMaterial;
  const materialUnderlayment = underlaymentMaterial + bid.materialUnderlayment;

  // Non-DL catalog lines: material (Price × qty) → OtherMaterial (dTotals[7], taxable purchases);
  // labor $ (LaborPerUnit hours × its own Labor Rate × qty) → services (LaborSubtotal2). Both subs
  // and services land in row 11, so non-DL labor routes to services (the split is display-only).
  const nonDlMaterial = bid.nonDlLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const nonDlServices = bid.nonDlLines.reduce(
    (sum, l) => sum + l.laborPerUnit * l.laborRate * l.quantity,
    0,
  );
  const otherMaterial = bid.otherMaterial + nonDlMaterial;
  const servicesCost = bid.servicesCost + nonDlServices;
  const materialTotalBeforeTax = duroLastMaterial + materialUnderlayment + otherMaterial;

  // Freight (§4.1 dTotals[9]) — percent-of-material or the stepped "from" table, on the Duro-Last
  // material subtotal (M0), the "Duro-Last material" the admin Shipping screen bills against.
  // FLAGGED FOR BID VALIDATION (Phase 6): the exact freight basis (M0 vs membrane-only vs
  // material-before-tax) and the stored scale of shipping_percent (whole percent vs fraction) both
  // need a captured bid to confirm; percent mode divides by 100 (admin enters e.g. 5 for 5%).
  let freight = 0;
  if (admin.settings.shippingMode === "percent") {
    freight = freightPercent(duroLastMaterial, admin.settings.shippingPercent / 100);
  } else if (admin.shippingSteps) {
    freight = freightStepped(duroLastMaterial, admin.shippingSteps);
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
    adjustLaborPct: bid.adjustLaborPct,
    adjustSetupLaborPct: 0,
    adjustInspectionPct: 0,
    accessoryLaborHours,
    parapetLaborHours,
    crewLaborRatePerHour: bid.crewLaborRatePerHour,
    tearOffFillFraction: 1,
    dumpsterUnitYardage: 30,
    duroLastMaterial,
    membraneCostBeforeDiscount: membraneMaterial,
    materialUnderlayment,
    otherMaterial,
    materialTotalBeforeTax,
    shipping,
    subsCost: bid.subsCost,
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

  return { inputs, warnings, parapetMaterial };
}
