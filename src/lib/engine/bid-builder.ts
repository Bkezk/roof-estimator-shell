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
 *  - Freight wired: percent-of-material or the stepped "from" table, on the DL material subtotal
 *    (M0). Membrane price tier assumed roll-goods.
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
 *  - Non-DL catalog lines wired: material (Price × qty) → OtherMaterial (taxable); labor
 *    (LaborPerUnit × Labor Rate × qty) → services (LaborSubtotal2).
 *  - Exceptional Metals wired: line items (unit cost + labor/unit × own rate); material → M0,
 *    labor → services. Gutter prices are largely $0 pending live capture (flagged).
 *  - Parapets wired (§5.3): labor = (length/50) × the seeded deck × height-band × drill/cant matrix
 *    → direct labor; material = In2Ft(girth) × length × bid-default membrane $/sqft → M0. Height
 *    band + girth are entered (profile-dims derivation flagged for the validation bid).
 */

import { areaWithEdgeOverlap } from "./quantities";
import { in2Ft } from "./rounding";
import { edgesArpSqFt, perimeterFromEdges, type EdgeInput } from "./edges";
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
import {
  TEAROFF_DECK_BY_LABOR_DECK,
  UNDERLAYMENT_DECK_BY_LABOR_DECK,
  parapetModeRate,
  curbLaborHours as curbHoursCalc,
  underlaymentMechanicalHours,
  underlaymentAdhesive,
  laborTemplateFactor,
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

/**
 * A curb on a bid (§4.5/§5.3). Labor is exact per the seeded tables: per curb, setup minutes +
 * (min/LF for the deck × curb-type multiplier) × perimeter, × quantity. Perimeter derives from the
 * A × B footprint (inches → In2Ft). FLAGGED FOR BID VALIDATION: curb MEMBRANE MATERIAL is not
 * auto-computed (the legacy curb-wrap material model needs a captured bid) — cover it via an
 * accessory/extra line for now.
 */
export interface CurbInput {
  id: string;
  name: string;
  quantity: number;
  widthIn: number; // footprint A (inches)
  lengthIn: number; // footprint B (inches)
  curbType: string; // from the seeded curb types (Open / Closed / …)
  deckType: string; // labor deck name, bridged via TEAROFF_DECK_BY_LABOR_DECK
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

  const sections: RoofSection[] = bid.sections.map((s) => {
    const price = priceMatrixLookup(admin.priceMatrix, s.thickness, "rollGoods", s.color);
    if (price === null) {
      warnings.push(
        `No price for ${s.thickness}mil ${s.color} (roll goods) — section "${s.name}".`,
      );
    }
    const membraneWithOverlap = areaWithEdgeOverlap(s.length, s.width, version);
    membraneMaterial += membraneMaterialCost(membraneWithOverlap, price ?? 0, isDuroRoof);

    // Insulation layers (§4.3, up to 4): board material → dTotals[6]; mechanical layout+fastener
    // labor and adhesive labor → direct labor; adhesive units × price → M0.
    for (const layer of sectionLayers(s)) {
      const area = s.length * s.width;
      const uPrice = admin.underlaymentPrices?.[layer.board];
      if (uPrice === undefined) {
        warnings.push(`No underlayment price for "${layer.board}" — section "${s.name}".`);
      } else {
        underlaymentMaterial += area * uPrice;
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

  // Adhesive whole units (legacy AdheredSystems.AggregateCalcQtys, docs/legacy-consumption-rules
  // §2.4): fractional units summed per adhesive across the WHOLE estimate, then Ceiling ONCE per
  // adhesive; the whole units price into M0. (Membrane and parapet-wall adhesive join this same
  // aggregate in the legacy app — those unit sources aren't computed here yet.)
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

  // Exceptional Metals: material (price × qty) → M0 (dMaterial metals slot); labor at the line's
  // own rate → services (LaborSubtotal2), like non-DL labor.
  const metalsMaterial = bid.metals.reduce((sum, m) => sum + m.price * m.quantity, 0);
  const metalsServices = bid.metals.reduce(
    (sum, m) => sum + m.laborPerUnit * m.laborRate * m.quantity,
    0,
  );

  // Apply the template factors to the category hour seams.
  parapetLaborHours *= tf("Parapets Labor");
  curbLaborHours *= tf("Curbs Labor");
  underlaymentLaborHours *= tf("Underlayment Labor");

  // M0 = membrane + accessories + parapet + metals material (dMaterial[0..6] slots).
  const duroLastMaterial =
    membraneMaterial + accessoryMaterial + parapetMaterial + metalsMaterial + adhesiveMaterial;
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
  const servicesCost = bid.servicesCost + nonDlServices + metalsServices;
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
    adjustLaborPct: ((1 + bid.adjustLaborPct / 100) * tf("Roof Section Labor") - 1) * 100,
    adjustSetupLaborPct: ((1 + (bid.adjustSetupPct ?? 0) / 100) * tf("Setup Time Labor") - 1) * 100,
    adjustInspectionPct:
      ((1 + (bid.adjustInspectionPct ?? 0) / 100) * tf("Inspection Time Labor") - 1) * 100,
    accessoryLaborHours,
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

  return { inputs, warnings, parapetMaterial, metalsMaterial, adhesiveMaterial };
}
