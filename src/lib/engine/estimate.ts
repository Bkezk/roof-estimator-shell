/**
 * Estimate orchestrator (Phase 4e) — runs quantities → labor → warranty → money end-to-end.
 *
 * This wires the four validated engine cores together. What it DOES compute from formulas:
 * roof/membrane square footage, setup/inspection/tear-off/disposal, per-section install hours
 * (resolving the admin multipliers into field/perim/corner rates), warranty cost, and the full
 * money chain.
 *
 * SEAMS (provided as inputs, not yet computed here — the material-cost/pricing layer is future work):
 *  - Duro-Last material subtotal, membrane material cost, underlayment, other material, shipping.
 *  - Subcontractor / services costs and the crew labor $/hr.
 *  - Per-section field/perim/corner AREAS (the §8 version-branched raw-vs-material-total basis is
 *    resolved upstream) and membrane-with-overlap sq ft (roll-goods geometry is still unvalidated).
 *
 * FLAGGED FOR BID VALIDATION (Phase 6): the exact membership of the direct-labor subtotal
 * (LaborSubtotal1) — here modeled as install + setup + inspection + underlayment + tear-off + accessory + parapet + curb hours at
 * one crew rate — must be confirmed against a captured bid, along with the roll-goods geometry and
 * .NET rounding.
 */

import { calcLaborCost, goodSingle } from "./rounding";
import {
  sqFtTotalMembrane,
  setupTime,
  inspectionTime,
  tearOffLaborTotal,
  tearOffVolume,
} from "./quantities";
import type {
  SetupBandTable,
  InspectionBandTable,
  TearOffSection,
  DisposalSection,
} from "./quantities";
import {
  mechLaborRate,
  adheredFieldLaborRate,
  adheredPerimCornerLaborRate,
  bandLookup,
  directLookup,
  universalFastenerSpacing,
  roofSectionLaborHours,
  duroBondLaborHours,
  type Band,
  type DualValue,
  type FastenerSpacingRow,
} from "./labor";
import { warrantyTotalCost, type WarrantyCostInputs } from "./warranty";
import { computeMoney, type MoneyResult, type MarkupMode } from "./money";

export type Attachment = "mechanical" | "adhered";

export interface AdminLaborTables {
  deckTypeMulti: Record<number, DualValue>;
  tabBands: Band[];
  onCenterBands: Band[];
  fastenerSpacing: FastenerSpacingRow[];
  setupTable?: SetupBandTable;
  inspectionTable?: InspectionBandTable;
}

export interface RoofSection {
  id: string;
  length: number;
  width: number;
  /** Field/perim/corner areas, resolved upstream per the §8 version-branched basis. */
  fieldArea: number;
  perimArea: number;
  cornerArea: number;
  /** Membrane material sq ft with overlap (roll-goods calc / edge overlap), and ARP to subtract. */
  membraneWithOverlap: number;
  arpSqFt: number;
  // membrane / attachment inputs
  thickness: number; // MembraneType.Thickness (40 / 50 / 60) — fastener-spacing lookup key
  thicknessLabor: number; // MembraneType.Labor.SmartValue (thickness factor)
  designTable: number; // 60 / 90 psf
  pullTest: number;
  fieldLap: number; // FieldLap (tab lap) inches
  perimLap: number;
  cornerLap: number;
  customFieldFastenerSpacing: number; // -1 = none
  customPerimFastenerSpacing: number;
  customCornerFastenerSpacing: number;
  deckTypeId: number;
  sheetSizeMulti: number;
  complexity: number;
  fieldAttachment: Attachment;
  perimAttachment: Attachment;
  // adhered inputs (used when an attachment is "adhered")
  adhesiveBaseHoursPer1000: number;
  rollGoods: boolean;
  rollGoodWidthMulti: number;
  adheredPerimeterBump: boolean;
  // DuroBond alternative model (when set, overrides the rate chain for this section)
  duroBond?: {
    layoutTime: number;
    mechSheetMulti: number;
    fastenerCount: number;
    singleFastenerTime: number;
  };
  // tear-off / disposal
  tearOff: boolean;
  tearOffLaborLookup: number;
  tearOffSheetComplexityMulti?: number;
  tearOffAdditionalPct: number;
  toThicknessInches: number;
}

export interface EstimateInputs {
  formulasVersion: string;
  sections: RoofSection[];
  admin: AdminLaborTables;

  // per-estimate labor adjustments
  adjustLaborPct: number;
  adjustSetupLaborPct: number;
  adjustInspectionPct: number;
  crewLaborRatePerHour: number;
  /** Accessory install labor hours (Σ per-unit hrs × qty); billed as direct labor at the crew rate. */
  accessoryLaborHours?: number;
  /**
   * Own-rate direct-labor DOLLARS (legacy dLabor entries priced at each line's own rate: metals
   * dLabor[5], non-DL categories dLabor[14..19]); added to LaborSubtotal1 after the crew-rate
   * hours are priced.
   */
  ownRateDirectLaborCost?: number;
  /** The hours behind ownRateDirectLaborCost; they join LS1 hours (man-days basis). */
  ownRateDirectLaborHours?: number;
  /** Parapet install labor hours (Σ length/50 × matrix rate); billed as direct labor at the crew rate. */
  parapetLaborHours?: number;
  /** Curb install labor hours (qty × (setup + min/LF × type × perimeter) / 60); direct labor. */
  curbLaborHours?: number;
  /** Underlayment install labor hours (layout + fastener time, or adhesive labor); direct labor. */
  underlaymentLaborHours?: number;

  // tear-off / disposal
  tearOffFillFraction: number; // Estimate.TearOff_VolumeMod
  dumpsterUnitYardage: number; // Settings.DumpsterYards

  // provided material $ (pricing-layer seam)
  duroLastMaterial: number;
  membraneCostBeforeDiscount: number;
  materialUnderlayment: number;
  otherMaterial: number;
  materialTotalBeforeTax: number;
  shipping: number;
  subsCost: number;
  servicesCost: number;

  // discounts / markup / tax / per-diem / commission (money chain)
  prepayDiscount: boolean;
  stdSizeDiscount: boolean;
  volumeDiscount: boolean;
  markupMode: MarkupMode;
  markup: number;
  salesTax: number;
  taxMaterialOnly: boolean;
  taxExempt: boolean;
  perDiem: number;
  perDiemInMarkup: boolean;
  commission: number;
  commissionInMarkup: boolean;
  hoursPerDay: number;

  // warranty (rate values from admin; resolved high-wind upcharge passed in)
  warranty: Omit<WarrantyCostInputs, "sqFtTotalMembrane">;
}

export interface EstimateResult {
  roofSqFootage: number;
  sqFtTotalMembrane: number;
  setupHours: number;
  inspectionHours: number;
  parapetLaborHours: number;
  curbLaborHours: number;
  underlaymentLaborHours: number;
  tearOffLaborHours: number;
  disposalUnits: number;
  installHours: number;
  laborSubtotal1Hours: number;
  laborSubtotal1: number;
  laborSubtotal2: number;
  warrantyTotalCost: number;
  money: MoneyResult;
}

/** Resolve a section's field / perimeter / corner per-sq-ft labor rates from the admin tables. */
export function resolveSectionRates(
  s: RoofSection,
  admin: AdminLaborTables,
): { fieldRate: number; perimRate: number; cornerRate: number } {
  // ── FIELD ──
  let fieldRate: number;
  if (s.fieldAttachment === "mechanical") {
    const oc =
      s.customFieldFastenerSpacing !== -1
        ? s.customFieldFastenerSpacing
        : universalFastenerSpacing(admin.fastenerSpacing, {
            thickness: s.thickness,
            designTable: s.designTable,
            tabLap: s.fieldLap,
            pullTest: s.pullTest,
            which: 0,
          }).onCenter;
    fieldRate = mechLaborRate({
      deckMulti: directLookup(admin.deckTypeMulti, s.deckTypeId),
      tabMulti: bandLookup(admin.tabBands, s.fieldLap),
      ocMulti: bandLookup(admin.onCenterBands, oc),
      sheetSizeMulti: s.sheetSizeMulti,
      complexity: s.complexity,
    });
  } else {
    fieldRate = adheredFieldLaborRate({
      baseHoursPer1000: s.adhesiveBaseHoursPer1000,
      rollGoods: s.rollGoods,
      rollGoodWidthMulti: s.rollGoodWidthMulti,
      sheetSizeMulti: s.sheetSizeMulti,
      complexity: s.complexity,
    });
  }

  // ── PERIMETER & CORNER ──
  let perimRate: number;
  let cornerRate: number;
  if (s.perimAttachment === "mechanical") {
    const deckDefault = directLookup(admin.deckTypeMulti, s.deckTypeId, true); // DEFAULT column
    const perimOc =
      s.customPerimFastenerSpacing !== -1
        ? s.customPerimFastenerSpacing
        : universalFastenerSpacing(admin.fastenerSpacing, {
            thickness: s.thickness,
            designTable: s.designTable,
            tabLap: s.perimLap,
            pullTest: s.pullTest,
            which: 1,
          }).onCenter;
    const cornerOc = s.customCornerFastenerSpacing !== -1 ? s.customCornerFastenerSpacing : perimOc;
    perimRate = mechLaborRate({
      deckMulti: deckDefault,
      tabMulti: bandLookup(admin.tabBands, s.perimLap),
      ocMulti: bandLookup(admin.onCenterBands, perimOc),
      sheetSizeMulti: s.sheetSizeMulti,
      complexity: s.complexity,
    });
    cornerRate = mechLaborRate({
      deckMulti: deckDefault,
      tabMulti: bandLookup(admin.tabBands, s.cornerLap),
      ocMulti: bandLookup(admin.onCenterBands, cornerOc),
      sheetSizeMulti: s.sheetSizeMulti,
      complexity: s.complexity,
    });
  } else {
    const r = adheredPerimCornerLaborRate({
      baseHoursPer1000: s.adhesiveBaseHoursPer1000,
      rollGoods: s.rollGoods,
      rollGoodWidthMulti: s.rollGoodWidthMulti,
      sheetSizeMulti: s.sheetSizeMulti,
      complexity: s.complexity,
      perimeterBump: s.adheredPerimeterBump,
    });
    perimRate = r.perim;
    cornerRate = r.corner;
  }

  return { fieldRate, perimRate, cornerRate };
}

/** A section's install hours: DuroBond model when present, else the rate×area chain (§3.0). */
export function computeSectionInstallHours(
  s: RoofSection,
  admin: AdminLaborTables,
  version: string,
  adjustLaborPct: number,
): number {
  if (s.duroBond) {
    return duroBondLaborHours({
      membraneWithOverlap: s.membraneWithOverlap,
      layoutTime: s.duroBond.layoutTime,
      thicknessLabor: s.thicknessLabor,
      mechSheetMulti: s.duroBond.mechSheetMulti,
      fastenerCount: s.duroBond.fastenerCount,
      singleFastenerTime: s.duroBond.singleFastenerTime,
      version,
    });
  }
  const { fieldRate, perimRate, cornerRate } = resolveSectionRates(s, admin);
  return roofSectionLaborHours({
    fieldArea: s.fieldArea,
    fieldRate,
    perimArea: s.perimArea,
    perimRate,
    cornerArea: s.cornerArea,
    cornerRate,
    thicknessLabor: s.thicknessLabor,
    adjustLaborPct,
  });
}

/** Run the whole estimate end-to-end and return the money chain plus the intermediate quantities. */
export function computeEstimate(e: EstimateInputs): EstimateResult {
  const roofSqFootage = e.sections.reduce((sum, s) => sum + s.length * s.width, 0);

  const sqFt = sqFtTotalMembrane(
    e.sections.map((s) => ({ membraneWithOverlap: s.membraneWithOverlap, arpSqFt: s.arpSqFt })),
  );

  const setupHours = e.admin.setupTable
    ? setupTime(roofSqFootage, e.admin.setupTable, e.adjustSetupLaborPct)
    : 0;
  const inspectionHours = e.admin.inspectionTable
    ? inspectionTime(roofSqFootage, e.admin.inspectionTable, e.adjustInspectionPct)
    : 0;

  const tearOffSections: TearOffSection[] = e.sections.map((s) => ({
    length: s.length,
    width: s.width,
    tearOff: s.tearOff,
    laborLookup: s.tearOffLaborLookup,
    ...(s.tearOffSheetComplexityMulti !== undefined
      ? { sheetComplexityMulti: s.tearOffSheetComplexityMulti }
      : {}),
    additionalPct: s.tearOffAdditionalPct,
  }));
  const tearOffLaborHours = tearOffLaborTotal(tearOffSections);

  const disposalSections: DisposalSection[] = e.sections.map((s) => ({
    length: s.length,
    width: s.width,
    tearOff: s.tearOff,
    toThicknessInches: s.toThicknessInches,
  }));
  const disposalUnits = tearOffVolume(
    disposalSections,
    e.tearOffFillFraction,
    e.dumpsterUnitYardage,
  );

  const installHours = e.sections.reduce(
    (sum, s) => sum + computeSectionInstallHours(s, e.admin, e.formulasVersion, e.adjustLaborPct),
    0,
  );

  // Direct-labor hours & cost — membership SETTLED from ReviewCalc.Recalculate
  // (docs/legacy-money-parity.md §6): LaborSubtotal1 = GoodSingle(Σ dLabor[0..21]) = the crew-rate
  // categories (install/setup/inspection/tear-off/accessory/parapet/curb/underlayment) PLUS the
  // own-rate dollar entries (metals dLabor[5]; non-DL categories dLabor[14..19]). Row 11
  // (LaborSubtotal2) is subcontractors + services ONLY — no double count.
  const crewRateHours =
    installHours +
    setupHours +
    inspectionHours +
    tearOffLaborHours +
    (e.accessoryLaborHours ?? 0) +
    (e.parapetLaborHours ?? 0) +
    (e.curbLaborHours ?? 0) +
    (e.underlaymentLaborHours ?? 0);
  // LS1 hours include the own-rate entries' hours (they drive TotalManDays -> per-diem and the
  // $/man-day markup mode), but their DOLLARS come in at each line's own rate, not the crew rate.
  const laborSubtotal1Hours = crewRateHours + (e.ownRateDirectLaborHours ?? 0);
  const laborSubtotal1 = goodSingle(
    calcLaborCost(e.crewLaborRatePerHour, crewRateHours) + (e.ownRateDirectLaborCost ?? 0),
  );
  const laborSubtotal2 = e.subsCost + e.servicesCost;

  const warranty = warrantyTotalCost({ ...e.warranty, sqFtTotalMembrane: sqFt });

  const money = computeMoney({
    duroLastMaterial: e.duroLastMaterial,
    membraneCostBeforeDiscount: e.membraneCostBeforeDiscount,
    sqFtTotalMembrane: sqFt,
    prepayDiscount: e.prepayDiscount,
    stdSizeDiscount: e.stdSizeDiscount,
    volumeDiscount: e.volumeDiscount,
    warrantyTotalCost: warranty,
    materialUnderlayment: e.materialUnderlayment,
    otherMaterial: e.otherMaterial,
    shipping: e.shipping,
    laborSubtotal1,
    laborSubtotal2,
    laborSubtotal1Hours,
    hoursPerDay: e.hoursPerDay,
    markupMode: e.markupMode,
    markup: e.markup,
    salesTax: e.salesTax,
    taxMaterialOnly: e.taxMaterialOnly,
    taxExempt: e.taxExempt,
    materialTotalBeforeTax: e.materialTotalBeforeTax,
    perDiem: e.perDiem,
    perDiemInMarkup: e.perDiemInMarkup,
    commission: e.commission,
    commissionInMarkup: e.commissionInMarkup,
  });

  return {
    roofSqFootage,
    sqFtTotalMembrane: sqFt,
    setupHours,
    inspectionHours,
    parapetLaborHours: e.parapetLaborHours ?? 0,
    curbLaborHours: e.curbLaborHours ?? 0,
    underlaymentLaborHours: e.underlaymentLaborHours ?? 0,
    tearOffLaborHours,
    disposalUnits,
    installHours,
    laborSubtotal1Hours,
    laborSubtotal1,
    laborSubtotal2,
    warrantyTotalCost: warranty,
    money,
  };
}
