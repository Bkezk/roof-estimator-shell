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
 *  - Freight table not wired (0); membrane price tier assumed roll-goods.
 *  - Tear-off labor now wired from the seeded Tearoff Times table (per deck × tear-off type).
 */

import { areaWithEdgeOverlap } from "./quantities";
import { membraneMaterialCost, priceMatrixLookup, shippingTotal } from "./pricing";
import { CURRENT_FORMULAS_VERSION } from "./version";
import type { EstimateInputs, RoofSection, Attachment } from "./estimate";
import type { MarkupMode } from "./money";
import { TEAROFF_DECK_BY_LABOR_DECK, type EngineAdminData } from "./adapters";

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
  sheetSizeLabel: string; // e.g. "1500 sf"
  tearOff: boolean;
  tearOffType: string; // e.g. "BUR < 2\"" (from the Tearoff Times table)
  toThicknessInches: number;
}

export interface BidInput {
  roofSystem: string; // "Duro-Last" | "Duro-Roof" | ...
  attachment: Attachment;
  sections: BidSectionInput[];

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

  const sections: RoofSection[] = bid.sections.map((s) => {
    const price = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color);
    if (price === null) {
      warnings.push(
        `No price for ${s.thickness}mil ${s.color} (roll goods) — section "${s.name}".`,
      );
    }
    const membraneWithOverlap = areaWithEdgeOverlap(s.length, s.width, version);
    membraneMaterial += membraneMaterialCost(membraneWithOverlap, price ?? 0, isDuroRoof);

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

  const duroLastMaterial = membraneMaterial;
  const materialTotalBeforeTax = duroLastMaterial + bid.materialUnderlayment + bid.otherMaterial;
  const shipping = shippingTotal(0, bid.extraShipping); // v1: freight table not wired

  const inputs: EstimateInputs = {
    formulasVersion: version,
    sections,
    admin: {
      deckTypeMulti: lt?.deckTypeMulti ?? {},
      tabBands: lt?.tabBands ?? [],
      onCenterBands: lt?.onCenterBands ?? [],
      fastenerSpacing: [], // gap — sections supply customFieldFastenerSpacing
    },
    adjustLaborPct: bid.adjustLaborPct,
    adjustSetupLaborPct: 0,
    adjustInspectionPct: 0,
    crewLaborRatePerHour: bid.crewLaborRatePerHour,
    tearOffFillFraction: 1,
    dumpsterUnitYardage: 30,
    duroLastMaterial,
    membraneCostBeforeDiscount: membraneMaterial,
    materialUnderlayment: bid.materialUnderlayment,
    otherMaterial: bid.otherMaterial,
    materialTotalBeforeTax,
    shipping,
    subsCost: bid.subsCost,
    servicesCost: bid.servicesCost,
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

  return { inputs, warnings };
}
