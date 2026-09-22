import { describe, it, expect } from "vitest";

import {
  buildEstimateInputs,
  derivedSheetSizeLabel,
  fluteFillerPieces,
  perimeterEnhancementCalculator,
  resolveSectionSheetLabel,
  roofSystemHasComplexity,
  sectionComplexityFactor,
  sectionMembraneDisplayPricing,
  type BidInput,
  type BidSectionInput,
  type UnderlaymentLayer,
  strippingBySection,
  curbIsoSqFt,
  curbLinealFt,
} from "./bid-builder";
import { computeEstimate, computeSectionInstallHours } from "./estimate";
import { buildLaborTables, type EngineAdminData, type LaborCombo } from "./adapters";

const deckOrder = [
  "Wood",
  "Steel",
  "Retrofit",
  "Concrete",
  "Gypsum",
  "LWC/Steel",
  "LWC/Concrete",
  "LWC/Other",
  "Tectum",
  "Purlin",
];

const combo: LaborCombo = {
  roof_system: "Duro-Last",
  attachment: "mechanical",
  base: { tab_value: 28, tab_multiplier: 1.5125 },
  deck_multipliers: { Wood: 1, Concrete: 2 },
  fastener_spacing_multipliers: [
    { spacing_in: 18, multiplier: 1 },
    { spacing_in: 12, multiplier: 1.1 },
    { spacing_in: 6, multiplier: 1.41 },
  ],
  sheet_size_multipliers: [{ label: "1500 sf", roof_section: 1, underlayment: 1 }],
  thickness_multipliers: [{ mil: 40, multiplier: 1 }],
};

/**
 * Install hours for the 50×50 fixture. Legacy labor bills the zone SHARES of MembraneWithOverlap
 * ((L+1)(W+1) = 2601 sq ft), not the raw 2500 sq ft takeoff (docs §20.1): INSTALL h × 2601/2500.
 */
/**
 * Legacy MembraneWithOverlap for the fixture (docs §21): a quick-bid 50×50 on the "1500 sf" sheet
 * → SheetsMembraneCalc: AreaWithEdgeOverlap 2601 + numOverlaps × avgSheetSide, n = Ceil(2601/1500)
 * = 2 sheets, numOverlaps = Floor(2·2 − 2·√2) = 1, avgSheetSide = √(2601/2).
 */
const MWO = 2601 + Math.sqrt(2601 / 2);
const MWO_RATIO = MWO / 2500;
const INSTALL = 15.125 * MWO_RATIO;
/**
 * Roll-goods quantity for the same 50×50 (RollGoodsMembraneCalc): 2601 + Ceil(51 / lap × 51) ×
 * In2Ft(OverlapWidth), lap = ToInteger(In2Ft(FieldLap)) (28" → 2, 60"/64" → 5).
 */
const rollQty = (lapInt: number, overlapFt: number): number =>
  2601 + Math.ceil((51 / lapInt) * 51) * overlapFt;
/**
 * Duro-Tuff quantity for the 50×50 fixture with no perimeter sides (DuroTuffSystem
 * .CalculateMembraneQty, docs §21.4): the 51 ft × 51 ft field is filled with `fw`-inch strips
 * lapped 6", the strip lengths get ½ ft of butt joint per whole 100 ft roll, and the last
 * partial strip bills at its remaining width.
 */
const tuffQty = (fw: number): number => {
  const step = fw - 6;
  let rem = 612;
  let k = 0;
  while (rem > step) {
    k++;
    rem -= step;
  }
  const len = k * 51 + Math.ceil((k * 51) / 100) * 0.5;
  const in2Ft = (i: number) => Math.round((i / 12) * 100) / 100;
  return len * in2Ft(fw) + 51 * in2Ft(rem);
};
/** Sheets quantity on the "500 sf" sheet: n = 6, overlaps = Floor(12 − 2√6) = 7. */
const MWO_SHEET_500 = 2601 + 7 * Math.sqrt(2601 / 6);

const admin: EngineAdminData = {
  deckOrder,
  priceMatrix: { 40: { rollGoods: { White: 1.23 } } },
  labor: { "Duro-Last|mechanical": buildLaborTables(combo, deckOrder) },
  settings: {
    hoursPerDay: 9,
    masterEliteCont: true,
    salesTax: 0.0625,
    taxMaterialOnly: true,
    shippingMode: "stepped",
    shippingPercent: 0,
  },
};

const bid = (over: Partial<BidInput> = {}): BidInput => ({
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  sections: [
    {
      id: "s1",
      name: "Main",
      length: 50,
      width: 50,
      deckType: "Wood",
      thickness: 40,
      color: "White",
      fieldLap: 28,
      fastenerOc: 18,
      perimLengthFt: 0,
      cornerLengthFt: 0,
      enhancementWidthFt: 3,
      perimFastenerOc: 18,
      cornerFastenerOc: 18,
      underlaymentBoard: "",
      sheetSizeLabel: "1500 sf",
      tearOff: false,
      tearOffType: "",
      toThicknessInches: 0,
    },
  ],
  accessories: [],
  nonDlLines: [],
  metals: [],
  parapets: [],
  curbs: [],
  markupMode: 0,
  markup: 0,
  crewLaborRatePerHour: 50,
  commission: 0,
  commissionInMarkup: false,
  perDiem: 0,
  perDiemInMarkup: true,
  prepayDiscount: false,
  stdSizeDiscount: false,
  volumeDiscount: false,
  taxExempt: true,
  adjustLaborPct: 0,
  extraShipping: 0,
  subsCost: 0,
  servicesCost: 0,
  materialUnderlayment: 0,
  otherMaterial: 0,
  warrantyCostPerSqFt: 0,
  warrantyNonEliteMasterCharge: 0,
  warrantyIsHighWind: false,
  warrantyHighWindUpcharge: 0,
  ...over,
});

describe("buildEstimateInputs → computeEstimate (end-to-end through the builder)", () => {
  it("hand-checked bid: 50×50 wood 40mil White → membrane $3,199.23 + labor $756.25 = $3,955.48", () => {
    const { inputs, warnings } = buildEstimateInputs(bid(), admin);
    expect(warnings).toEqual([]);
    const r = computeEstimate(inputs);

    // membrane material: AreaWithEdgeOverlap(50,50) = 51×51 = 2601 sf × $1.23 = $3,199.23
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23, 2);
    // install labor (legacy MaterialTotalField basis, §20.1): field share 1 × MembraneWithOverlap
    // 2601 sf × rate (10×1×1.5125×1/2500) = INSTALL hrs (15.125 × 2601/2500)
    expect(r.installHours).toBeCloseTo(INSTALL, 6);
    // $50/hr × INSTALL = $786.80
    expect(r.laborSubtotal1).toBeCloseTo(INSTALL * 50, 2);
    // tax-exempt, no markup/commission/discount ⇒ purchases + labor
    expect(r.money.grandTotal).toBeCloseTo(MWO * 1.23 + INSTALL * 50, 2);
  });

  it("gross-profit markup flows: 35% on the built Subtotal 1", () => {
    const { inputs } = buildEstimateInputs(bid({ markupMode: 2, markup: 35 }), admin);
    const r = computeEstimate(inputs);
    const S = r.money.subtotal1;
    expect(r.money.markupValue).toBeCloseTo(S / (1 - 0.35) - S, 2);
  });

  it("accessory lines (price × qty) fold into the Duro-Last material subtotal M0", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        accessories: [
          { description: "White Vent", price: 25.75, quantity: 7 },
          { description: "Duro-Caulk - White", price: 10.2, quantity: 3 },
        ],
      }),
      admin,
    );
    // 7×25.75 + 3×10.20 = 180.25 + 30.60 = 210.85, added to membrane MWO * 1.23
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 210.85, 2);
    // membrane-before-discount stays membrane-only (std-sheet discount basis)
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.23, 2);
  });

  it("underlayment material = board $/sqft × area × 1.03 waste (1.06 ONLY for Geotextile) — §22.12", () => {
    const withU: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85, Geotextile: 0.85 },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }] }),
      withU,
    );
    expect(warnings).toEqual([]);
    // 50×50 = 2500 sf × $0.85 × 1.03 waste = $2,188.75 (legacy UnderlaymentCost 0x4bcc4: the
    // CompareString/brtrue branch sends every NON-Geotextile board to the 1.03 multiply; confirmed
    // on a legacy Review screen, docs §22.12)
    expect(inputs.materialUnderlayment).toBeCloseTo(2188.75, 2);
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23, 2); // membrane unchanged
    const r = computeEstimate(inputs);
    expect(r.money.dTotals[6]).toBeCloseTo(2188.75, 2);
    // Geotextile is the ONE board on the 1.06 path: 2500 × 0.85 × 1.06 = 2252.50
    const geo = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: "Geotextile" }] }),
      withU,
    );
    expect(geo.inputs.materialUnderlayment).toBeCloseTo(2252.5, 2);
    // warns on an unknown board
    const bad = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: "Unobtainium" }] }),
      withU,
    );
    expect(bad.warnings.some((w) => w.includes("No underlayment price"))).toBe(true);
  });

  it("perimeter zone is carved from field and billed at the tighter-OC perimeter rate", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            perimLengthFt: 200, // 2×(50+50)
            enhancementWidthFt: 3, // → 600 sf perimeter zone
            perimFastenerOc: 12, // tighter than the 18" field
          },
        ],
      }),
      admin,
    );
    const s0 = inputs.sections[0]!;
    // Labor areas = zone share × MembraneWithOverlap (2601): 600/2500 and 1900/2500 of it.
    expect(s0.perimArea).toBeCloseTo(600 * MWO_RATIO, 6);
    expect(s0.fieldArea).toBeCloseTo(1900 * MWO_RATIO, 6); // (2500 − 600) share
    const r = computeEstimate(inputs);
    // field 1900 × 0.00605 (OC 18) + perim 600 × 0.006655 (OC 12 → ×1.1) = 11.495 + 3.993
    expect(r.installHours).toBeCloseTo(15.488 * MWO_RATIO, 3);
  });

  it("tear-off wires the seeded rate: deck→tearoff-deck map, ÷100 scale, adds disposal + hours", () => {
    const withTearOff: EngineAdminData = {
      ...admin,
      tearOff: {
        deckColumns: ["Wood"],
        tearoffTypes: ['BUR < 2"'],
        lookup: { Wood: { 'BUR < 2"': 2.4876 / 100 } }, // grid Hours/100SqFt ÷ 100
      },
    };
    const { inputs } = buildEstimateInputs(
      bid({
        crewLaborRatePerHour: 50,
        sections: [
          {
            ...bid().sections[0]!,
            tearOff: true,
            tearOffType: 'BUR < 2"',
            toThicknessInches: 4,
          },
        ],
      }),
      withTearOff,
    );
    const r = computeEstimate(inputs);
    // tear-off labor: 2500 sf × 0.024876 = 62.19 hrs → Round(3dp)=62.19, Ceiling(×100)/100 = 62.19
    expect(r.tearOffLaborHours).toBeCloseTo(62.19, 2);
    // it rolls into the direct-labor hours (install INSTALL + tear-off 62.19)
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 62.19, 2);
    // disposal: (4/36)(2500/9)/1 = 30.86 yd / 30 → ceil = 2 units
    expect(r.disposalUnits).toBe(2);
  });

  it("setup & inspection hours flow from the seeded band tables into direct labor", () => {
    const withBands: EngineAdminData = {
      ...admin,
      setupTable: {
        minimum: 16,
        bands: [
          { upTo: 6000, value: 0.003, multiply: true },
          { upTo: 20000, value: 0.003, multiply: true },
          { upTo: 100000, value: 0.003, multiply: true },
        ],
      },
      inspectionTable: {
        minimum: 5,
        bands: [
          { edge: 0, value: 5 },
          { edge: 5001, value: 7 },
          { edge: 10001, value: 10 },
        ],
      },
    };
    // base bid = 50×50 = 2500 roof sqft
    const { inputs } = buildEstimateInputs(bid(), withBands);
    const r = computeEstimate(inputs);
    expect(r.setupHours).toBeCloseTo(16, 6); // Ceiling(2500)×0.003 = 7.5, floored to min 16
    expect(r.inspectionHours).toBeCloseTo(5, 6); // 2500 < 5001 → first band = 5
    // they roll into direct-labor hours alongside install (INSTALL)
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 16 + 5, 3);
  });

  it("freight: stepped table bills on MATERIAL BEFORE TAX (dMaterial[20]), not M0", () => {
    const withShip: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85 },
      shippingSteps: [
        { fromThreshold: 0, cost: 800 },
        { fromThreshold: 5001, cost: 975 },
      ],
    };
    // M0 stays MWO * 1.23, but board material 2500 × 0.85 × 1.03 = 2188.75 lifts material-before-tax
    // to 5451.73 > 5001 → the 975 band. (On the old M0 basis this bid shipped at 800.)
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }],
      }),
      withShip,
    );
    expect(inputs.shipping).toBeCloseTo(975, 2);
  });

  it("freight: stepped 'from' table flows into shipping", () => {
    const withShip: EngineAdminData = {
      ...admin,
      shippingSteps: [
        { fromThreshold: 0, cost: 800 },
        { fromThreshold: 5001, cost: 975 },
      ],
    };
    // base bid material = membrane MWO * 1.23 (no accessories) → 0 < MWO * 1.23 ≤ 5001 → 800 freight
    const { inputs } = buildEstimateInputs(bid(), withShip);
    expect(inputs.shipping).toBeCloseTo(800, 2);
    // an accessory line pushes M0 over 5001 → next band
    const { inputs: hi } = buildEstimateInputs(
      bid({ accessories: [{ description: "Big", price: 2000, quantity: 1 }] }),
      withShip,
    );
    expect(hi.shipping).toBeCloseTo(975, 2); // MWO * 1.23 + 2000 = 5199.23 > 5001
  });

  it("freight: percent mode multiplies material-before-tax by shipping_percent/100", () => {
    const pct: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85 },
      settings: { ...admin.settings, shippingMode: "percent", shippingPercent: 5 },
    };
    // Board material (2500 × 0.85 × 1.03 = 2188.75) separates the basis from M0: the percent
    // applies to material-before-tax MWO * 1.23 + 2188.75 = 5387.98 → 5% = 272.5865 → GoodSingle.
    const { inputs } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }] }),
      pct,
    );
    expect(inputs.shipping).toBeCloseTo((MWO * 1.23 + 2188.75) * 0.05, 2);
  });

  it("accessory labor (per-unit hrs × qty) folds into direct labor (LaborSubtotal1)", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        accessories: [
          { description: 'Inside 6" x 6"', price: 4.4, quantity: 6, laborHoursPerUnit: 0.1667 },
        ],
      }),
      admin,
    );
    expect(inputs.accessoryLaborHours).toBeCloseTo(1.0002, 4); // 6 × 0.1667
    const r = computeEstimate(inputs);
    // install INSTALL + accessory 1.0002 = 16.1252 direct-labor hours
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 1.0002, 3);
  });

  it("§22.4 legacy quirk: the non-DL OTHERS group's labor is dropped from Labor Subtotal 1 (dLabor[19] ← Setup)", () => {
    const line = (category: string) => ({
      description: "thing",
      category,
      price: 0,
      laborPerUnit: 1,
      laborRate: 40,
      quantity: 2,
    });
    const masonry = buildEstimateInputs(bid({ nonDlLines: [line("Masonry")] }), admin);
    const other = buildEstimateInputs(bid({ nonDlLines: [line("Misc Other")] }), admin);
    // Masonry (group 4) bills 2 h × $40 as own-rate direct labor…
    expect(masonry.inputs.ownRateDirectLaborCost).toBeCloseTo(80, 2);
    expect(masonry.inputs.ownRateDirectLaborHours).toBeCloseTo(2, 6);
    // …the Others group (6) bills nothing and the estimator is told why.
    expect(other.inputs.ownRateDirectLaborCost).toBe(0);
    expect(other.inputs.ownRateDirectLaborHours).toBe(0);
    expect(other.warnings.some((w) => w.includes('Non-DL "Other" labor'))).toBe(true);
  });

  it("§22.3 non-DL flat lines with a 0 Labor Rate bill at the estimate crew rate (legacy ReadRefData)", () => {
    const r = buildEstimateInputs(
      bid({
        nonDlLines: [
          {
            description: "Ice & Water",
            category: "Parapet Wall Blocking",
            price: 0,
            laborPerUnit: 1,
            laborRate: 0,
            quantity: 3,
          },
        ],
      }),
      admin,
    );
    expect(r.inputs.ownRateDirectLaborCost).toBeCloseTo(3 * bid().crewLaborRatePerHour, 2);
  });

  it("non-DL lines: material → OtherMaterial (taxable basis), labor $ → services (LaborSubtotal2)", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        nonDlLines: [
          {
            description: "Curb Counter Flashing",
            price: 4,
            laborPerUnit: 0.0167,
            laborRate: 45,
            quantity: 10,
          },
        ],
      }),
      admin,
    );
    expect(inputs.otherMaterial).toBeCloseTo(40, 2); // 10 × $4 material
    expect(inputs.servicesCost).toBeCloseTo(7.52, 3); // GoodSingle(10 × 0.0167 h × $45/h
    expect(inputs.materialTotalBeforeTax).toBeCloseTo(MWO * 1.23 + 40, 2); // OtherMaterial is taxable
    const r = computeEstimate(inputs);
    expect(r.money.dTotals[7]).toBeCloseTo(40, 2); // OtherMaterial row
    expect(r.laborSubtotal2).toBeCloseTo(7.52, 3); // subs + services (GoodSingle per row)
  });

  it("non-DL routing by category: six categories → own-rate direct labor; subs/services (labor AND material) → LS2; uncategorized legacy lines keep the old services routing", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        nonDlLines: [
          // Category line → material stays OtherMaterial; labor at own rate → LS1 seam.
          {
            description: "Sheet Metal Work — Counter Flashing",
            category: "Sheet Metal Work",
            price: 100,
            laborPerUnit: 1,
            laborRate: 45,
            quantity: 2,
          },
          // Subcontractor → labor AND material to LS2 (legacy NonDL.MaterialCost excludes it).
          {
            description: "Subcontractors — HVAC lift",
            category: "Subcontractors",
            price: 500,
            laborPerUnit: 2,
            laborRate: 60,
            quantity: 1,
          },
          // Uncategorized (older saved bid): unchanged legacy-web behavior.
          { description: "Misc", price: 50, laborPerUnit: 1, laborRate: 40, quantity: 1 },
        ],
      }),
      admin,
    );
    expect(inputs.otherMaterial).toBeCloseTo(200 + 50, 2); // NOT the sub's 500
    expect(inputs.subsCost).toBeCloseTo(500 + 120, 2); // sub material + labor → LS2
    expect(inputs.servicesCost).toBeCloseTo(40, 2); // only the uncategorized line
    expect(inputs.ownRateDirectLaborCost).toBeCloseTo(90, 2); // sheet metal 2 × 1h × $45
    expect(inputs.ownRateDirectLaborHours).toBeCloseTo(2, 6);
    const r = computeEstimate(inputs);
    expect(r.laborSubtotal2).toBeCloseTo(620 + 40, 2);
    expect(r.laborSubtotal1).toBeCloseTo(INSTALL * 50 + 90, 2);
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 2, 6);
  });

  it("parapets: matrix labor rolls into direct labor; girth × length × membrane $ into M0", () => {
    const withParapet: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"', '31"-48"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        parapets: [
          {
            id: "p1",
            name: "North wall",
            lengthFt: 100,
            heightBand: '0"-30"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 30.4,
          },
        ],
      }),
      {
        ...withParapet,
        priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
      },
    );
    expect(warnings).toEqual([]);
    // material (legacy Parapet.MembraneCost): girth Ceil(30.4)=31" -> In2Ft = 2.58 ft;
    // AdjustedLength = 100 + 1 + pieces(default 1) = 102; PARAPETS-tier price $1.40:
    // Round(2.58 x 102 x 1.4, 2) = 368.42 into M0
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 368.42, 2);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.23, 2); // membrane-only basis unchanged
    const r = computeEstimate(inputs);
    // AdjustedLength = 100 + 1 + pieces(1) = 102 (legacy BaseManHours multiplies
    // AdjustedLength, not raw Length — docs §8.5): 102/50 × 2.25 = 4.59
    expect(r.parapetLaborHours).toBeCloseTo(4.59, 6);
    // rolls into direct labor alongside install INSTALL
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 4.59, 3);
  });

  it("parapets: a missing tier for an OVERRIDE mil/color warns with the parapet's name", () => {
    const withParapet: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
    };
    const { warnings } = buildEstimateInputs(
      bid({
        parapets: [
          {
            id: "p1",
            name: "Odd wall",
            lengthFt: 100,
            heightBand: '0"-30"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 30.4,
            thicknessMil: 60,
            color: "Terra Cotta",
          },
        ],
      }),
      withParapet,
    );
    // 60/Terra Cotta has no Parapets tier and no roll-goods fallback → the zero-price warning
    // names the parapet (positive control for the tier-warning path).
    expect(warnings).toEqual([
      'No membrane price for the parapet material (parapet "Odd wall" thickness/color).',
    ]);
  });

  it("parapets: Use Slipsheet adds the legacy polyethylene labor (0.25 h / 100 sq ft)", () => {
    // Legacy Parapet.get_Polyethylene = AdjustedHeight × Length × 1.25 sq ft (UsePlastic), and
    // BaseManHours adds Polyethylene / 100 × 0.25 hours (docs §8.6). Material is an NDL item
    // (rate DB-resident) — only the labor is auto-priced here.
    const withParapet: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
    };
    const { inputs } = buildEstimateInputs(
      bid({
        parapets: [
          {
            id: "p1",
            name: "North wall",
            lengthFt: 100,
            heightBand: '0"-30"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 30.4,
            useSlipsheet: true,
          },
        ],
      }),
      withParapet,
    );
    const r = computeEstimate(inputs);
    // AdjustedHeight = In2Ft(Ceil(30.4)) = 2.58 ft; poly = 2.58 × 100 × 1.25 = 322.5 sq ft;
    // labor = 4.59 (matrix, on AdjustedLength 102) + 322.5 / 100 × 0.25 = 4.59 + 0.80625
    expect(r.parapetLaborHours).toBeCloseTo(4.59 + 0.80625, 5);
  });

  it("parapets: each prices at its OWN mil/color when overridden (legacy Membrane Options)", () => {
    // Legacy Parapet.LookupParpetMembranePrice keys the PARAPET's own MembraneType.Thickness and
    // GetCurrentColorPriceIndex uses the PARAPET's own Color (docs §8.5) — not the bid default.
    const withParapet: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: {
        40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } },
        60: { rollGoods: { Gray: 2.0 }, parapet: { Gray: 2.5 } },
      },
    };
    const base = {
      lengthFt: 100,
      heightBand: '0"-30"',
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 30.4,
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        parapets: [
          { id: "p1", name: "Default wall", ...base },
          { id: "p2", name: "Gray 60 wall", ...base, thicknessMil: 60, color: "Gray" },
        ],
      }),
      withParapet,
    );
    expect(warnings).toEqual([]);
    // girth Ceil(30.4)=31" → 2.58 ft; AdjustedLength = 102.
    // p1 @ bid default 40/White $1.40 → Round(2.58×102×1.4, 2)  = 368.42
    // p2 @ own 60/Gray $2.50        → Round(2.58×102×2.5, 2)  = 657.90
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 368.42 + 657.9, 2);
  });

  it("parapets: girth derives from the legacy profile dims (Skirt+Cant+Vertical+WallTop+Drop)", () => {
    const withParapet: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        parapets: [
          {
            id: "p1",
            name: "North wall",
            lengthFt: 100,
            heightBand: '0"-30"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 0, // ignored when the dims are present
            skirtInches: 4,
            cantInches: 2,
            verticalInches: 20,
            wallTopInches: 3,
            dropInches: 1.4,
          },
        ],
      }),
      withParapet,
    );
    expect(warnings).toEqual([]);
    // dims sum to 30.4 -> Ceil 31" -> 2.58 ft x 102 x $1.40 = $368.42, same as the girth test
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 368.42, 2);
  });

  it('parapets: Duro-Tuff bills 24" panels at 30" each on 6"-increment heights', () => {
    const withParapet: EngineAdminData = {
      ...admin,
      labor: { ...admin.labor, "Duro-Tuff|mechanical": admin.labor["Duro-Last|mechanical"]! },
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
      // Duro-Tuff membrane is flat-family priced now; 1.23 keeps the fixture's MWO * 1.23 membrane.
      familyMembranePrices: { "Duro-Tuff": { "40": 1.23 } },
    };
    const { inputs } = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Tuff",
        parapets: [
          {
            id: "p1",
            name: "North wall",
            lengthFt: 100,
            heightBand: '0"-30"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 30.4,
          },
        ],
      }),
      withParapet,
    );
    // AdjustedHeight = Ceil(30.4/6)/2 = 3 ft -> Ceil(36/24) = 2 panels x 30" = 5 ft billed;
    // Round(5 x 102 x 1.4, 2) = 714.00 (vs 368.42 non-Duro-Tuff)
    // Duro-Tuff membrane quantity: 30" roll layout at the 28" field lap (docs §21.4).
    expect(inputs.duroLastMaterial).toBeCloseTo(tuffQty(28) * 1.23 + 714, 2);
  });

  it("curbs: setup + min/LF x type x perimeter, x qty, /60 -> direct labor", () => {
    const withCurb: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { Wood: 7.5 },
        multiplierByType: { Closed: 1, Scupper: 4 },
        curbTypes: ["Closed", "Scupper"],
      },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        curbs: [
          {
            id: "c1",
            name: "RTU curb",
            quantity: 2,
            widthIn: 24,
            lengthIn: 36,
            curbType: "Closed",
            deckType: "Wood",
          },
        ],
      }),
      withCurb,
    );
    expect(warnings).toEqual([]);
    const r = computeEstimate(inputs);
    // perimeter = 2 x (2 + 3) = 10 ft; (8 + 7.5x1x10)/60 = 83/60 h per curb; x2 = 2.7667 h
    expect(r.curbLaborHours).toBeCloseTo((2 * 83) / 60, 4);
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + (2 * 83) / 60, 3);
  });

  it("curbs: plastic-on-curb adds PolyethyleneSqF / 400 hours (legacy BaseHours, §8.2)", () => {
    const withCurb: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { Wood: 7.5 },
        multiplierByType: { Closed: 1 },
        curbTypes: ["Closed"],
      },
    };
    const { inputs, breakdown } = buildEstimateInputs(
      bid({
        curbs: [
          {
            id: "c1",
            name: "RTU curb",
            quantity: 2,
            widthIn: 24,
            lengthIn: 36,
            dimCIn: 12,
            dimDIn: 6,
            curbType: "Closed",
            deckType: "Wood",
            hasPlastic: true,
          },
        ],
      }),
      withCurb,
    );
    const r = computeEstimate(inputs);
    // LinealFt = 60/6 = 10; poly = 10 × 18 × 5/48 × 2 = 37.5 sq ft → 0.09375 h on top of 166/60.
    expect(r.curbLaborHours).toBeCloseTo(166 / 60 + 0.09375, 6);
    expect(breakdown.curbHoursById["c1"]).toBeCloseTo(166 / 60 + 0.09375, 6);
  });

  it("curbs: per-curb mil/color drives the wrap rate; insulation-on-curb adds the ISO labor", () => {
    const withCurb: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { Wood: 7.5 },
        multiplierByType: { Closed: 1 },
        curbTypes: ["Closed"],
      },
    };
    const curb = {
      id: "c1",
      name: "RTU curb",
      quantity: 2,
      widthIn: 24,
      lengthIn: 24,
      curbType: "Closed",
      deckType: "Wood",
      styleId: 1,
      dimCIn: 12,
      dimDIn: 0,
    };
    // 60mil Gray wrap rate 0.5625 (proven BAColor order), NOT the bid default 40mil White:
    // (12 × 0.5625 + 0.3099 + 4.8081×1.7819) × 2.6047 × qty 2 = 81.4097
    const { curbMaterial } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, thicknessMil: 60, color: "Gray" }] }),
      withCurb,
    );
    expect(curbMaterial).toBeCloseTo(2 * 40.70483, 3);
    // Insulation on curb(s) — Curb.ISO_Labor 0x33718 (§22.12): Round(0.25 + LinealFt × 0.0167 ×
    // qty, 2) = Round(0.25 + 8 × 0.0167 × 2, 2) = 0.52 h (the 0.25 is per ENTRY, not per unit)
    // on top of the type labor (perimeter 8 ft: (8 + 7.5×1×8)/60 × 2 = 2.2667 h).
    const { inputs } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, hasInsulation: true }] }),
      withCurb,
    );
    const r = computeEstimate(inputs);
    expect(r.curbLaborHours).toBeCloseTo((2 * 68) / 60 + 0.52, 4);
  });

  it("parapets: the labor band derives from Vertical (LookupParapetTimes), not the saved band (§19)", () => {
    const withBands: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"', '31"-48"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
            '31"-48"': {
              noDrillNoCant: 4.5,
              noDrillCanted: 6.75,
              predrillNoCant: 7,
              predrillCanted: 10.5,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
    };
    const wall = {
      id: "p1",
      name: "Wall",
      lengthFt: 100,
      heightBand: '0"-30"', // stale saved band — ignored once profile dims exist
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 0,
      skirtInches: 6,
      cantInches: 0,
      verticalInches: 36,
      wallTopInches: 12,
      dropInches: 0,
      wallType: 1,
    };
    const { inputs, warnings } = buildEstimateInputs(bid({ parapets: [wall] }), withBands);
    expect(warnings).toEqual([]);
    // 36" vertical → '31"-48"' row: AdjustedLength 102 / 50 × 4.5 = 9.18
    expect(computeEstimate(inputs).parapetLaborHours).toBeCloseTo(9.18, 6);
    // 24" vertical → '0"-30"' row: 102 / 50 × 2.25 = 4.59
    const lower = buildEstimateInputs(
      bid({ parapets: [{ ...wall, verticalInches: 24 }] }),
      withBands,
    );
    expect(computeEstimate(lower.inputs).parapetLaborHours).toBeCloseTo(4.59, 6);
    // Walls saved without profile dims keep their picked band.
    const legacySaved = buildEstimateInputs(
      bid({
        parapets: [
          {
            id: "p1",
            name: "Wall",
            lengthFt: 100,
            heightBand: '31"-48"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 30,
          },
        ],
      }),
      withBands,
    );
    expect(computeEstimate(legacySaved.inputs).parapetLaborHours).toBeCloseTo(9.18, 6);
  });

  it("parapets: per-wall Membrane Options attachment drives pre-drill and wall adhesive (§19)", () => {
    const withAll: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
      adhesivePrices: { "Water Based Adhesive": 122.1 },
      membraneAdhesives: {
        1: {
          "Water Based Adhesive": {
            byDeckName: { Wood: 700 },
            underlaymentUniform: 700,
            wallCoverage: 350,
          },
        },
      },
    };
    const wall = {
      id: "p1",
      name: "Wall",
      lengthFt: 100,
      heightBand: '0"-30"',
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 0,
      skirtInches: 6,
      cantInches: 0,
      verticalInches: 24,
      wallTopInches: 12,
      dropInches: 0,
      wallType: 1, // Wood or Metal: mechanical walls don't pre-drill
    };
    // Mechanical bid, wall inherits mechanical: no-drill rate, no wall adhesive.
    const mech = buildEstimateInputs(bid({ parapets: [wall] }), withAll);
    expect(computeEstimate(mech.inputs).parapetLaborHours).toBeCloseTo(4.59, 6);
    expect(mech.adhesiveWholeUnits?.["Water Based Adhesive"] ?? 0).toBe(0);
    // Same mechanical bid, the WALL alone is adhered (legacy Membrane Options): legacy
    // Predrill = attachment != mechanical → pre-drill column (3.5), and the wall adhesive
    // bills for this wall only — 100 × (24 + 12)/12 = 300 sq ft / 350 = 0.857 → Ceil 1 unit.
    const adheredWall = buildEstimateInputs(
      bid({ parapets: [{ ...wall, attachment: "adhered" }] }),
      withAll,
    );
    expect(adheredWall.warnings.filter((w) => /adhesive/i.test(w))).toEqual([]);
    expect(computeEstimate(adheredWall.inputs).parapetLaborHours).toBeCloseTo((102 / 50) * 3.5, 6);
    expect(adheredWall.adhesiveWholeUnits?.["Water Based Adhesive"]).toBe(1);
    expect(adheredWall.adhesiveMaterial).toBeCloseTo(122, 2);
    // Adhered bid, the WALL alone mechanical: no wall adhesive (membrane adhesive only:
    // 2500/700 = 3.571 → 4), no-drill rate.
    const mechWall = buildEstimateInputs(
      bid({ attachment: "adhered", parapets: [{ ...wall, attachment: "mechanical" }] }),
      withAll,
    );
    expect(mechWall.adhesiveWholeUnits?.["Water Based Adhesive"]).toBe(4);
    expect(computeEstimate(mechWall.inputs).parapetLaborHours).toBeCloseTo(4.59, 6);
    // Per-wall Roof System override: an unknown system with no parapet labor row warns.
    const oddSystem = buildEstimateInputs(
      bid({ parapets: [{ ...wall, roofSystem: "Duro-Tuff" }] }),
      { ...withAll, priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } } },
    );
    // Duro-Tuff bills 24" panels at 30": girth 42 → 6"-steps 3.5 ft → Ceil(42/24)=2 × 2.5 = 5 ft.
    expect(oddSystem.inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 5 * 102 * 1.4, 2);
  });

  it("parapets: only the wall's own AdjustLabor field applies; per-wall hours are reported (§19/§20.3)", () => {
    const withTpl: EngineAdminData = {
      ...admin,
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
      laborTemplates: { names: ["Heavy"], byName: { Heavy: { "Parapets Labor": 10 } } },
    };
    const wall = {
      id: "p1",
      name: "Wall",
      lengthFt: 100,
      heightBand: '0"-30"',
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 30,
    };
    // The template NAME is informational (legacy writes the template into each wall's AdjustLabor
    // at selection time — applyLaborTemplate); walls without a value bill their base hours.
    const tpl = buildEstimateInputs(
      bid({ laborTemplateName: "Heavy", parapets: [wall, { ...wall, id: "p2", lengthFt: 50 }] }),
      withTpl,
    );
    expect(tpl.warnings).toEqual([]);
    expect(tpl.breakdown.parapetBaseHoursById).toEqual({ p1: 4.59, p2: (52 / 50) * 2.25 });
    expect(tpl.breakdown.parapetHoursById["p1"]).toBeCloseTo(4.59, 6);
    expect(tpl.breakdown.parapetHoursById["p2"]).toBeCloseTo((52 / 50) * 2.25, 6);
    // The wall's own AdjustLabor (legacy frmLaborPopUp / template write): -20 → 4.59 × 0.8.
    const own = buildEstimateInputs(
      bid({ laborTemplateName: "Heavy", parapets: [{ ...wall, adjustLaborPct: -20 }] }),
      withTpl,
    );
    expect(own.breakdown.parapetHoursById["p1"]).toBeCloseTo(4.59 * 0.8, 6);
    expect(computeEstimate(own.inputs).parapetLaborHours).toBeCloseTo(4.59 * 0.8, 6);
    // +10 (what applying the template's ParapetsLabor to a NEW wall writes) → 4.59 × 1.1.
    const seeded = buildEstimateInputs(
      bid({ parapets: [{ ...wall, adjustLaborPct: 10 }] }),
      withTpl,
    );
    expect(seeded.breakdown.parapetHoursById["p1"]).toBeCloseTo(4.59 * 1.1, 6);
  });

  it("per-item labor %: adjustLaborPct scales the WHOLE item's hours (curbs and parapets)", () => {
    // Legacy frmLaborPopUp link (docs §8.7): ManHours = BaseHours × (1 + AdjustLabor/100),
    // wrapping every per-item adder (curb ISO/lift labor, parapet slipsheet labor).
    const withBoth: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { Wood: 7.5 },
        multiplierByType: { Closed: 1 },
        curbTypes: ["Closed"],
      },
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
    };
    const curb = {
      id: "c1",
      name: "RTU curb",
      quantity: 2,
      widthIn: 60,
      lengthIn: 60,
      curbType: "Closed",
      deckType: "Wood",
      hasInsulation: true,
      termOption: 3,
    };
    const parapet = {
      id: "p1",
      name: "North wall",
      lengthFt: 100,
      heightBand: '0"-30"',
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 30.4,
      useSlipsheet: true,
    };
    // curb base: type labor 2×(8+7.5×20)/60 + ISO Round(0.25+20×0.0167×2,2)=0.92 (§22.12: the
    //            0.25 is per entry) + lift 1+20×0.020833 = 1.41666
    const curbBase = (2 * (8 + 7.5 * 20)) / 60 + 0.92 + 1 + 20 * 0.020833;
    // parapet base: 4.59 matrix (AdjustedLength 102) + 0.80625 slipsheet
    const parapetBase = 4.59 + 0.80625;
    const { inputs } = buildEstimateInputs(
      bid({
        curbs: [{ ...curb, adjustLaborPct: 50 }],
        parapets: [{ ...parapet, adjustLaborPct: -20 }],
      }),
      withBoth,
    );
    const r = computeEstimate(inputs);
    expect(r.curbLaborHours).toBeCloseTo(curbBase * 1.5, 4);
    expect(r.parapetLaborHours).toBeCloseTo(parapetBase * 0.8, 4);
    // absent / 0 leaves hours unchanged
    const { inputs: plain } = buildEstimateInputs(
      bid({ curbs: [{ ...curb }], parapets: [{ ...parapet }] }),
      withBoth,
    );
    const r2 = computeEstimate(plain);
    expect(r2.curbLaborHours).toBeCloseTo(curbBase, 4);
    expect(r2.parapetLaborHours).toBeCloseTo(parapetBase, 4);
  });

  it("curbs: Lift termination options (2/3) add the legacy lift labor, once per curb entry", () => {
    // Curb.BaseHours (docs §8.2/§8.3): TermOption ∈ {2 Lift & Tuck, 3 Lift & T-Bar} adds
    // 1 + LinealFt × 0.020833 (12 < LF ≤ 32) or 1 + LinealFt × 0.041667 (LF > 32), where
    // LinealFt = (A+B)/6 — added ONCE, not × qty. No-lift options (0/1/4/5) add nothing.
    const withCurb: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { Wood: 7.5 },
        multiplierByType: { Closed: 1 },
        curbTypes: ["Closed"],
      },
    };
    const curb = {
      id: "c1",
      name: "Big curb",
      quantity: 2,
      widthIn: 60,
      lengthIn: 60,
      curbType: "Closed",
      deckType: "Wood",
    };
    const base = (2 * (8 + 7.5 * 1 * 20)) / 60; // perimeter 2 × (5 + 5) = 20 ft, qty 2
    const hours = (termOption?: number) => {
      const { inputs } = buildEstimateInputs(
        bid({
          curbs: [termOption === undefined ? { ...curb } : { ...curb, termOption }],
        }),
        withCurb,
      );
      return computeEstimate(inputs).curbLaborHours;
    };
    // LF = (60+60)/6 = 20 → 12 < 20 ≤ 32 → +1 + 20 × 0.020833 = 1.41666 (once, though qty 2)
    expect(hours(3)).toBeCloseTo(base + 1 + 20 * 0.020833, 4);
    expect(hours(2)).toBeCloseTo(base + 1 + 20 * 0.020833, 4);
    for (const opt of [0, 1, 4, 5, undefined]) expect(hours(opt)).toBeCloseTo(base, 4);
    // LF > 32 branch: A=B=120 → LF = 40 → +1 + 40 × 0.041667
    const { inputs } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, widthIn: 120, lengthIn: 120, termOption: 3 }] }),
      withCurb,
    );
    const basePerim40 = (2 * (8 + 7.5 * 1 * 40)) / 60; // perimeter 2 × (10 + 10) = 40 ft
    expect(computeEstimate(inputs).curbLaborHours).toBeCloseTo(basePerim40 + 1 + 40 * 0.041667, 4);
    // LF ≤ 12 adds nothing: A=B=36 → LF = 12
    const { inputs: small } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, widthIn: 36, lengthIn: 36, termOption: 3 }] }),
      withCurb,
    );
    // perimeter 2 × (3 + 3) = 12 ft; no lift adder at LF = 12
    expect(computeEstimate(small).curbLaborHours).toBeCloseTo((2 * (8 + 7.5 * 12)) / 60, 4);
  });

  it("curbs: legacy Knox County CTC screen — per-deck setup (Structural Metal 7.5 min) reproduces 48.81 h / $1,008.30 (§22.19)", () => {
    const withCurb: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { "Structural Metal": 7.5 },
        setupMinutesByDeck: { "Structural Metal": 7.5 },
        multiplierByType: { Open: 1.1 },
        curbTypes: ["Open"],
      },
    };
    const mk = (
      id: string,
      quantity: number,
      widthIn: number,
      lengthIn: number,
      dimCIn: number,
      hasInsulation = false,
    ) => ({
      id,
      name: `Curb ${id}`,
      quantity,
      widthIn,
      lengthIn,
      dimCIn,
      dimDIn: 6,
      curbType: "Open",
      deckType: "Steel",
      styleId: 1,
      thicknessMil: 40,
      color: "White",
      hasInsulation,
    });
    const curbs = [
      mk("A", 3, 98, 110, 12, true),
      mk("B", 9, 20, 20, 16),
      mk("C", 1, 32, 32, 16),
      mk("D", 2, 42, 42, 16),
      mk("E", 3, 52, 29, 12),
      mk("F", 3, 30, 72, 12, true),
      mk("G", 1, 44, 54, 12),
    ];
    const { inputs, curbMaterial, warnings, breakdown } = buildEstimateInputs(
      bid({ curbs }),
      withCurb,
    );
    const curbHoursById = breakdown.curbHoursById;
    expect(warnings).toEqual([]);
    // Curb A: (0.125 × 104 + 0.125 × 3) × 1.1 + Round(0.25 + 34.6667 × 0.0167 × 3, 2) = 16.7025
    // (legacy label "16.7 h. (100%)"); Curb F 8.525 (legacy 8.53); total 48.80875 → 48.81.
    expect(curbHoursById["A"]).toBeCloseTo(16.7025, 4);
    expect(curbHoursById["F"]).toBeCloseTo(8.525, 4);
    expect(computeEstimate(inputs).curbLaborHours).toBeCloseTo(48.80875, 4);
    expect(curbMaterial).toBeCloseTo(1008.3, 2);
    // With the old single 8-minute setup the same bid over-bills 0.20 h (49.01), the round-2 gap.
    const global8 = buildEstimateInputs(bid({ curbs }), {
      ...withCurb,
      curbLabor: { ...withCurb.curbLabor!, setupMinutesByDeck: {} },
    });
    expect(computeEstimate(global8.inputs).curbLaborHours).toBeCloseTo(49.01, 2);
  });

  it("curb ISO sq ft: legacy LinealFt rounds to 8 dp before × qty, so Knox A + F ceil to 156 (§22.24)", () => {
    const iso = curbIsoSqFt([
      { widthIn: 98, lengthIn: 110, quantity: 3, hasInsulation: true },
      { widthIn: 30, lengthIn: 72, quantity: 3, hasInsulation: true },
      { widthIn: 20, lengthIn: 20, quantity: 9, hasInsulation: false },
    ]);
    expect(iso).toBeGreaterThan(155);
    expect(Math.ceil(iso)).toBe(156); // 156 × $0.30 = the legacy review's Other $46.80
    expect(curbLinealFt({ widthIn: 98, lengthIn: 110 })).toBe(34.66666667);
  });

  it("curbs: a legacy styleId auto-prices the wrap membrane into M0; styles 3/4 warn quote-required", () => {
    const withCurb: EngineAdminData = {
      ...admin,
      curbLabor: {
        setupMinutes: 8,
        minutesByDeck: { Wood: 7.5 },
        multiplierByType: { Closed: 1 },
        curbTypes: ["Closed"],
      },
    };
    const curb = {
      id: "c1",
      name: "RTU curb",
      quantity: 1,
      widthIn: 24,
      lengthIn: 24,
      curbType: "Closed",
      deckType: "Wood",
      dimCIn: 12,
      dimDIn: 0,
    };
    // Style 1, 40mil White (rate 0.3481): wrap 12 sqft → $34.0035 (curb-wrap.test.ts) into M0.
    const { inputs, curbMaterial, warnings } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, styleId: 1 }] }),
      withCurb,
    );
    expect(warnings).toEqual([]);
    expect(curbMaterial).toBeCloseTo(34.0035, 3);
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 34.0035, 2);
    // Style 3 = quote required: warned, nothing billed.
    const quoted = buildEstimateInputs(bid({ curbs: [{ ...curb, styleId: 3 }] }), withCurb);
    expect(quoted.curbMaterial).toBe(0);
    expect(quoted.warnings.some((w) => w.includes("requires a quote"))).toBe(true);
    // No styleId (older saved bids): manual as before — no material, no warning.
    const manual = buildEstimateInputs(bid({ curbs: [curb] }), withCurb);
    expect(manual.curbMaterial).toBe(0);
    expect(manual.warnings).toEqual([]);
  });

  it("membrane tier: a non-roll-good sheet prices the FIELD share at the lap's tab tier; perim/corner shares stay unpriced (legacy -1 zone laps)", () => {
    const tabAdmin: EngineAdminData = {
      ...admin,
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, tab60: { White: 1.1 } } },
      sheetTabSpacings: { 1: [28, 60, 120] },
      labor: {
        "Duro-Last|mechanical": buildLaborTables(
          {
            ...combo,
            sheet_size_multipliers: [
              { label: "1500 sf", roof_section: 1, underlayment: 1 },
              { label: "2000 sf", roof_section: 0.98, underlayment: 0.98 },
            ],
          },
          deckOrder,
        ),
      },
    };
    // Plain tab-sheet section (no zones): field share = 1 -> full MembraneWithOverlap at tab60.
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, sheetSizeLabel: "2000 sf", fieldLap: 60 }],
      }),
      tabAdmin,
    );
    // MembraneWithOverlap(50x50, _230) x $1.10: MWO * 1.23/1.23 x 1.10 = 2861.10
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(((MWO * 1.23) / 1.23) * 1.1, 2);

    // With a perimeter zone marked, only the field SHARE is priced (legacy skips zones whose
    // custom lap is -1): areas 2500 total, perim 100x3 -> field share 2200/2500.
    const { inputs: zoned } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            sheetSizeLabel: "2000 sf",
            fieldLap: 60,
            perimLengthFt: 100,
            enhancementWidthFt: 3,
          },
        ],
      }),
      tabAdmin,
    );
    expect(zoned.membraneCostBeforeDiscount).toBeCloseTo(
      ((MWO * 1.23) / 1.23) * 1.1 * (2200 / 2500),
      2,
    );

    // The roll-good sheet (the combo's FIRST label) keeps the roll-goods tier on the full area.
    const { inputs: rg } = buildEstimateInputs(bid(), tabAdmin);
    expect(rg.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.23, 2);
  });

  it("membrane tier: custom zone laps price the perim/corner shares (≥60→tab60, ≥24→tab28, no 120 tier)", () => {
    const tabAdmin: EngineAdminData = {
      ...admin,
      priceMatrix: {
        40: { rollGoods: { White: 1.23 }, tab60: { White: 1.1 }, tab28: { White: 1.35 } },
      },
      sheetTabSpacings: { 1: [28, 60, 120] },
      labor: {
        "Duro-Last|mechanical": buildLaborTables(
          {
            ...combo,
            sheet_size_multipliers: [
              { label: "1500 sf", roof_section: 1, underlayment: 1 },
              { label: "2000 sf", roof_section: 0.98, underlayment: 0.98 },
            ],
          },
          deckOrder,
        ),
      },
    };
    const mwo = (MWO * 1.23) / 1.23; // MembraneWithOverlap × 1 (price factored out)
    // Perim zone marked with a custom 28" lap: field share at tab60, perim share at tab28.
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            sheetSizeLabel: "2000 sf",
            fieldLap: 60,
            perimLengthFt: 100,
            enhancementWidthFt: 3,
            perimLap: 28,
          },
        ],
      }),
      tabAdmin,
    );
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(
      mwo * 1.1 * (2200 / 2500) + mwo * 1.35 * (300 / 2500),
      2,
    );
    // A 120" perim lap has NO 120 tier — it prices at tab60 (≥ 60).
    const { inputs: at120 } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            sheetSizeLabel: "2000 sf",
            fieldLap: 60,
            perimLengthFt: 100,
            enhancementWidthFt: 3,
            perimLap: 120,
          },
        ],
      }),
      tabAdmin,
    );
    expect(at120.membraneCostBeforeDiscount).toBeCloseTo(
      mwo * 1.1 * (2200 / 2500) + mwo * 1.1 * (300 / 2500),
      2,
    );
    // Unset lap keeps the legacy default: perim share unpriced.
    const { inputs: unset } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            sheetSizeLabel: "2000 sf",
            fieldLap: 60,
            perimLengthFt: 100,
            enhancementWidthFt: 3,
          },
        ],
      }),
      tabAdmin,
    );
    expect(unset.membraneCostBeforeDiscount).toBeCloseTo(mwo * 1.1 * (2200 / 2500), 2);
  });

  it("membrane tier: the SEEDED combo shape (first label 'Roll Good') prices a default '1500 sf' section at tab28 — pinned so the reprice is deliberate", () => {
    const seededAdmin: EngineAdminData = {
      ...admin,
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, tab28: { White: 1.35 } } },
      sheetTabSpacings: { 1: [28, 60, 120] },
      labor: {
        "Duro-Last|mechanical": buildLaborTables(
          {
            ...combo,
            sheet_size_multipliers: [
              { label: "Roll Good", roof_section: 4, underlayment: 4 },
              { label: "1500 sf", roof_section: 1, underlayment: 1 },
            ],
          },
          deckOrder,
        ),
      },
    };
    const { inputs, warnings } = buildEstimateInputs(bid(), seededAdmin); // default: 1500 sf, lap 28
    expect(warnings).toEqual([]);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(((MWO * 1.23) / 1.23) * 1.35, 2);
  });

  it("membrane tier: a pre-series adminSnapshot (LaborTables without rollGoodsSheetLabel) keeps roll goods with NO warnings", () => {
    const oldTables = { ...buildLaborTables(combo, deckOrder) } as Record<string, unknown>;
    delete oldTables["rollGoodsSheetLabel"]; // jsonb snapshot taken before the field existed
    const snapshotAdmin: EngineAdminData = {
      ...admin,
      labor: { "Duro-Last|mechanical": oldTables as never },
    };
    const { inputs, warnings } = buildEstimateInputs(bid(), snapshotAdmin);
    expect(warnings).toEqual([]);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.23, 2);
  });

  it("membrane tier: flat-family systems (Duro-Tuff) never hit the tab-pitch path — flat price, no tab warnings", () => {
    const dtAdmin: EngineAdminData = {
      ...admin,
      sheetTabSpacings: { 1: [28, 60, 120] },
      familyMembranePrices: { "Duro-Tuff": { "40": 1.23 } },
      labor: {
        "Duro-Tuff|mechanical": buildLaborTables(
          {
            ...combo,
            roof_system: "Duro-Tuff",
            sheet_size_multipliers: [
              { label: "Roll Good", roof_section: 4, underlayment: 4 },
              { label: "1500 sf", roof_section: 1, underlayment: 1 },
            ],
          },
          deckOrder,
        ),
      },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({ roofSystem: "Duro-Tuff", sections: [{ ...bid().sections[0]!, fieldLap: 30 }] }),
      dtAdmin,
    );
    expect(warnings.filter((w) => w.includes("tab pitch"))).toEqual([]);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(tuffQty(30) * 1.23, 2); // Duro-Tuff layout
  });

  it("family membrane pricing: Duro-Bond/Tuff are flat thickness-keyed; Duro-Fleece keys by membrane type", () => {
    const famAdmin: EngineAdminData = {
      ...admin,
      familyMembranePrices: {
        "Duro-Bond": { "40": 1.05, "50": 1.15 },
        "Duro-Tuff": { "50": 0.95 },
        "Duro-Fleece": { "50mil": 1.39, "50mil Plus": 1.92 },
      },
    };
    const mwo = MWO; // Duro-Bond on the "1500 sf" sheet: SheetsMembraneCalc, like Duro-Last
    // Duro-Bond 40mil: flat price, no color, no tier, no "No price" warning.
    const bond = buildEstimateInputs(bid({ roofSystem: "Duro-Bond" }), famAdmin);
    expect(bond.warnings.filter((w) => w.includes("price"))).toEqual([]);
    expect(bond.inputs.membraneCostBeforeDiscount).toBeCloseTo(mwo * 1.05, 2);
    // Duro-Fleece 50mil keys "50mil" (the non-Plus row; Plus is unreachable from thickness).
    const fleece = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Fleece",
        sections: [{ ...bid().sections[0]!, thickness: 50 }],
      }),
      famAdmin,
    );
    // Duro-Fleece is ALWAYS roll goods (CalculateMembraneQty), LapOver 3": 28" lap → int 2.
    expect(fleece.inputs.membraneCostBeforeDiscount).toBeCloseTo(rollQty(2, 0.25) * 1.39, 2);
    // Missing row → warning + $0 (never a silent roll-goods fallback for these families).
    const missing = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Tuff",
        sections: [{ ...bid().sections[0]!, thickness: 60 }],
      }),
      famAdmin,
    );
    expect(missing.inputs.membraneCostBeforeDiscount).toBeCloseTo(0, 6);
    expect(missing.warnings.some((w) => w.includes("Duro-Tuff"))).toBe(true);
  });

  it("Duro-Roof: always zoned (no roll-good branch), 57-inch middle threshold, ×1.05 surcharge", () => {
    const drAdmin: EngineAdminData = {
      ...admin,
      priceMatrix: { 40: { rollGoods: { White: 1.23 }, tab60: { White: 1.1 } } },
      sheetTabSpacings: { 4: [57, 87, 120] },
    };
    const mwo = (MWO * 1.23) / 1.23;
    // Field lap 87 (≥57, <120) → the 60"-Tabs row (Category 4), ×1.05 — even on the default
    // sheet label (legacy Duro-Roof has NO roll-good sheet branch).
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Roof",
        sections: [{ ...bid().sections[0]!, fieldLap: 87 }],
      }),
      drAdmin,
    );
    expect(warnings.filter((w) => w.includes("price"))).toEqual([]);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(mwo * 1.1 * 1.05, 2);
    // A 57-lap perim ZONE also maps to the 60"-Tabs row under the Duro-Roof threshold.
    const zoned = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Roof",
        sections: [
          {
            ...bid().sections[0]!,
            fieldLap: 87,
            perimLengthFt: 100,
            enhancementWidthFt: 3,
            perimLap: 57,
          },
        ],
      }),
      drAdmin,
    );
    // shares: field 2200/2500, perim 300/2500 — both at the tab60 price, ×1.05.
    expect(zoned.inputs.membraneCostBeforeDiscount).toBeCloseTo(mwo * 1.1 * 1.05, 2);
  });

  it("Duro-Roof on a pre-series adminSnapshot (no sheetTabSpacings) keeps roll goods ×1.05 with NO warnings", () => {
    // admin has no sheetTabSpacings at all — the shape of a snapshot frozen before the tier data
    // existed. Zoned pricing must not engage (it would warn "not a selectable tab pitch").
    const { inputs, warnings } = buildEstimateInputs(bid({ roofSystem: "Duro-Roof" }), admin);
    expect(warnings.filter((w) => w.includes("tab pitch"))).toEqual([]);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.23 * 1.05, 2);
  });

  it("metals: material folds into M0 (not OtherMaterial); labor $ into services", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        metals: [
          {
            description: '8"X15"X24" Collection Box',
            price: 550,
            laborPerUnit: 1.5,
            laborRate: 40,
            quantity: 2,
          },
        ],
      }),
      admin,
    );
    // material: 2 x 550 = 1100 -> M0 alongside membrane MWO * 1.23; OtherMaterial untouched
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 1100, 2);
    expect(inputs.otherMaterial).toBeCloseTo(0, 6);
    // labor: 2 x 1.5 h x $40 = $120 at the LINE's own rate -> DIRECT labor (legacy dLabor[5]
    // inside LaborSubtotal1), NOT services; the 3 hours join LS1 hours (man-days).
    expect(inputs.servicesCost).toBeCloseTo(0, 6);
    expect(inputs.ownRateDirectLaborCost).toBeCloseTo(120, 2);
    expect(inputs.ownRateDirectLaborHours).toBeCloseTo(3, 6);
    const r = computeEstimate(inputs);
    expect(r.laborSubtotal2).toBeCloseTo(0, 6);
    // base bid crew labor = INSTALL h x $50 = 786.80; + metals $120 own-rate
    expect(r.laborSubtotal1).toBeCloseTo(INSTALL * 50 + 120, 2);
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 3, 6);
  });

  it("insulation layers: mechanical layout+fastener labor and adhesive coverage flow", () => {
    const withU: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85, "Duro-Fold": 0.3 },
      underlaymentLabor: {
        layoutHoursByProduct: { '1/2" ISO': 7.775, "Duro-Fold": 6.9 },
        fastenerCounts: [5, 6, 8],
        fastenerMinutesByDeck: { Wood: 0.342 },
      },
      adhesiveTimes: {
        adhesives: ["Duro-Grip Adhesive(CR-20)"],
        bySubstrate: {
          "Duro-Grip Adhesive(CR-20)": { "ISO 4'x8'": { coverageSqFt: 2000, labor: 6.5 } },
        },
      },
      adhesivePrices: { "Duro-Grip Adhesive(CR-20)": 899 },
    };
    const { inputs, warnings, adhesiveMaterial } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            layers: [
              {
                board: '1/2" ISO',
                attachment: "mechanical",
                fastenersPerBoard: 5,
                adhesiveName: "",
                substrate: "",
              },
              {
                board: "Duro-Fold",
                attachment: "adhesive",
                fastenersPerBoard: 0,
                adhesiveName: "Duro-Grip Adhesive(CR-20)",
                substrate: "ISO 4'x8'",
              },
            ],
          },
        ],
      }),
      withU,
    );
    expect(warnings).toEqual([]);
    // board material: 2500 x (0.85 + 0.30) x 1.03 waste = 2961.25 -> underlayment purchase line
    expect(inputs.materialUnderlayment).toBeCloseTo(2961.25, 2);
    // adhesive material (legacy AggregateCalcQtys): 2500/2000 = 1.25 units, ceilinged once per
    // adhesive across the estimate -> 2 whole units x $899 = $1798 -> M0
    expect(adhesiveMaterial).toBeCloseTo(1798, 2);
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 1798, 2);
    const r = computeEstimate(inputs);
    // mech (legacy rule, docs §18): layout 7.775 + (0.342/60) × (Round(2500/32)=78 × 5 = 390)
    // = 9.998 h; adhesive layer: layout 6.9 + (field 2500 + perim 0) × 6.5 / 2500 = 13.4 h
    expect(r.underlaymentLaborHours).toBeCloseTo(9.998 + 13.4, 3);
    expect(r.laborSubtotal1Hours).toBeCloseTo(INSTALL + 9.998 + 13.4, 3);
  });

  it("adhesive units sum fractionally per adhesive across sections, then Ceiling ONCE per adhesive", () => {
    const glueA = "Duro-Grip Adhesive(CR-20)";
    const glueB = "Water Based Adhesive";
    const withU: EngineAdminData = {
      ...admin,
      underlaymentPrices: { "Duro-Fold": 0.3 },
      adhesiveTimes: {
        adhesives: [glueA, glueB],
        bySubstrate: {
          [glueA]: { "ISO 4'x8'": { coverageSqFt: 2000, labor: 6.5 } },
          [glueB]: { "ISO 4'x8'": { coverageSqFt: 500, labor: 5.215 } },
        },
      },
      adhesivePrices: { [glueA]: 899, [glueB]: 122.1 },
    };
    const layer = (name: string) => ({
      board: "Duro-Fold",
      attachment: "adhesive" as const,
      fastenersPerBoard: 0,
      adhesiveName: name,
      substrate: "ISO 4'x8'",
    });
    const s0 = bid().sections[0]!; // 50 x 50 = 2500 sq ft
    const { adhesiveMaterial } = buildEstimateInputs(
      bid({
        sections: [
          { ...s0, layers: [layer(glueA), layer(glueB)] },
          { ...s0, id: "s2", name: "B", layers: [layer(glueA)] },
        ],
      }),
      withU,
    );
    // glueA: 1.25 + 1.25 = 2.5 -> Ceil 3 units x $899; glueB: 2500/500 = 5 (already whole) x $122.10.
    // Ceiling is PER ADHESIVE on the estimate total (AggregateCalcQtys) - not per layer (which
    // would give 2 + 2 = 4 units of glueA), not on the mixed total.
    // §12.4: each adhesive's cost rounds to WHOLE dollars (banker's): 2697 + Round(610.5) = 3307.
    expect(adhesiveMaterial).toBeCloseTo(3 * 899 + 610, 2);
  });

  it("legacy underlaymentBoard converts to one mechanical layer at 5 fasteners/board", () => {
    const withU: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85 },
      underlaymentLabor: {
        layoutHoursByProduct: { '1/2" ISO': 7.775 },
        fastenerCounts: [5],
        fastenerMinutesByDeck: { Wood: 0.342 },
      },
    };
    const { inputs } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }] }),
      withU,
    );
    const r = computeEstimate(inputs);
    expect(inputs.materialUnderlayment).toBeCloseTo(2188.75, 2); // unchanged material
    expect(r.underlaymentLaborHours).toBeCloseTo(9.998, 3); // legacy 5-per-board rule (§18)
  });

  it("labor adjusts are the item fields the template writes: install, setup, inspection, tear-off, parapets (§20.3)", () => {
    const withTpl: EngineAdminData = {
      ...admin,
      tearOff: {
        deckColumns: ["Wood"],
        tearoffTypes: ['BUR < 2"'],
        lookup: { Wood: { 'BUR < 2"': 2.4876 / 100 } },
      },
      setupTable: { minimum: 16, bands: [{ upTo: 6000, value: 0.003, multiply: true }] },
      inspectionTable: { minimum: 5, bands: [{ edge: 0, value: 5 }] },
      parapetLabor: {
        bands: ['0"-30"'],
        lookup: {
          Wood: {
            '0"-30"': {
              noDrillNoCant: 2.25,
              noDrillCanted: 3.375,
              predrillNoCant: 3.5,
              predrillCanted: 5.25,
            },
          },
        },
      },
      // The template exists, but the engine never composes it: its values reach the estimate
      // only through the fields applyLaborTemplate writes (legacy frmHome.updateTemplate).
      laborTemplates: {
        names: ["Heavy"],
        byName: {
          Heavy: {
            "Roof Section Labor": -10,
            "Setup Time Labor": 20,
            "Tear-Off Labor": 50,
            "Parapets Labor": 10,
            "Inspection Time Labor": 0,
          },
        },
      },
    };
    const wall = {
      id: "p1",
      name: "Wall",
      lengthFt: 100,
      heightBand: '0"-30"',
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 0,
    };
    const section = {
      ...bid().sections[0]!,
      tearOff: true,
      tearOffType: 'BUR < 2"',
      toThicknessInches: 4,
    };
    // Name only → nothing adjusted.
    const nameOnly = buildEstimateInputs(
      bid({ laborTemplateName: "Heavy", sections: [section], parapets: [wall] }),
      withTpl,
    );
    expect(nameOnly.warnings).toEqual([]);
    const r0 = computeEstimate(nameOnly.inputs);
    expect(r0.installHours).toBeCloseTo(INSTALL, 6);
    expect(r0.setupHours).toBeCloseTo(16, 6);
    expect(r0.tearOffLaborHours).toBeCloseTo(62.19, 1);
    expect(r0.parapetLaborHours).toBeCloseTo(4.59, 6);
    // The written fields (what selecting "Heavy" stores on the bid / items) drive the hours.
    const written = buildEstimateInputs(
      bid({
        laborTemplateName: "Heavy",
        adjustLaborPct: -10,
        adjustSetupPct: 20,
        adjustInspectionPct: 0,
        sections: [{ ...section, tearOffAdditionalPct: 50 }],
        parapets: [{ ...wall, adjustLaborPct: 10 }],
      }),
      withTpl,
    );
    const r = computeEstimate(written.inputs);
    expect(r.installHours).toBeCloseTo(INSTALL * 0.9, 3); // Roof Section Labor -10
    expect(r.setupHours).toBeCloseTo(16 * 1.2, 3); // Setup +20 (min 16 x 1.2)
    // tear-off: base 62.19 x 1.5 (per-section TO_Additional), then Ceiling-to-cent
    expect(r.tearOffLaborHours).toBeCloseTo(62.19 * 1.5, 1);
    expect(r.parapetLaborHours).toBeCloseTo(4.59 * 1.1, 3); // Parapets +10, AdjustedLength 102
  });

  it("edges: perimeter-marked sides drive the perimeter zone; ARP edges reduce membrane sqft (§2.3)", () => {
    const mkEdge = (side: string, lengthFt: number, over = {}) => ({
      side,
      lengthFt,
      isPerimeter: false,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
      ...over,
    });
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            perimLengthFt: 0, // stale manual value — edges are the source of truth
            enhancementWidthFt: 3,
            edges: [
              mkEdge("A", 50, { isPerimeter: true, arpSizeIn: 12 }),
              mkEdge("B", 50),
              mkEdge("C", 50, { isPerimeter: true }),
              mkEdge("D", 50),
            ],
          },
        ],
      }),
      admin,
    );
    const s0 = inputs.sections[0]!;
    // perimeter from the two marked 50 ft sides: 100 ft × 3 ft zone = 300 sf carved from field
    // (labor areas carry the legacy share × MembraneWithOverlap basis, §20.1)
    expect(s0.perimArea).toBeCloseTo(300 * MWO_RATIO, 6);
    expect(s0.fieldArea).toBeCloseTo(2200 * MWO_RATIO, 6);
    // ARP on side A: 1.03 × ((12+6)/12) × 50 = 77.25 sf, subtracted from total membrane
    expect(s0.arpSqFt).toBeCloseTo(77.25, 6);
    const r = computeEstimate(inputs);
    expect(r.sqFtTotalMembrane).toBe(Math.ceil(s0.membraneWithOverlap - 77.25));
  });

  it("per-bid setup/inspection adjust % flow through (composed with template factors)", () => {
    const withBands: EngineAdminData = {
      ...admin,
      setupTable: { minimum: 16, bands: [{ upTo: 100000, value: 0.003, multiply: true }] },
      inspectionTable: { minimum: 5, bands: [{ edge: 0, value: 5 }] },
    };
    const { inputs } = buildEstimateInputs(
      bid({ adjustSetupPct: 50, adjustInspectionPct: 20 }),
      withBands,
    );
    const r = computeEstimate(inputs);
    expect(r.setupHours).toBeCloseTo(16 * 1.5, 6); // min-16 base × +50%
    expect(r.inspectionHours).toBeCloseTo(5 * 1.2, 6); // 5 h band × +20%
  });

  it("warns when a price or labor combo is missing", () => {
    const noPrice = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, color: "Purple" }] }),
      admin,
    );
    expect(noPrice.warnings.some((w) => w.includes("No price"))).toBe(true);

    const noLabor = buildEstimateInputs(bid({ roofSystem: "Duro-Tuff" }), admin);
    expect(noLabor.warnings.some((w) => w.includes("No labor table"))).toBe(true);
  });
});

describe("membrane adhesive units for adhered systems (§2.4)", () => {
  const withCov = (): EngineAdminData => ({
    ...admin,
    adhesivePrices: { "Water Based Adhesive": 122.1 },
    membraneAdhesives: {
      1: {
        "Water Based Adhesive": {
          byDeckName: { Wood: 700 },
          underlaymentUniform: 700,
          wallCoverage: 350,
        },
      },
    },
  });

  it("§22.9 coverage over insulation keys the TOP board's group when the admin grid gave one", () => {
    const withGroups: EngineAdminData = {
      ...withCov(),
      underlaymentPrices: { '1/2" ISO': 0.85 },
      underlaymentGroups: {
        groups: [],
        groupIdByBoard: { '1/2" ISO': 2 },
        needQuoteByBoard: {},
        adhesiveGroupIdByBoard: { '1/2" ISO': 2 },
        adhesiveGroupNameById: { 2: "ISO 4'x8'" },
      },
    };
    withGroups.membraneAdhesives![1]!["Water Based Adhesive"]!.byUnderlaymentGroup = { 2: 500 };
    const layer = {
      board: '1/2" ISO',
      attachment: "none" as const,
      fastenersPerBoard: 0,
      adhesiveName: "",
      substrate: "",
    };
    const r = buildEstimateInputs(
      bid({ attachment: "adhered", sections: [{ ...bid().sections[0]!, layers: [layer] }] }),
      withGroups,
    );
    // 2500 / 500 = 5 units (not 2500/700 → 4) × $122.10 = 610.5 → Round 610
    expect(r.adhesiveWholeUnits?.["Water Based Adhesive"]).toBe(5);
  });

  it("bare-deck sections bill area/coverage, ceilinged once at the estimate level", () => {
    // 50×50 = 2500 sq ft on Wood at 700 sq ft/unit → 3.571… → Ceil 4 units × $122.10.
    const { adhesiveMaterial, warnings } = buildEstimateInputs(
      bid({ attachment: "adhered" }),
      withCov(),
    );
    // §12.4 whole-dollar rounding: Round(488.4, 0) = 488.
    expect(adhesiveMaterial).toBeCloseTo(488, 2);
    expect(warnings.filter((w) => w.toLowerCase().includes("adhesive"))).toEqual([]);
  });

  it("parapet wall adhesive joins the same aggregate (girth-area / wall coverage)", () => {
    // membrane 2500/700 = 3.5714; wall: In2Ft(24)=2 ft × 100 ft = 200 sq ft / 350 = 0.5714
    // → 4.1428 → Ceil 5 units.
    const { adhesiveMaterial } = buildEstimateInputs(
      bid({
        attachment: "adhered",
        parapets: [
          {
            id: "p1",
            name: "P1",
            lengthFt: 100,
            heightBand: "",
            deckType: "Wood",
            girthInches: 24,
            predrill: false,
            canted: false,
          },
        ],
      }),
      withCov(),
    );
    // §12.4 whole-dollar rounding: Round(610.5, 0) = 610 (banker's).
    expect(adhesiveMaterial).toBeCloseTo(610, 2);
  });

  it("wall adhesive with profile dims bills WallPlusTopSqFt = length x (Vertical+WallTop)/12", () => {
    // membrane 2500/700 = 3.5714; wall: 100 x (30+6)/12 = 300 sq ft / 350 = 0.8571 -> 4.4286
    // -> Ceil 5. The FULL girth (20+0+30+6+20 = 76" -> 633.3 sq ft -> 1.809) would Ceil to 6 —
    // proving the basis excludes skirt/drop.
    const { adhesiveMaterial } = buildEstimateInputs(
      bid({
        attachment: "adhered",
        parapets: [
          {
            id: "p1",
            name: "P1",
            lengthFt: 100,
            heightBand: "",
            deckType: "Wood",
            girthInches: 0,
            predrill: false,
            canted: false,
            skirtInches: 20,
            cantInches: 0,
            verticalInches: 30,
            wallTopInches: 6,
            dropInches: 20,
          },
        ],
      }),
      withCov(),
    );
    // §12.4 whole-dollar rounding: Round(610.5, 0) = 610 (banker's).
    expect(adhesiveMaterial).toBeCloseTo(610, 2);
  });

  it("warns instead of guessing when coverage is unknown (deck not in table)", () => {
    const a = withCov();
    a.membraneAdhesives![1]!["Water Based Adhesive"]!.byDeckName = {};
    const { adhesiveMaterial, warnings } = buildEstimateInputs(bid({ attachment: "adhered" }), a);
    expect(adhesiveMaterial).toBe(0);
    expect(warnings.some((w) => w.includes("Membrane adhesive coverage unknown"))).toBe(true);
  });

  it("mechanical bids bill no membrane adhesive", () => {
    const { adhesiveMaterial } = buildEstimateInputs(bid(), withCov());
    expect(adhesiveMaterial).toBe(0);
  });
});

describe("auto-priced NDL items (§8.3/§8.4/§8.6: counterflash / blocking / capstones / ARP)", () => {
  const autoRates = {
    counterflash: { price: 4, laborPerUnit: 0.0167, laborRate: 45 },
    parapetBlocking: { price: 0.57, laborPerUnit: 0.04, laborRate: 40 },
    masonryRemove: { price: 0, laborPerUnit: 0.1, laborRate: 45 },
    masonryReplace: { price: 5, laborPerUnit: 0, laborRate: 45 },
    arpPricePerSqFt: 3,
  };
  const withCurbLabor: EngineAdminData = {
    ...admin,
    autoRates,
    curbLabor: {
      setupMinutes: 8,
      minutesByDeck: { Wood: 7.5 },
      multiplierByType: { Closed: 1 },
      curbTypes: ["Closed"],
    },
  };
  const withParapet: EngineAdminData = {
    ...admin,
    autoRates,
    priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
    parapetLabor: {
      bands: ['0"-30"'],
      lookup: {
        Wood: {
          '0"-30"': {
            noDrillNoCant: 2.25,
            noDrillCanted: 3.375,
            predrillNoCant: 3.5,
            predrillCanted: 5.25,
          },
        },
      },
    },
  };
  const wall = {
    id: "p1",
    name: "North wall",
    lengthFt: 100,
    heightBand: '0"-30"',
    deckType: "Wood",
    predrill: false,
    canted: false,
    girthInches: 30.4,
  };
  const curb = {
    id: "c1",
    name: "RTU curb",
    quantity: 2,
    widthIn: 24,
    lengthIn: 36,
    curbType: "Closed",
    deckType: "Wood",
  };

  it("counterflash (term option 5): Σ(A+B)×qty×2 in → quarter-up → ÷12 → Ceil ft on the $4/0.0167h/$45 row", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, termOption: 5 }] }),
      withCurbLabor,
    );
    expect(warnings).toEqual([]);
    // (24+36) × 2 × 2 = 240 in → 240/12 = 20 ft
    expect(inputs.otherMaterial).toBeCloseTo(20 * 4, 2);
    expect(inputs.ownRateDirectLaborCost).toBeCloseTo(20 * 0.0167 * 45, 4); // 15.03
    expect(inputs.ownRateDirectLaborHours).toBeCloseTo(20 * 0.0167, 6);
  });

  it("counterflash fractional inches round UP to the next 0.25 before ÷12", () => {
    const { inputs } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, quantity: 1, widthIn: 14.025, lengthIn: 10, termOption: 5 }] }),
      withCurbLabor,
    );
    // (24.025) × 1 × 2 = 48.05 → 48.25 (quarter-up) → /12 = 4.02 → Ceil 5 (without the
    // quarter step it would be 48.05/12 = 4.00 → 4)
    expect(inputs.otherMaterial).toBeCloseTo(5 * 4, 2);
  });

  it("other termination options bill no counterflash", () => {
    const { inputs } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, termOption: 3 }] }),
      withCurbLabor,
    );
    expect(inputs.otherMaterial).toBeCloseTo(0, 6);
  });

  it("parapet wood blocking: Ceil(Σ length × 1.03) on the TopOfParapet row — material AND labor (ReviewCalc.NonDL case 1)", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({ parapets: [{ ...wall, hasBlocking: true }] }),
      withParapet,
    );
    expect(warnings).toEqual([]);
    // 100 × 1.03 = 103 → Ceil 103 units × 0.04 h × $40 = $164.80 labor; 103 × $0.57 material
    // (the legacy dialog footer is labor-only, but dMaterial[14] bills WallBlockings.MaterialCost).
    expect(inputs.ownRateDirectLaborHours).toBeCloseTo(103 * 0.04, 6);
    expect(inputs.ownRateDirectLaborCost).toBeCloseTo(103 * 0.04 * 40, 2);
    expect(inputs.otherMaterial).toBeCloseTo(103 * 0.57, 6);
  });

  it("capstones: option 1 → Remove Only Ceil(len/2); option 2 → Replace ONLY + sealant ordering note", () => {
    const removed = buildEstimateInputs(
      bid({ parapets: [{ ...wall, capstoneOption: 1 }] }),
      withParapet,
    );
    // Ceil(100/2) = 50 × 0.1 h × $45 = $225 labor, $0 material
    expect(removed.inputs.ownRateDirectLaborCost).toBeCloseTo(225, 2);
    expect(removed.inputs.otherMaterial).toBeCloseTo(0, 6);

    const reinstalled = buildEstimateInputs(
      bid({ parapets: [{ ...wall, capstoneOption: 2, capstoneLengthFt: 45 }] }),
      withParapet,
    );
    // Option-2 walls feed the REINSTALL item only (verbatim legacy): Ceil(45/2) = 23 × $5
    expect(reinstalled.inputs.otherMaterial).toBeCloseTo(23 * 5, 2);
    expect(reinstalled.inputs.ownRateDirectLaborCost).toBeCloseTo(0, 6);
    // sealant tubes: Ceil(Ceil(45)/40) = 2 — ordering quantity only
    expect(reinstalled.warnings.some((w) => w.includes("2 tubes"))).toBe(true);
  });

  it("parapet ARP: ((size+6)/12) × AdjustedLength (no ×1.03) × $/sqft → M0", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({ parapets: [{ ...wall, arpSizeIn: 18 }] }),
      withParapet,
    );
    expect(warnings).toEqual([]);
    // (18+6)/12 = 2 ft wide × AdjustedLength 102 (arp length defaults to the wall length) =
    // 204 sq ft → Ceil 204 × $3 = $612, on top of membrane MWO * 1.23 + parapet membrane 368.42
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 368.42 + 612, 2);
    // a custom ARP length bills RAW (not adjusted): 2 × 30 = 60 → $180
    const custom = buildEstimateInputs(
      bid({ parapets: [{ ...wall, arpSizeIn: 18, arpLengthFt: 30 }] }),
      withParapet,
    );
    expect(custom.inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 368.42 + 180, 2);
  });

  it("section and parapet ARP are ceiled SEPARATELY before pricing", () => {
    const edges = [
      {
        side: "A",
        lengthFt: 10,
        isPerimeter: false,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 12,
      },
    ];
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, edges }],
        parapets: [{ ...wall, arpSizeIn: 18 }],
      }),
      withParapet,
    );
    // section: 1.03 × ((12+6)/12) × 10 = 15.45 → Ceil 16; parapet: 204 → Ceil 204;
    // qty = 16 + 204 = 220 × $3 = $660
    const arpMaterial = 220 * 3;
    expect(inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 368.42 + arpMaterial, 2);
  });

  it("geometry that needs a missing rate row warns instead of silently billing $0", () => {
    const noRates: EngineAdminData = { ...withParapet };
    delete (noRates as { autoRates?: unknown }).autoRates;
    const { warnings } = buildEstimateInputs(
      bid({
        parapets: [{ ...wall, hasBlocking: true, capstoneOption: 1, arpSizeIn: 18 }],
        curbs: [{ ...curb, termOption: 5 }],
      }),
      { ...noRates, curbLabor: withCurbLabor.curbLabor! },
    );
    expect(warnings.some((w) => w.includes("Curb Counter Flashing"))).toBe(true);
    expect(warnings.some((w) => w.includes('2" x 4" W/ 8" ISO'))).toBe(true);
    expect(warnings.some((w) => w.includes("Remove Only"))).toBe(true);
    expect(warnings.some((w) => w.includes("ARP (SqFt)"))).toBe(true);
  });
});

describe("Enhancement Options (§10.3: custom fastener densities + adhesive ribbon spacing)", () => {
  const withU: EngineAdminData = {
    ...admin,
    underlaymentPrices: { '1/2" ISO': 0.85 },
    underlaymentLabor: {
      layoutHoursByProduct: { '1/2" ISO': 7.775 },
      fastenerCounts: [5],
      fastenerMinutesByDeck: { Wood: 0.342 },
    },
    adhesiveTimes: {
      adhesives: ["Duro-Grip Adhesive(CR-20)"],
      bySubstrate: {
        "Duro-Grip Adhesive(CR-20)": { "ISO 4'x8'": { coverageSqFt: 2000, labor: 6.5 } },
      },
    },
    adhesivePrices: { "Duro-Grip Adhesive(CR-20)": 899 },
  };
  const mechLayer = {
    board: '1/2" ISO',
    attachment: "mechanical" as const,
    fastenersPerBoard: 5,
    adhesiveName: "",
    substrate: "",
  };

  it("custom densities replace the count: Round(d×zone area) per zone, banker's Round", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            perimLengthFt: 200,
            enhancementWidthFt: 3, // perim 600, field 1900, corner 0
            layers: [mechLayer],
            uCustomFastenerDensity: { field: 0.05, perim: 0.1, corner: 0.2 },
          },
        ],
      }),
      withU,
    );
    expect(warnings).toEqual([]);
    const r = computeEstimate(inputs);
    // count = Round(0.05×1900) + Round(0.1×600) + Round(0.2×0) = 95 + 60 = 155
    // hours = 2500/2500 × 7.775 + 0.342/60 × 155 = 7.775 + 0.8835 = 8.6585
    expect(r.underlaymentLaborHours).toBeCloseTo(8.6585, 4);
    // default (no custom, legacy rule §18): Round(1900/32)=59×5 + Round(600/32)=19×5 = 390 →
    // 7.775 + 0.342/60 × 390 = 9.998 — custom is a real change
    const def = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            perimLengthFt: 200,
            enhancementWidthFt: 3,
            layers: [mechLayer],
          },
        ],
      }),
      withU,
    );
    expect(computeEstimate(def.inputs).underlaymentLaborHours).toBeCloseTo(9.998, 3);
  });

  it("custom ribbon spacing multiplies adhered-layer units by 12/spacing (labor unchanged)", () => {
    const adhLayer = {
      board: '1/2" ISO',
      attachment: "adhesive" as const,
      fastenersPerBoard: 0,
      adhesiveName: "Duro-Grip Adhesive(CR-20)",
      substrate: "ISO 4'x8'",
    };
    const def = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, layers: [adhLayer] }] }),
      withU,
    );
    // 2500/2000 = 1.25 units → Ceil 2 × $899
    expect(def.adhesiveMaterial).toBeCloseTo(2 * 899, 2);
    const custom = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, layers: [adhLayer], uAdhesiveSpacingIn: 6 }],
      }),
      withU,
    );
    // 1.25 × 12/6 = 2.5 units → Ceil 3 × $899; labor stays area-based
    expect(custom.adhesiveMaterial).toBeCloseTo(3 * 899, 2);
    expect(computeEstimate(custom.inputs).underlaymentLaborHours).toBeCloseTo(
      computeEstimate(def.inputs).underlaymentLaborHours,
      6,
    );
  });
});

describe("custom-quote underlayment layers (§10.5: Flute Filler / Tapered / ISO-Rigid Quote)", () => {
  const withU: EngineAdminData = {
    ...admin,
    underlaymentPrices: { '1/2" ISO': 0.85 },
    underlaymentLabor: {
      layoutHoursByProduct: { '1/2" ISO': 7.775 },
      fastenerCounts: [5],
      fastenerMinutesByDeck: { Wood: 0.342 },
    },
  };
  const quoteLayer = (quote: NonNullable<UnderlaymentLayer["quote"]>): UnderlaymentLayer => ({
    board: "Flute Filler",
    attachment: "mechanical",
    fastenersPerBoard: 0,
    adhesiveName: "",
    substrate: "",
    quote,
  });

  it("lump-sum quote bills the material VERBATIM (no waste) + labor hours; no warnings", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            layers: [quoteLayer({ name: "New Quote", lumpSum: 1500, laborAmount: 8 })],
          },
        ],
      }),
      withU,
    );
    expect(warnings).toEqual([]);
    expect(inputs.materialUnderlayment).toBeCloseTo(1500, 2);
    const r = computeEstimate(inputs);
    expect(r.underlaymentLaborHours).toBeCloseTo(8, 6);
  });

  it("piece quote bills pieces × cost/piece; labor in DAYS converts at hours-per-man-day", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            layers: [
              quoteLayer({
                name: "Tapered ISO quote",
                pieceMode: true,
                pieces: 10,
                costPerPiece: 42,
                laborAmount: 2,
                laborInDays: true,
              }),
            ],
          },
        ],
      }),
      withU,
    );
    expect(inputs.materialUnderlayment).toBeCloseTo(420, 2);
    // 2 days × 9 h/day (admin.settings.hoursPerDay)
    expect(computeEstimate(inputs).underlaymentLaborHours).toBeCloseTo(18, 6);
  });

  it("a quote layer stacks with a priced layer without disturbing it", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            layers: [
              {
                board: '1/2" ISO',
                attachment: "mechanical",
                fastenersPerBoard: 5,
                adhesiveName: "",
                substrate: "",
              },
              quoteLayer({ name: "New Quote", lumpSum: 300, laborAmount: 1 }),
            ],
          },
        ],
      }),
      withU,
    );
    expect(warnings).toEqual([]);
    // priced: 2500 × 0.85 × 1.03 = 2188.75; quote adds 300 verbatim
    expect(inputs.materialUnderlayment).toBeCloseTo(2188.75 + 300, 2);
    // priced labor 9.998 + quote 1 h
    expect(computeEstimate(inputs).underlaymentLaborHours).toBeCloseTo(10.998, 3);
  });
});

describe("§10.7 corrections: quote-id dedup, Calculate Pieces, QuoteAdhesiveUnits", () => {
  const withU: EngineAdminData = {
    ...admin,
    underlaymentPrices: { '1/2" ISO': 0.85 },
    adhesiveTimes: {
      adhesives: ["Duro-Grip Adhesive(CR-20)"],
      bySubstrate: {
        "Duro-Grip Adhesive(CR-20)": { "ISO 4'x8'": { coverageSqFt: 2000, labor: 6.5 } },
      },
    },
    adhesivePrices: { "Duro-Grip Adhesive(CR-20)": 899 },
    underlaymentGroups: {
      groups: [],
      groupIdByBoard: {},
      needQuoteByBoard: { "Tapered ISO": true },
      adhesiveGroupIdByBoard: { "Tapered ISO": 16, '1/2" ISO': 2 },
      adhesiveGroupNameById: { 16: "Tapered ISO", 2: "ISO 4'x8'" },
    },
  };

  it("the same quote ID across two sections bills ONCE (legacy CustomQuotes dedup)", () => {
    const q = {
      board: "Flute Filler",
      attachment: "mechanical" as const,
      fastenersPerBoard: 0,
      adhesiveName: "",
      substrate: "",
      quote: { id: "q1", name: "New Quote", lumpSum: 1500, laborAmount: 8 },
    };
    const s0 = bid().sections[0]!;
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [
          { ...s0, id: "s1", layers: [q] },
          { ...s0, id: "s2", name: "B", layers: [q] },
        ],
      }),
      withU,
    );
    expect(inputs.materialUnderlayment).toBeCloseTo(1500, 2);
    expect(computeEstimate(inputs).underlaymentLaborHours).toBeCloseTo(8, 6);
    // id-less quotes (older bids) still bill per occurrence
    const noId = { ...q, quote: { name: "New Quote", lumpSum: 1500, laborAmount: 8 } };
    const dup = buildEstimateInputs(
      bid({
        sections: [
          { ...s0, id: "s1", layers: [noId] },
          { ...s0, id: "s2", name: "B", layers: [noId] },
        ],
      }),
      withU,
    );
    expect(dup.inputs.materialUnderlayment).toBeCloseTo(3000, 2);
  });

  it("fluteFillerPieces: verbatim frmFluteFillerCalc geometry (re-read 0x24a00)", () => {
    // Knox County A: 188 × 182, 8 ft pieces (96"), 12" ridges: across = Round(2256/12) = 188;
    // x = 2184/96 = 22.75 (frac .75 ≥ .5 → no trim); rows = Round(22.75 + .25) = 23 → 4,324,
    // the owner's legacy quote. +10 % → Ceil(4756.4) = 4757.
    const knox = fluteFillerPieces({
      sections: [{ lengthFt: 188, widthFt: 182 }],
      pieceLengthFt: 8,
      ridgeToRidgeIn: 12,
      wastePct: 10,
    });
    expect(knox.pieces).toBe(4324);
    expect(knox.piecesWithWaste).toBe(4757);
    // 50 × 50, 4 ft pieces (48"), 24" ridges: across = Round(600/24) = 25; x = 600/48 = 12.5
    // (frac .5 → no trim); rows = Round(12.5 + .5) = 13 → 325.
    const r = fluteFillerPieces({
      sections: [{ lengthFt: 50, widthFt: 50 }],
      pieceLengthFt: 4,
      ridgeToRidgeIn: 24,
      wastePct: 10,
    });
    expect(r.pieces).toBe(325);
    // 50 × 45, 4 ft pieces, 24" ridges: x = 540/48 = 11.25 (frac .25 < .5 → trim
    // Round(.75 × 25) = 19); rows = Round(11.25 + .75) = 12 → 300 − 19 = 281.
    expect(
      fluteFillerPieces({
        sections: [{ lengthFt: 50, widthFt: 45 }],
        pieceLengthFt: 4,
        ridgeToRidgeIn: 24,
      }).pieces,
    ).toBe(281);
    expect(fluteFillerPieces({ sections: [], pieceLengthFt: 0, ridgeToRidgeIn: 24 }).pieces).toBe(
      0,
    );
  });

  it("an ADHERED quote layer whose OWN board is a tapered group bills quoteAdhesiveUnits verbatim (§22.6)", () => {
    // Legacy UnderlaymentAdhesive tests the LAYER'S OWN board (AdhesiveNeedsQuoteAdhesiveUnits)
    // and has no NeedQuote guard: the Tapered ISO quote layer itself carries the containers.
    const layers: UnderlaymentLayer[] = [
      {
        board: "Tapered ISO",
        attachment: "adhesive",
        fastenersPerBoard: 0,
        adhesiveName: "Duro-Grip Adhesive(CR-20)",
        substrate: "",
        quote: { id: "q2", name: "Tapered quote", lumpSum: 900, laborAmount: 0 },
        quoteAdhesiveUnits: 7,
      },
    ];
    const { inputs, warnings, adhesiveMaterial } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, layers }] }),
      withU,
    );
    // 7 containers verbatim × $899 (no coverage formula, no spacing multiplier)
    expect(adhesiveMaterial).toBeCloseTo(7 * 899, 2);
    expect(warnings).toEqual([]);
    expect(inputs.materialUnderlayment).toBeCloseTo(900, 2);
    // without the containers entered, it warns instead of billing $0 silently
    const missing = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, layers: [{ ...layers[0]!, quoteAdhesiveUnits: 0 }] }],
      }),
      withU,
    );
    expect(missing.warnings.some((w) => w.includes("quote adhesive containers"))).toBe(true);
  });

  it("an adhered board ABOVE a tapered board is unpriceable (legacy divides by coverage 0) — warns, bills 0", () => {
    const layers: UnderlaymentLayer[] = [
      {
        board: "Tapered ISO",
        attachment: "mechanical",
        fastenersPerBoard: 0,
        adhesiveName: "",
        substrate: "",
        quote: { id: "q2", name: "Tapered quote", lumpSum: 900, laborAmount: 0 },
      },
      {
        board: '1/2" ISO',
        attachment: "adhesive",
        fastenersPerBoard: 0,
        adhesiveName: "Duro-Grip Adhesive(CR-20)",
        substrate: "",
        quoteAdhesiveUnits: 7, // ignored: this layer's own board is not a quote group
      },
    ];
    const r = buildEstimateInputs(bid({ sections: [{ ...bid().sections[0]!, layers }] }), withU);
    expect(r.adhesiveMaterial).toBe(0);
    expect(r.warnings.some((w) => w.includes("No adhesive coverage"))).toBe(true);
  });
});

describe("§22.6 UnderlaymentAdhesive units — corner term and integer ribbon multipliers", () => {
  const adhLayer: UnderlaymentLayer = {
    board: '1/2" ISO',
    attachment: "adhesive",
    fastenersPerBoard: 0,
    adhesiveName: "Duro-Grip Adhesive(CR-20)",
    substrate: "ISO 4'x8'",
  };
  const withU: EngineAdminData = {
    ...admin,
    underlaymentPrices: { '1/2" ISO': 0.85 },
    underlaymentLabor: {
      layoutHoursByProduct: { '1/2" ISO': 7.775 },
      fastenerCounts: [5],
      fastenerMinutesByDeck: { Wood: 0.342 },
    },
    adhesiveTimes: {
      adhesives: ["Duro-Grip Adhesive(CR-20)"],
      bySubstrate: { "Duro-Grip Adhesive(CR-20)": { Wood: { coverageSqFt: 2000, labor: 2.5 } } },
    },
    adhesivePrices: { "Duro-Grip Adhesive(CR-20)": 899 },
  };
  // 50×50 with a 10 ft enhancement band and the two width-side corners marked:
  // perimeter run = 2×(50−2×10) + 2×50 − … — use the engine's own areas via a zero-lap check.
  const section = { ...bid().sections[0]!, layers: [adhLayer] };

  it("units basis = AreaField/k×m0 + (AreaPerimeter + AreaCorner)/k×m1 — corners INCLUDED", () => {
    const r = buildEstimateInputs(bid({ sections: [section] }), withU);
    // No enhancement zone in the fixture ⇒ field = 2500 → 2500/2000 = 1.25 → Ceil 2 boxes.
    expect(r.adhesiveWholeUnits?.["Duro-Grip Adhesive(CR-20)"]).toBe(2);
    expect(r.adhesiveMaterial).toBeCloseTo(2 * 899, 2);
  });

  it('custom spacing multiplier is ToInteger(12/spacing) (banker\'s): 8" → ×2, 24" → ×0, 9" → ×1', () => {
    const at = (fieldSp: number, perimSp?: number) =>
      buildEstimateInputs(
        bid({
          sections: [
            {
              ...section,
              uAdhesiveSpacingIn: fieldSp,
              ...(perimSp !== undefined ? { uAdhesiveSpacingPerimIn: perimSp } : {}),
            },
          ],
        }),
        withU,
      ).adhesiveWholeUnits?.["Duro-Grip Adhesive(CR-20)"];
    expect(at(8)).toBe(3); // 1.25 × ToInteger(1.5 → 2) = 2.5 → 3 (web's old 12/8 = 1.5 gave 1.875 → 2)
    expect(at(24)).toBe(0); // ToInteger(0.5) = 0 → no units
    expect(at(9)).toBe(2); // ToInteger(1.33) = 1 → 1.25 → 2
    // Field spacing 8" with a 12" perimeter spacing: the field zone doubles, perimeter ×1 —
    // with no enhancement band the whole area is field, so same as at(8).
    expect(at(8, 12)).toBe(3);
  });
});

describe("sectionMembraneDisplayPricing — the calc dialog can never disagree with the engine", () => {
  it("tab-sheet section: helper picks the SAME tab-tier price the engine bills (not roll goods)", () => {
    // The seeded combo shape: first sheet label is "Roll Good", real sheets follow.
    const tabCombo = {
      ...combo,
      sheet_size_multipliers: [
        { label: "Roll Good", roof_section: 4, underlayment: 4 },
        { label: "1500 sf", roof_section: 1, underlayment: 1 },
      ],
    };
    const withTabs: EngineAdminData = {
      ...admin,
      labor: { "Duro-Last|mechanical": buildLaborTables(tabCombo, deckOrder) },
      priceMatrix: {
        40: { rollGoods: { White: 1.23 }, tab28: { White: 1.35 }, tab60: { White: 1.28 } },
      },
      sheetTabSpacings: { 1: [28, 60, 120] },
    };
    // fieldLap 60 on a real sheet size → 60" Tabs tier ($1.28), the case the walkthrough caught
    const s = { ...bid().sections[0]!, fieldLap: 60 };
    const disp = sectionMembraneDisplayPricing(withTabs, "Duro-Last", "mechanical", s);
    expect(disp.tierLabel).toBe('60" Tabs');
    expect(disp.pricePerSqFt).toBe(1.28);
    const { inputs } = buildEstimateInputs(bid({ sections: [s] }), withTabs);
    // default section (no zones): engine membrane = withOverlap × the SAME price
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.28, 2);
  });

  it("roll-good sheet (no tab table): helper and engine both bill roll goods", () => {
    const s = bid().sections[0]!;
    const disp = sectionMembraneDisplayPricing(admin, "Duro-Last", "mechanical", s);
    expect(disp.tierLabel).toBe("Roll Goods");
    expect(disp.pricePerSqFt).toBe(1.23);
    const { inputs } = buildEstimateInputs(bid(), admin);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(MWO * 1.23, 2);
  });
});

describe("§20 install labor — legacy RoofSectionLaborHours details", () => {
  it("adhered sections bill AdhesiveCoverage hours/1000 sq ft × roll-width or sheet multiplier × complexity", () => {
    const adhesiveCombo = buildLaborTables(
      {
        roof_system: "Duro-Last",
        attachment: "adhesive",
        sheet_size_multipliers: [
          { label: "Roll Good", roof_section: 4, underlayment: 4 },
          { label: "500 sf", roof_section: 2.4, underlayment: 2.4 },
          { label: "1500 sf", roof_section: null as unknown as number, underlayment: 1 },
        ],
        thickness_multipliers: [{ mil: 40, multiplier: 1 }],
        adhesive: {
          base_hours_per_1000_sqft_by_substrate: [
            { substrate: "Water Based Adhesive", labor_per_1000_sqft: 5.215 },
            { substrate: "Duro-Grip Adhesive(CR-20)", labor_per_1000_sqft: "5.8408" },
          ],
        },
      },
      deckOrder,
    );
    expect(adhesiveCombo.adhesiveBaseHoursByName).toEqual({
      "Water Based Adhesive": 5.215,
      "Duro-Grip Adhesive(CR-20)": 5.8408,
    });
    expect(adhesiveCombo.sheetSizeMultiByLabel["1500 sf"]).toBeUndefined(); // blank cell
    const withAdhered: EngineAdminData = {
      ...admin,
      labor: { ...admin.labor, "Duro-Last|adhesive": adhesiveCombo },
      rollGoodWidthMulti: { 1: { 64: 1 } },
      adhesiveFlags: {
        "Water Based Adhesive": { shortName: "waterbasedadhesive", perimSpacingIn: -1 },
        "Duro-Grip Adhesive(CR-20)": { shortName: "durogrip", perimSpacingIn: 6 },
      },
      adhesivePrices: { "Water Based Adhesive": 122.1, "Duro-Grip Adhesive(CR-20)": 486.75 },
      membraneAdhesives: {
        1: {
          "Water Based Adhesive": {
            byDeckName: { Wood: 700 },
            underlaymentUniform: 700,
            wallCoverage: 350,
          },
          "Duro-Grip Adhesive(CR-20)": {
            byDeckName: { Wood: 700 },
            underlaymentUniform: 700,
            wallCoverage: 350,
          },
        },
      },
    };
    // Roll goods on a 64" roll: 5.215/1000 × RollGoodWidthAdhesiveMulti(64)=1 × complexity 1
    // over the whole MembraneWithOverlap (RollGoodsMembraneCalc, lap int 5; field share 1).
    const ROLL_64 = rollQty(5, 0.5);
    const roll = buildEstimateInputs(
      bid({
        attachment: "adhered",
        membraneAdhesiveName: "Water Based Adhesive",
        sections: [{ ...bid().sections[0]!, sheetSizeLabel: "Roll Good", fieldLap: 64 }],
      }),
      withAdhered,
    );
    expect(roll.warnings.filter((w) => /install labor|roll-goods/.test(w))).toEqual([]);
    expect(computeEstimate(roll.inputs).installHours).toBeCloseTo((5.215 / 1000) * ROLL_64, 6);
    // A sheet size uses SheetSize.SmartSheetMulti instead: 500 sf → ×2.4.
    const sheet = buildEstimateInputs(
      bid({
        attachment: "adhered",
        membraneAdhesiveName: "Water Based Adhesive",
        sections: [{ ...bid().sections[0]!, sheetSizeLabel: "500 sf", fieldLap: 64 }],
      }),
      withAdhered,
    );
    expect(computeEstimate(sheet.inputs).installHours).toBeCloseTo(
      (5.215 / 1000) * MWO_SHEET_500 * 2.4,
      6,
    );
    // Unknown roll width → ×1 with a warning; no adhesive labor row → 0 h with a warning.
    const oddWidth = buildEstimateInputs(
      bid({
        attachment: "adhered",
        membraneAdhesiveName: "Water Based Adhesive",
        sections: [{ ...bid().sections[0]!, sheetSizeLabel: "Roll Good", fieldLap: 60 }],
      }),
      withAdhered,
    );
    expect(oddWidth.warnings.some((w) => w.includes('60" roll width'))).toBe(true);
    expect(computeEstimate(oddWidth.inputs).installHours).toBeCloseTo((5.215 / 1000) * ROLL_64, 6);
    const noRow = buildEstimateInputs(
      bid({
        attachment: "adhered",
        membraneAdhesiveName: "Solvent Based Adhesive",
        sections: [{ ...bid().sections[0]!, sheetSizeLabel: "Roll Good", fieldLap: 64 }],
      }),
      withAdhered,
    );
    expect(noRow.warnings.some((w) => w.includes("No adhesive install labor"))).toBe(true);
    expect(computeEstimate(noRow.inputs).installHours).toBe(0);
    // Duro-Grip (durogrip + PerimeterSpacing 6): perimeter / corner rate × 1.2 (code constant).
    const grip = buildEstimateInputs(
      bid({
        attachment: "adhered",
        membraneAdhesiveName: "Duro-Grip Adhesive(CR-20)",
        sections: [
          {
            ...bid().sections[0]!,
            sheetSizeLabel: "Roll Good",
            fieldLap: 64,
            perimLengthFt: 200,
            enhancementWidthFt: 3, // 600 sf perimeter zone
          },
        ],
      }),
      withAdhered,
    );
    const rate = 5.8408 / 1000;
    const rollRatio = ROLL_64 / 2500;
    expect(computeEstimate(grip.inputs).installHours).toBeCloseTo(
      (1900 * rollRatio * rate + 600 * rollRatio * rate * 1.2) * 1,
      6,
    );
  });

  it("adhered sheet multiplier is keyed per ADHESIVE (legacy SSAdheredMulti); combo column is the fallback", () => {
    const adhesiveCombo = buildLaborTables(
      {
        roof_system: "Duro-Last",
        attachment: "adhesive",
        sheet_size_multipliers: [
          { label: "Roll Good", roof_section: 4, underlayment: 4 },
          { label: "500 sf", roof_section: 2.4, underlayment: 2.4 },
        ],
        thickness_multipliers: [{ mil: 40, multiplier: 1 }],
        adhesive: {
          base_hours_per_1000_sqft_by_substrate: [
            { substrate: "Water Based Adhesive", labor_per_1000_sqft: 5.215 },
            { substrate: "Solvent Based Adhesive", labor_per_1000_sqft: 6.95 },
          ],
        },
      },
      deckOrder,
    );
    const withPerAdhesive: EngineAdminData = {
      ...admin,
      labor: { ...admin.labor, "Duro-Last|adhesive": adhesiveCombo },
      rollGoodWidthMulti: { 1: { 64: 1 } },
      // Solvent Based on 500 sf carries its own (hypothetical) 3.0 row; Water Based has none.
      adheredSheetMulti: { 1: { "500 sf": { "Solvent Based Adhesive": 3 } } },
    };
    const sheet500 = (adhesive: string) =>
      buildEstimateInputs(
        bid({
          attachment: "adhered",
          membraneAdhesiveName: adhesive,
          sections: [{ ...bid().sections[0]!, sheetSizeLabel: "500 sf", fieldLap: 64 }],
        }),
        withPerAdhesive,
      );
    expect(computeEstimate(sheet500("Solvent Based Adhesive").inputs).installHours).toBeCloseTo(
      (6.95 / 1000) * MWO_SHEET_500 * 3,
      6,
    );
    expect(computeEstimate(sheet500("Water Based Adhesive").inputs).installHours).toBeCloseTo(
      (5.215 / 1000) * MWO_SHEET_500 * 2.4,
      6,
    );
  });

  it("hours per man-day is per estimate: bid.hoursPerDay overrides the admin default for man-days and quote days", () => {
    const base = buildEstimateInputs(bid(), admin);
    expect(base.inputs.hoursPerDay).toBe(admin.settings.hoursPerDay);
    const own = buildEstimateInputs(bid({ hoursPerDay: 10 }), admin);
    expect(own.inputs.hoursPerDay).toBe(10);
    // Man-days follow it: LS1 hours / hoursPerDay.
    const r = computeEstimate(own.inputs);
    expect(r.money.totalManDays).toBeCloseTo(r.laborSubtotal1Hours / 10, 1); // GoodSingle
    // A quote layer's labor in DAYS converts at the estimate's own figure.
    const quoted = buildEstimateInputs(
      bid({
        hoursPerDay: 10,
        sections: [
          {
            ...bid().sections[0]!,
            layers: [
              {
                board: "Flute Filler",
                attachment: "mechanical",
                fastenersPerBoard: 0,
                adhesiveName: "",
                substrate: "",
                quote: { name: "Q", lumpSum: 100, laborAmount: 2, laborInDays: true },
              },
            ],
          },
        ],
      }),
      admin,
    );
    expect(computeEstimate(quoted.inputs).underlaymentLaborHours).toBeCloseTo(20, 6);
    // 0 / absent falls back to the admin default.
    expect(buildEstimateInputs(bid({ hoursPerDay: 0 }), admin).inputs.hoursPerDay).toBe(
      admin.settings.hoursPerDay,
    );
  });

  it("perimeter / corner tab multiplier keys the custom zone lap, else legacy PerimeterLap = 0 → last (smallest) tab", () => {
    // Full Duro-Last mech_tab_multi set (28 → 1.5125, 60/64 → 1, 120 → 0.8).
    const full: EngineAdminData = {
      ...admin,
      labor: {
        ...admin.labor,
        "Duro-Last|mechanical": {
          ...admin.labor["Duro-Last|mechanical"]!,
          tabBands: [
            { key: 28, value: 1.5125 },
            { key: 60, value: 1 },
            { key: 64, value: 1 },
            { key: 120, value: 0.8 },
          ],
        },
      },
    };
    const zoned = {
      ...bid().sections[0]!,
      fieldLap: 60, // field at the 60" tab → ×1
      perimLengthFt: 200,
      enhancementWidthFt: 3, // 600 sf perimeter zone
      perimFastenerOc: 12, // OC 12 → ×1.1
    };
    const dflt = buildEstimateInputs(bid({ sections: [zoned] }), full);
    // field: 1900 × 10×1×1×1/2500; perim: 600 × 10×1×1.5125×1.1/2500 (PerimeterLap 0 → 28" tab)
    const fieldH = 1900 * MWO_RATIO * (10 / 2500);
    const perimDefault = 600 * MWO_RATIO * ((10 * 1.5125 * 1.1) / 2500);
    expect(computeEstimate(dflt.inputs).installHours).toBeCloseTo(fieldH + perimDefault, 6);
    // A custom perimeter lap (Advanced Roof Section Options) keys its own tab: 60 → ×1.
    const custom = buildEstimateInputs(bid({ sections: [{ ...zoned, perimLap: 60 }] }), full);
    const perimCustom = 600 * MWO_RATIO * ((10 * 1 * 1.1) / 2500);
    expect(computeEstimate(custom.inputs).installHours).toBeCloseTo(fieldH + perimCustom, 6);
  });
});

describe("§16 Roof Sections: per-section system / labor adjust / complexity / corner geometry", () => {
  const tuffAdmin: EngineAdminData = {
    ...admin,
    labor: { ...admin.labor, "Duro-Tuff|mechanical": admin.labor["Duro-Last|mechanical"]! },
    familyMembranePrices: { "Duro-Tuff": { "40": 1.23 } },
  };

  it("a section AdjustLabor % overrides the bid-level adjust for that section only", () => {
    const two = bid({
      adjustLaborPct: 50,
      sections: [bid().sections[0]!, { ...bid().sections[0]!, id: "s2", adjustLaborPct: 10 }],
    });
    const { inputs } = buildEstimateInputs(two, admin);
    expect(inputs.sections[0]!.adjustLaborPct).toBeUndefined();
    expect(inputs.sections[1]!.adjustLaborPct).toBeCloseTo(10, 9);
    const r = computeEstimate(inputs);
    expect(r.installHours).toBeCloseTo(INSTALL * 1.5 + INSTALL * 1.1, 6);
  });

  it("Duro-Tuff section on a ×1.0 sheet multiplies the RSComplexityFactor into labor + tear-off", () => {
    const withTearOff: EngineAdminData = {
      ...tuffAdmin,
      tearOff: {
        deckColumns: ["Wood"],
        tearoffTypes: ['BUR < 2"'],
        lookup: { Wood: { 'BUR < 2"': 2.4876 / 100 } },
      },
    };
    const heavy = bid({
      sections: [
        {
          ...bid().sections[0]!,
          roofSystem: "Duro-Tuff", // per-section override; the bid stays Duro-Last
          complexity: 4, // Heavy → 2.4
          tearOff: true,
          tearOffType: 'BUR < 2"',
        },
      ],
    });
    const { inputs, warnings } = buildEstimateInputs(heavy, withTearOff);
    expect(warnings).toEqual([]);
    const s0 = inputs.sections[0]!;
    expect(s0.complexity).toBe(2.4);
    expect(s0.laborTables).toBeDefined(); // the section's own combo, not the bid's
    expect(s0.tearOffSheetComplexityMulti).toBe(2.4);
    const r = computeEstimate(inputs);
    // Duro-Tuff membrane quantity = the 30" roll layout at the 28" lap: labor basis qty/2500.
    expect(r.installHours).toBeCloseTo(15.125 * (tuffQty(28) / 2500) * 2.4, 6);
    // TearOffBaseLabor = 2500 × 0.024876 × 1 × 2.4 = 149.256 → Round 3 → Ceiling to the cent
    expect(r.tearOffLaborHours).toBeCloseTo(149.26, 2);
    // Duro-Tuff flat membrane price applied (family price, no tab tiers) on the roll layout qty
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(tuffQty(28) * 1.23, 2);
  });

  it("complexity defaults to Moderate (×1) and is ignored on systems without RSComplexityFactor rows", () => {
    const { inputs: tuff } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, roofSystem: "Duro-Tuff" }] }),
      tuffAdmin,
    );
    expect(tuff.sections[0]!.complexity).toBe(1);
    const { inputs: dl } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, complexity: 5 }] }),
      admin,
    );
    expect(dl.sections[0]!.complexity).toBe(1);
    expect(dl.sections[0]!.laborTables).toBeUndefined();
    expect(sectionComplexityFactor(3, 5, 1)).toBe(4);
    expect(sectionComplexityFactor(3, 5, 0.98)).toBe(1); // non-1.0 sheet → "None"
    expect(roofSystemHasComplexity("Duro-Fleece")).toBe(true);
    expect(roofSystemHasComplexity("Duro-Last")).toBe(false);
  });

  it("warns when a section's own system / attachment has no labor table", () => {
    const { warnings } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, roofSystem: "Duro-Roof" }] }),
      admin,
    );
    expect(
      warnings.some((w) =>
        w.includes('No labor table for Duro-Roof / mechanical — section "Main"'),
      ),
    ).toBe(true);
  });

  it("marked corners carve corner squares out of the perimeter runs (legacy _230 geometry)", () => {
    const mkEdge = (side: string, lengthFt: number) => ({
      side,
      lengthFt,
      isPerimeter: true,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    });
    const { inputs } = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            enhancementWidthFt: 3,
            edges: [mkEdge("A", 50), mkEdge("B", 50), mkEdge("C", 50), mkEdge("D", 50)],
            perimCorners: [true, true, true, true],
          },
        ],
      }),
      admin,
    );
    const s0 = inputs.sections[0]!;
    // each side 50 − 3 − 3 = 44 → 176 ft × 3 = 528 sf; corners 4 × 3 ft × 3 ft = 36 sf
    // (labor areas = share × MembraneWithOverlap, §20.1)
    expect(s0.perimArea).toBeCloseTo(528 * MWO_RATIO, 6);
    expect(s0.cornerArea).toBeCloseTo(36 * MWO_RATIO, 6);
    expect(s0.fieldArea).toBeCloseTo((2500 - 528 - 36) * MWO_RATIO, 6);
  });

  it("non-quick-bid sections derive the average sheet from the area (RoofSection.get_SheetSize)", () => {
    const labels = ["Roll Good", "500 sf", "1000 sf", "1500 sf", "2000 sf", "2500 sf", "3000 sf"];
    expect(derivedSheetSizeLabel(2400, labels)).toBe("2500 sf"); // next size up
    expect(derivedSheetSizeLabel(2000, labels)).toBe("2000 sf"); // exact
    expect(derivedSheetSizeLabel(50, labels)).toBe("Roll Good"); // within the first size
    expect(derivedSheetSizeLabel(5000, labels)).toBe("3000 sf"); // beyond the largest
    expect(
      resolveSectionSheetLabel(
        { ...bid().sections[0]!, isQuickBid: false, length: 60, width: 40 },
        labels,
      ),
    ).toBe("2500 sf");
    expect(resolveSectionSheetLabel({ ...bid().sections[0]!, length: 60, width: 40 }, labels)).toBe(
      "1500 sf",
    );
  });

  it("perimeter width calculator: min(0.4 × height, 0.1 × lesser dim), ceiling, floor 5", () => {
    expect(perimeterEnhancementCalculator(20, 100)).toBe(8);
    expect(perimeterEnhancementCalculator(5, 100)).toBe(5);
    expect(perimeterEnhancementCalculator(30, 300)).toBe(12);
    expect(perimeterEnhancementCalculator(31, 300)).toBe(13); // 12.4 → ceiling 13
  });
});

describe("§17 Home: per-bid sales tax overrides the company settings", () => {
  it("bid salesTaxRate / taxMaterialOnly reach the money chain; absent = admin settings", () => {
    const def = buildEstimateInputs(bid({ taxExempt: false }), admin).inputs;
    expect(def.salesTax).toBe(0.0625);
    expect(def.taxMaterialOnly).toBe(true);
    const over = buildEstimateInputs(
      bid({ taxExempt: false, salesTaxRate: 0.07, taxMaterialOnly: false }),
      admin,
    ).inputs;
    expect(over.salesTax).toBe(0.07);
    expect(over.taxMaterialOnly).toBe(false);
    // tax exempt still zeroes the charge whatever the rate
    const r = computeEstimate(
      buildEstimateInputs(bid({ taxExempt: true, salesTaxRate: 0.07 }), admin).inputs,
    );
    expect(r.money.salesTaxValue).toBe(0);
  });
});

describe("a bid with no roof sections", () => {
  it("builds and totals $0 with no warnings (the estimator starts empty)", () => {
    const { inputs, warnings } = buildEstimateInputs(bid({ sections: [] }), admin);
    expect(warnings).toEqual([]);
    const r = computeEstimate(inputs);
    expect(r.roofSqFootage).toBe(0);
    expect(r.installHours).toBe(0);
    expect(r.money.grandTotal).toBe(0);
  });
});

describe("§18 underlayment labor — legacy UnderlaymentBaseHours rules", () => {
  const mechLayer = (board: string): UnderlaymentLayer => ({
    board,
    attachment: "mechanical",
    fastenersPerBoard: 0,
    adhesiveName: "",
    substrate: "",
  });
  const uAdmin: EngineAdminData = {
    ...admin,
    labor: { ...admin.labor, "Duro-Last|adhesive": admin.labor["Duro-Last|mechanical"]! },
    underlaymentPrices: { '1/2" ISO': 0.85, "Duro-Fold": 0.3, "1\" ISO 4'x4'": 0.9 },
    underlaymentLabor: {
      layoutHoursByProduct: { '1/2" ISO': 7.775, "Duro-Fold": 6.9, "1\" ISO 4'x4'": 8 },
      fastenerCounts: [5],
      fastenerMinutesByDeck: { Wood: 0.342 },
    },
    underlaymentGroups: {
      groups: [],
      groupIdByBoard: { "Duro-Fold": 1, '1/2" ISO': 2, "1\" ISO 4'x4'": 7 },
      needQuoteByBoard: {},
      adhesiveGroupIdByBoard: { '1/2" ISO': 2 },
      adhesiveGroupNameById: { 2: "ISO 4'x8'" },
    },
    adhesiveTimes: {
      adhesives: ["Duro-Grip Adhesive(CR-20)"],
      bySubstrate: {
        "Duro-Grip Adhesive(CR-20)": {
          Wood: { coverageSqFt: 2000, labor: 5 },
          "ISO 4'x8'": { coverageSqFt: 1000, labor: 6.5 },
        },
      },
    },
    adhesivePrices: { "Duro-Grip Adhesive(CR-20)": 899 },
  };
  const perimSection = () => ({
    ...bid().sections[0]!,
    enhancementWidthFt: 3,
    edges: [
      {
        side: "A",
        lengthFt: 50,
        isPerimeter: true,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
      {
        side: "B",
        lengthFt: 50,
        isPerimeter: false,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
      {
        side: "C",
        lengthFt: 50,
        isPerimeter: true,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
      {
        side: "D",
        lengthFt: 50,
        isPerimeter: false,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
    ],
    perimCorners: [false, false, false, false] as [boolean, boolean, boolean, boolean],
  });
  const uHours = (b: BidInput) =>
    computeEstimate(buildEstimateInputs(b, uAdmin).inputs).underlaymentLaborHours;

  it("fastener count follows the board tile and the MEMBRANE attachment (5 → 10/16 per board)", () => {
    // field 2200 sf, perimeter 300 sf (two 50-ft perimeter sides × 3 ft), no corners
    const mech = uHours(
      bid({ sections: [{ ...perimSection(), layers: [mechLayer('1/2" ISO')] }] }),
    );
    // Round(2200/32)=69×5 + Round(300/32)=9×5 = 390 → 7.775 + 0.342/60×390
    expect(mech).toBeCloseTo(7.775 + (0.342 / 60) * 390, 6);
    const adhered = uHours(
      bid({
        attachment: "adhered",
        sections: [{ ...perimSection(), layers: [mechLayer('1/2" ISO')] }],
      }),
    );
    // adhered membrane: 69×10 + 9×16 = 834 fasteners
    expect(adhered).toBeCloseTo(7.775 + (0.342 / 60) * 834, 6);
  });

  it("slip sheets (SubType 1) use 0.08 / sq ft; 4'×4' tiles use 4 per 16 sq ft", () => {
    const slip = uHours(
      bid({ sections: [{ ...bid().sections[0]!, layers: [mechLayer("Duro-Fold")] }] }),
    );
    expect(slip).toBeCloseTo(6.9 + (0.342 / 60) * Math.round(Math.ceil(2500 * 0.08)), 6); // 200
    const four = uHours(
      bid({ sections: [{ ...bid().sections[0]!, layers: [mechLayer("1\" ISO 4'x4'")] }] }),
    );
    // Round(2500/16) = 156 × 4 = 624 (banker's: 156.25 → 156)
    expect(four).toBeCloseTo(8 + (0.342 / 60) * 624, 6);
  });

  it("§22.9 per-bid underlayment $/sqft override replaces the admin price (SmartValue: custom > 0)", () => {
    const layers = [mechLayer('1/2" ISO')];
    const base = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, layers }] }),
      uAdmin,
    );
    expect(base.inputs.materialUnderlayment).toBeCloseTo(2500 * 1.03 * 0.85, 2);
    const over = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, layers }],
        underlaymentPriceOverrides: { '1/2" ISO': 1.1, "Duro-Fold": 0 },
      }),
      uAdmin,
    );
    expect(over.inputs.materialUnderlayment).toBeCloseTo(2500 * 1.03 * 1.1, 2);
    // A 0 override means "admin price" for that board.
    const zero = buildEstimateInputs(
      bid({
        sections: [{ ...bid().sections[0]!, layers }],
        underlaymentPriceOverrides: { '1/2" ISO': 0 },
      }),
      uAdmin,
    );
    expect(zero.inputs.materialUnderlayment).toBeCloseTo(2500 * 1.03 * 0.85, 2);
  });

  it("§22.1 Slip Sheets (tile 1) material is DURO-LAST material (dMaterial[6] inside M0), not Underlayment", () => {
    const r = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, layers: [mechLayer("Duro-Fold")] }] }),
      uAdmin,
    );
    // 2500 × 1.03 × $0.30 = $772.50 slip sheet
    expect(r.slipSheetMaterial).toBeCloseTo(772.5, 2);
    expect(r.inputs.materialUnderlayment).toBe(0);
    expect(r.inputs.duroLastMaterial).toBeCloseTo(MWO * 1.23 + 772.5, 1);
    const est = computeEstimate(r.inputs);
    expect(est.money.dTotals[6]).toBe(0);
    // …and it is inside the 5% prepay base.
    const prepay = computeEstimate({ ...r.inputs, prepayDiscount: true }).money.dTotals[1]!;
    expect(prepay).toBeCloseTo(-Math.round((MWO * 1.23 + 772.5) * 0.05 * 100) / 100, 0);
    // A tile-2 board stays in Underlayment (dTotals[6]).
    const iso = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, layers: [mechLayer('1/2" ISO')] }] }),
      uAdmin,
    );
    expect(iso.slipSheetMaterial).toBe(0);
    expect(iso.inputs.materialUnderlayment).toBeCloseTo(2500 * 1.03 * 0.85, 2);
  });

  it("adhered layers: substrate derived from the deck / layer below; labor per 2500 on field+perim", () => {
    const layers: UnderlaymentLayer[] = [
      {
        board: '1/2" ISO',
        attachment: "adhesive",
        fastenersPerBoard: 0,
        adhesiveName: "Duro-Grip Adhesive(CR-20)",
        substrate: "",
      },
      {
        board: "Duro-Fold",
        attachment: "adhesive",
        fastenersPerBoard: 0,
        adhesiveName: "Duro-Grip Adhesive(CR-20)",
        substrate: "",
      },
    ];
    const { inputs, warnings, adhesiveWholeUnits } = buildEstimateInputs(
      bid({ sections: [{ ...perimSection(), layers }] }),
      uAdmin,
    );
    expect(warnings).toEqual([]);
    // layer 1 on the Wood deck: labor 5 → (2200+300) × 5/2500 = 5 h; layer 2 over 1/2" ISO
    // (group 2 → "ISO 4'x8'"): 2500 × 6.5/2500 = 6.5 h; plus both layout times
    expect(computeEstimate(inputs).underlaymentLaborHours).toBeCloseTo(7.775 + 5 + 6.9 + 6.5, 6);
    // units: 2500/2000 + 2500/1000 = 3.75 → 4 whole units
    expect(adhesiveWholeUnits?.["Duro-Grip Adhesive(CR-20)"]).toBe(4);
  });

  it("section base hours × complexity × sheet multiplier; per-section adjust overrides the template; quotes unscaled", () => {
    const tuff: EngineAdminData = {
      ...uAdmin,
      labor: { ...uAdmin.labor, "Duro-Tuff|mechanical": uAdmin.labor["Duro-Last|mechanical"]! },
      familyMembranePrices: { "Duro-Tuff": { "40": 1.23 } },
    };
    const heavy = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            roofSystem: "Duro-Tuff",
            complexity: 4,
            layers: [mechLayer('1/2" ISO')],
          },
        ],
      }),
      tuff,
    );
    expect(computeEstimate(heavy.inputs).underlaymentLaborHours).toBeCloseTo(9.998 * 2.4, 3);
    const adjusted = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            adjustUnderlaymentLaborPct: 10,
            layers: [
              mechLayer('1/2" ISO'),
              {
                board: "Flute Filler",
                attachment: "mechanical",
                fastenersPerBoard: 0,
                adhesiveName: "",
                substrate: "",
                quote: { name: "Q", lumpSum: 100, laborAmount: 2 },
              },
            ],
          },
        ],
      }),
      uAdmin,
    );
    // priced 9.998 × 1.10 + quote 2 h (never adjusted)
    expect(computeEstimate(adjusted.inputs).underlaymentLaborHours).toBeCloseTo(9.998 * 1.1 + 2, 3);
  });

  it("attachment None bills layout time only", () => {
    const h = uHours(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            layers: [
              {
                board: '1/2" ISO',
                attachment: "none",
                fastenersPerBoard: 0,
                adhesiveName: "",
                substrate: "",
              },
            ],
          },
        ],
      }),
    );
    expect(h).toBeCloseTo(7.775, 6);
  });
});

describe("§22.9 strippingBySection — roll-goods $/sqft per foot, Duro-Tuff family price, deck multiplier", () => {
  it("Duro-Last section → rollGoods price for its mil/colour; Duro-Tuff → family price; part key per (system, colour, mil)", () => {
    const withTuff: EngineAdminData = {
      ...admin,
      familyMembranePrices: { "Duro-Tuff": { "50": 1.9 } },
    };
    const b = bid({
      sections: [
        bid().sections[0]!,
        { ...bid().sections[0]!, id: "t", name: "T", roofSystem: "Duro-Tuff", thickness: 50 },
      ],
    });
    const r = strippingBySection(b, withTuff);
    expect(r["s1"]!.pricePerFt).toBe(1.23); // the fixture's 40mil White roll-goods price
    expect(r["s1"]!.partKey).toBe("baswf1|White|40");
    expect(r["t"]!.pricePerFt).toBe(1.9);
    expect(r["t"]!.partKey).toBe("baswf3|White|50");
    expect(r["s1"]!.deckMulti).toBeGreaterThan(0);
  });
});

describe("Check Pull (FieldLap = 0 — no lap qualifies for the pull test)", () => {
  it("keeps every estimate figure finite while the lap is unset", () => {
    const { inputs } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, fieldLap: 0 }] }),
      admin,
    );
    const r = computeEstimate(inputs);
    const numbers = Object.entries(r).filter(([, v]) => typeof v === "number");
    expect(numbers.length).toBeGreaterThan(10);
    for (const [k, v] of numbers) expect(Number.isFinite(v), k).toBe(true);
    expect(inputs.sections[0]!.membraneWithOverlap).toBeGreaterThan(0);
  });
});

describe("Duro-Bond mechanical section labor — legacy DuroBondSystem model (docs §22.14)", () => {
  // Owner's sections comparison (2026-09-21): Duro-Bond 50 mil White, 1000 sf sheet, pull test
  // 425 / DT 60 → 6 / 8 / 10 plates per 4×8 board, quick bid, no perimeter edges.
  const dbCombo: LaborCombo = {
    roof_system: "Duro-Bond",
    attachment: "mechanical",
    sheet_size_multipliers: [
      { label: "500 sf", roof_section: 2, underlayment: 2.4 },
      { label: "1000 sf", roof_section: 1.1, underlayment: 1.2 },
      { label: "1500 sf", roof_section: 1, underlayment: 1 },
      { label: "2000 sf", roof_section: 1.1, underlayment: 0.98 },
      { label: "2500 sf", roof_section: 1.2, underlayment: 0.9 },
    ],
    thickness_multipliers: [
      { mil: 40, multiplier: 1 },
      { mil: 50, multiplier: 1.15 },
      { mil: 60, multiplier: 1.25 },
    ],
    duro_bond_base_labor: {
      sheet_layout_hr: 10,
      single_fastener_time_min_per_fastener_by_deck: {
        Wood: 0.342,
        Steel: 0.462,
        Retrofit: 0.462,
        Concrete: 2.185,
        "LWC/Steel": 0.858,
        "LWC/Concrete": 2.185,
        Purlin: 0.462,
      },
    },
  };
  const dbAdmin: EngineAdminData = {
    ...admin,
    labor: { ...admin.labor, "Duro-Bond|mechanical": buildLaborTables(dbCombo, deckOrder) },
  };
  const dbSection = (over: Partial<BidSectionInput>): BidSectionInput => ({
    ...bid().sections[0]!,
    thickness: 50,
    sheetSizeLabel: "1000 sf",
    fieldLap: 60,
    designTable: 60,
    pullTest: 425,
    fastenerOc: 6,
    perimFastenerOc: 8,
    cornerFastenerOc: 10,
    ...over,
  });
  it("Section A 188×182 Metal Retrofit → 233.59 h; Section B 164×111.5 Structural Metal → 124.89 h (100 %)", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Bond",
        sections: [
          dbSection({ id: "A", name: "A", length: 188, width: 182, deckType: "Retrofit" }),
          dbSection({ id: "B", name: "B", length: 164, width: 111.5, deckType: "Steel" }),
        ],
      }),
      dbAdmin,
    );
    const [a, b] = inputs.sections;
    expect(a!.duroBond?.fastenerCount).toBe(6416); // Round(34216/32 × 6)
    const hA = computeSectionInstallHours(a!, inputs.admin, inputs.formulasVersion, 0);
    const hB = computeSectionInstallHours(b!, inputs.admin, inputs.formulasVersion, 0);
    // Legacy screens: A 233.59 h (Man Hours 383.46 − B 149.87), B 149.87 h at 120 % = 124.89 h.
    expect(hA).toBeCloseTo(233.59, 1);
    expect(hB).toBeCloseTo(124.89, 1);
    // The per-section AdjustLabor wraps the model (B was at 120 % on the legacy screen).
    expect(
      computeSectionInstallHours(
        { ...b!, adjustLaborPct: 20 },
        inputs.admin,
        inputs.formulasVersion,
        0,
      ),
    ).toBeCloseTo(149.87, 1);
  });
});

describe("Duro-Tuff mechanical perimeter — row-based labor tiers (docs §22.15)", () => {
  // Duro-Tuff|mechanical combo: base tab 30" ×2.8 (mech_tab_multi 30 → 2.8, 60 → 1.4, 120 →
  // 0.95), on-centre 18 → 1.0 / 9 → 1.21, wood ×1, one ×1.0 sheet.
  const tuffCombo: LaborCombo = {
    roof_system: "Duro-Tuff",
    attachment: "mechanical",
    base: { tab_value: 30, tab_multiplier: 2.8 },
    deck_multipliers: { Wood: 1, Steel: 1.064 },
    fastener_spacing_multipliers: [
      { spacing_in: 18, multiplier: 1 },
      { spacing_in: 12, multiplier: 1.1 },
      { spacing_in: 9, multiplier: 1.21 },
      { spacing_in: 6, multiplier: 1.41 },
    ],
    sheet_size_multipliers: [{ label: "1500 sf", roof_section: 1, underlayment: 1 }],
    thickness_multipliers: [{ mil: 40, multiplier: 1 }],
  };
  const tuffTables = {
    ...buildLaborTables(tuffCombo, deckOrder),
    tabBands: [
      { key: 30, value: 2.8 },
      { key: 60, value: 1.4 },
      { key: 120, value: 0.95 },
    ],
  };
  const tAdmin: EngineAdminData = {
    ...admin,
    labor: { ...admin.labor, "Duro-Tuff|mechanical": tuffTables },
    familyMembranePrices: { "Duro-Tuff": { "40": 1.23 } },
    rollGoodWidthMulti: { 3: { 30: 2.6, 60: 1.3, 120: 1 } },
  };
  // MechFastenerLookup rows for roof system 3 (DT 60, any thickness): 30" rows fasten the
  // perimeter at 18" o.c. from a 350 lb pull; 60" rows at 9" o.c. from 425 lb; corners never.
  const lookup = [
    {
      roofSystemId: 3,
      membraneThickness: -1,
      designTable: 60,
      tabSpacing: 30,
      pullTest: 350,
      fieldSpacing: 18,
      perimSpacing: 18,
      cornerSpacing: -1,
    },
    {
      roofSystemId: 3,
      membraneThickness: -1,
      designTable: 60,
      tabSpacing: 60,
      pullTest: 350,
      fieldSpacing: 15,
      perimSpacing: 9,
      cornerSpacing: -1,
    },
    {
      roofSystemId: 3,
      membraneThickness: -1,
      designTable: 60,
      tabSpacing: 60,
      pullTest: 425,
      fieldSpacing: 18,
      perimSpacing: 9,
      cornerSpacing: -1,
    },
  ];
  const section = (): BidSectionInput => ({
    ...bid().sections[0]!,
    roofSystem: "Duro-Tuff",
    fieldLap: 60,
    designTable: 60,
    pullTest: 425,
    fastenerOc: 18,
    perimFastenerOc: 18,
    cornerFastenerOc: 18,
    enhancementWidthFt: 5,
    edges: [
      {
        side: "A",
        lengthFt: 50,
        isPerimeter: true,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
      {
        side: "B",
        lengthFt: 50,
        isPerimeter: false,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
      {
        side: "C",
        lengthFt: 50,
        isPerimeter: false,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
      {
        side: "D",
        lengthFt: 50,
        isPerimeter: false,
        termination: "No Termination",
        blockingFt: 0,
        arpSizeIn: 0,
      },
    ],
    isQuickBid: false,
  });
  it('bills 1 outer 30\\" row + 2 inner 60\\" rows along the 50 ft perimeter at their own tab / spacing rates', () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({ roofSystem: "Duro-Tuff", sections: [section()], fastenerLookup: lookup }),
      tAdmin,
    );
    expect(warnings.filter((w) => w.includes("Duro-Tuff perimeter rows"))).toEqual([]);
    const s0 = inputs.sections[0]!;
    expect(s0.duroTuffMech).toBeDefined();
    const dt = s0.duroTuffMech!;
    expect(dt.perimTotalLengthFt).toBe(50);
    expect(dt.cornerTotalLengthFt).toBe(0);
    // BA default rows (1, 2) at 30" / 60"; tier spacings keyed by row width from the lookup.
    expect(dt.tiers.map((t) => [t.rows, t.lapIn, t.perimOc])).toEqual([
      [1, 30, 18],
      [2, 60, 9],
    ]);
    const M = s0.membraneWithOverlap;
    const f = (10 * 1 * 1.4 * 1) / 2500; // field: tab 60 → 1.4, 18" o.c. → 1
    const p0 = (10 * 1 * 2.8 * 1) / 2500; // tier 0: tab 30 → 2.8, 18" o.c.
    const p1 = (10 * 1 * 1.4 * 1.21) / 2500; // tier 1: tab 60 → 1.4, 9" o.c. → 1.21
    const a0 = 1 * 2.5 * 50; // 1 row × In2Ft(30) × 50 ft
    const a1 = 2 * 5 * 50; // 2 rows × In2Ft(60) × 50 ft
    const expected = f * (M - a0 - a1) + p0 * a0 + p1 * a1;
    expect(computeSectionInstallHours(s0, inputs.admin, inputs.formulasVersion, 0)).toBeCloseTo(
      expected,
      6,
    );
    expect(expected).toBeGreaterThan(0);
  });
  it("without the lookup rows the stored spacing is used and a warning says so", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({ roofSystem: "Duro-Tuff", sections: [section()] }),
      tAdmin,
    );
    expect(warnings.some((w) => w.includes("Duro-Tuff perimeter rows"))).toBe(true);
    expect(inputs.sections[0]!.duroTuffMech!.tiers.map((t) => t.perimOc)).toEqual([18, 18]);
  });
  it("a section without perimeter edges reduces to field rate × MembraneWithOverlap (unchanged)", () => {
    const plain = { ...section(), edges: [], isQuickBid: true };
    const { inputs } = buildEstimateInputs(
      bid({ roofSystem: "Duro-Tuff", sections: [plain], fastenerLookup: lookup }),
      tAdmin,
    );
    const s0 = inputs.sections[0]!;
    const f = (10 * 1 * 1.4 * 1) / 2500;
    expect(computeSectionInstallHours(s0, inputs.admin, inputs.formulasVersion, 0)).toBeCloseTo(
      f * s0.membraneWithOverlap,
      6,
    );
  });
});

describe("Duro-Tuff custom settings — the Advanced form's DT group (docs §22.15)", () => {
  const tuffCombo: LaborCombo = {
    roof_system: "Duro-Tuff",
    attachment: "mechanical",
    base: { tab_value: 30, tab_multiplier: 2.8 },
    deck_multipliers: { Wood: 1 },
    fastener_spacing_multipliers: [
      { spacing_in: 18, multiplier: 1 },
      { spacing_in: 12, multiplier: 1.1 },
      { spacing_in: 6, multiplier: 1.41 },
    ],
    sheet_size_multipliers: [{ label: "1500 sf", roof_section: 1, underlayment: 1 }],
    thickness_multipliers: [{ mil: 40, multiplier: 1 }],
  };
  const tAdmin: EngineAdminData = {
    ...admin,
    labor: {
      ...admin.labor,
      "Duro-Tuff|mechanical": {
        ...buildLaborTables(tuffCombo, deckOrder),
        tabBands: [
          { key: 30, value: 2.8 },
          { key: 60, value: 1.4 },
          { key: 120, value: 0.95 },
        ],
      },
    },
    familyMembranePrices: { "Duro-Tuff": { "40": 1.23 } },
    rollGoodWidthMulti: { 3: { 30: 2.6, 60: 1.3, 120: 1 } },
  };
  const edgesA = [
    {
      side: "A",
      lengthFt: 50,
      isPerimeter: true,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    },
    {
      side: "B",
      lengthFt: 50,
      isPerimeter: false,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    },
    {
      side: "C",
      lengthFt: 50,
      isPerimeter: false,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    },
    {
      side: "D",
      lengthFt: 50,
      isPerimeter: false,
      termination: "No Termination",
      blockingFt: 0,
      arpSizeIn: 0,
    },
  ];
  it("rows / per-tier spacings / field width & spacing flow into the calc and the labor tiers", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Tuff",
        sections: [
          {
            ...bid().sections[0]!,
            roofSystem: "Duro-Tuff",
            fieldLap: 60,
            fastenerOc: 18,
            perimFastenerOc: 18,
            cornerFastenerOc: 18,
            enhancementWidthFt: 5,
            edges: edgesA,
            isQuickBid: false,
            tuffCustom: {
              rows: [2, 1],
              perimOc: [12, 6],
              cornerOc: [6, 12],
              fieldLapIn: 120,
              fieldOc: 12,
            },
          },
        ],
      }),
      tAdmin,
    );
    const s0 = inputs.sections[0]!;
    // Rows and the fixed 30" / 60" widths reach the calc; the custom field width re-keys the field.
    expect(
      s0.duroTuffMech!.tiers.map((t) => [t.rows, t.lapIn, t.cornerLapIn, t.perimOc, t.cornerOc]),
    ).toEqual([
      [2, 30, 30, 12, 6],
      [1, 60, 60, 6, 12],
    ]);
    expect(s0.fieldLap).toBe(120);
    expect(s0.customFieldFastenerSpacing).toBe(12);
    const M = s0.membraneWithOverlap;
    const f = (10 * 1 * 0.95 * 1.1) / 2500; // field: tab 120 → 0.95, 12" → 1.1
    const a0 = 2 * 2.5 * 50;
    const a1 = 1 * 5 * 50;
    const p0 = (10 * 1 * 2.8 * 1.1) / 2500; // tier 0 perim: tab 30, 12"
    const p1 = (10 * 1 * 1.4 * 1.41) / 2500; // tier 1 perim: tab 60, 6"
    const expected = f * (M - a0 - a1) + p0 * a0 + p1 * a1; // no corner footage
    expect(computeSectionInstallHours(s0, inputs.admin, inputs.formulasVersion, 0)).toBeCloseTo(
      expected,
      6,
    );
  });
});

describe("Underlayment on a Duro-Bond bid — 'Section Fastened w/ Durobond' (docs §22.17)", () => {
  const dbCombo: LaborCombo = {
    roof_system: "Duro-Bond",
    attachment: "mechanical",
    sheet_size_multipliers: [
      { label: "1000 sf", roof_section: 1.1, underlayment: 1.2 },
      { label: "1500 sf", roof_section: 1, underlayment: 1 },
    ],
    thickness_multipliers: [{ mil: 50, multiplier: 1.15 }],
    duro_bond_base_labor: {
      sheet_layout_hr: 10,
      single_fastener_time_min_per_fastener_by_deck: { Retrofit: 0.462, Steel: 0.462 },
    },
  };
  const uAdmin: EngineAdminData = {
    ...admin,
    labor: { ...admin.labor, "Duro-Bond|mechanical": buildLaborTables(dbCombo, deckOrder) },
    underlaymentPrices: { '1/2" ISO': 0.85, '2 1/2" ISO': 1.6 },
    underlaymentLabor: {
      layoutHoursByProduct: { '1/2" ISO': 7.775, '2 1/2" ISO': 11.775 },
      fastenerCounts: [5],
      fastenerMinutesByDeck: { "Metal Retrofit": 0.462, Steel: 0.462 },
    },
  };
  const section = (over: Partial<BidSectionInput>): BidSectionInput => ({
    ...bid().sections[0]!,
    thickness: 50,
    sheetSizeLabel: "1000 sf",
    fieldLap: 60,
    designTable: 60,
    pullTest: 425,
    fastenerOc: 6,
    perimFastenerOc: 8,
    cornerFastenerOc: 10,
    ...over,
  });
  it('Knox County: A ½\\" ISO 117.05 h, B 2 × 2½\\" ISO 189.48 h — layout × 1.1, no fastening term', () => {
    const { inputs } = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Bond",
        sections: [
          section({
            id: "A",
            name: "A",
            length: 188,
            width: 182,
            deckType: "Retrofit",
            layers: [
              {
                board: '1/2" ISO',
                attachment: "durobond",
                adhesiveName: "",
                fastenersPerBoard: 0,
                substrate: "",
              },
            ],
          }),
          section({
            id: "B",
            name: "B",
            length: 164,
            width: 111.5,
            deckType: "Steel",
            layers: [
              {
                board: '2 1/2" ISO',
                attachment: "durobond",
                adhesiveName: "",
                fastenersPerBoard: 0,
                substrate: "",
              },
              {
                board: '2 1/2" ISO',
                attachment: "durobond",
                adhesiveName: "",
                fastenersPerBoard: 0,
                substrate: "",
              },
            ],
          }),
        ],
      }),
      uAdmin,
    );
    // Legacy Underlayment screen: A "Adjustable Labor 117.05 h", 4x8 ISO review line 306.53 h.
    expect(inputs.underlaymentLaborHours).toBeCloseTo(117.05 + 189.48, 1);
    expect((34216 / 2500) * 7.775 * 1.1).toBeCloseTo(117.05, 2);
  });
  it("a Duro-Bond layer stored as Mechanically Fastened is still priced layout-only — legacy LoadAttachment disables the combo (§22.28)", () => {
    const { inputs } = buildEstimateInputs(
      bid({
        roofSystem: "Duro-Bond",
        sections: [
          section({
            id: "A",
            length: 188,
            width: 182,
            deckType: "Retrofit",
            layers: [
              {
                board: '1/2" ISO',
                attachment: "mechanical",
                adhesiveName: "",
                fastenersPerBoard: 0,
                substrate: "",
              },
            ],
          }),
        ],
      }),
      uAdmin,
    );
    // Knox County CTC Test 2: the stored "mechanical" layers billed 5 screws per 4×8 board on Metal
    // Retrofit (0.462 min each) — ≈69.5 h / $3.1K over the legacy Review's 4x8 ISO line.
    expect(inputs.underlaymentLaborHours).toBeCloseTo(117.05, 1);
  });
});

describe("Duro-Tech TPO — the web's sixth roof system (docs §22.34)", () => {
  // Owner's guide values: 27 h / 2,500 sq ft base, Wood ×1, complexity Moderate 1.25, 45 mil ×1.
  const tpoCombo: LaborCombo = {
    roof_system: "Duro-Tech TPO",
    attachment: "mechanical",
    base: { tab_value: 120, tab_multiplier: 1 },
    base_hours_per_2500: 27,
    deck_multipliers: { Wood: 1, Steel: 1.05, Concrete: 1.325 },
    fastener_spacing_multipliers: [
      { spacing_in: 18, multiplier: 1 },
      { spacing_in: 12, multiplier: 1.1 },
    ],
    thickness_multipliers: [
      { mil: 45, multiplier: 1 },
      { mil: 60, multiplier: 1 },
      { mil: 80, multiplier: 1.075 },
    ],
  };
  const tpoAdmin: EngineAdminData = {
    ...admin,
    labor: { ...admin.labor, "Duro-Tech TPO|mechanical": buildLaborTables(tpoCombo, deckOrder) },
    familyMembranePrices: { "Duro-Tech TPO": { "45": 0.75, "60": 0.84, "80": 1.3 } },
    rollGoodWidthMulti: { 6: { 30: 2.6, 60: 1.3, 120: 1 } },
  };
  const tpoBid = (thickness: number) =>
    bid({
      roofSystem: "Duro-Tech TPO",
      sections: [{ ...bid().sections[0]!, thickness, fieldLap: 120, fastenerOc: 18 }],
    });
  // Roll goods at a 10 ft roll with the 6" side lap: 2601 + Ceil(51/10 × 51) × 0.5 = 2731.5 sq ft.
  const TPO_MWO = rollQty(10, 0.5);

  it("prices the membrane from the flat family table ($/sq ft by mil) on the roll-goods quantity", () => {
    const { inputs } = buildEstimateInputs(tpoBid(45), tpoAdmin);
    expect(inputs.sections[0]!.membraneWithOverlap).toBeCloseTo(TPO_MWO, 6);
    expect(inputs.duroLastMaterial).toBeCloseTo(TPO_MWO * 0.75, 2);
    expect(buildEstimateInputs(tpoBid(80), tpoAdmin).inputs.duroLastMaterial).toBeCloseTo(
      TPO_MWO * 1.3,
      2,
    );
    expect(
      sectionMembraneDisplayPricing(
        tpoAdmin,
        "Duro-Tech TPO",
        "mechanical",
        tpoBid(60).sections[0]!,
      ),
    ).toEqual({
      pricePerSqFt: 0.84,
      tierLabel: "Duro-Tech TPO flat price",
    });
  });

  it("prices the section's colour when the row carries it, else the family figure", () => {
    const byColor: EngineAdminData = {
      ...tpoAdmin,
      familyMembranePricesByColor: { "Duro-Tech TPO": { "60": { White: 0.84, Tan: 0.9 } } },
    };
    const tan = bid({
      roofSystem: "Duro-Tech TPO",
      sections: [{ ...bid().sections[0]!, thickness: 60, fieldLap: 120, color: "Tan" }],
    });
    expect(buildEstimateInputs(tan, byColor).inputs.duroLastMaterial).toBeCloseTo(TPO_MWO * 0.9, 2);
    // Gray has no cell on that row → the family figure (0.84).
    const gray = bid({
      roofSystem: "Duro-Tech TPO",
      sections: [{ ...bid().sections[0]!, thickness: 60, fieldLap: 120, color: "Gray" }],
    });
    expect(buildEstimateInputs(gray, byColor).inputs.duroLastMaterial).toBeCloseTo(
      TPO_MWO * 0.84,
      2,
    );
  });

  it("bills 27 h / 2,500 sq ft × deck × roll width × spacing × complexity (Moderate 1.25) × thickness", () => {
    const { inputs } = buildEstimateInputs(tpoBid(45), tpoAdmin);
    // 2731.5 × 27 / 2500 × 1 × 1 × 1 × 1.25 × 1.0 = 36.875 h
    expect(computeEstimate(inputs).installHours).toBeCloseTo((TPO_MWO * 27 * 1.25) / 2500, 6);
    // 80 mil adds the 7.5% handling; Open complexity (index 0) drops the 1.25.
    expect(
      computeEstimate(buildEstimateInputs(tpoBid(80), tpoAdmin).inputs).installHours,
    ).toBeCloseTo((TPO_MWO * 27 * 1.25 * 1.075) / 2500, 6);
    const open = bid({
      roofSystem: "Duro-Tech TPO",
      sections: [
        { ...bid().sections[0]!, thickness: 45, fieldLap: 120, fastenerOc: 18, complexity: 0 },
      ],
    });
    expect(computeEstimate(buildEstimateInputs(open, tpoAdmin).inputs).installHours).toBeCloseTo(
      (TPO_MWO * 27) / 2500,
      6,
    );
  });

  it("legacy systems are untouched: the Duro-Last anchor still bills at the 10 h base", () => {
    const r = computeEstimate(buildEstimateInputs(bid(), admin).inputs);
    expect(r.installHours).toBeCloseTo(INSTALL, 6);
  });
});

describe("Non-DL TPO / EPDM Rubber — non-Duro-Last membranes (docs §22.35)", () => {
  const combo = (roofSystem: string, baseHours: number): LaborCombo => ({
    roof_system: roofSystem,
    attachment: "mechanical",
    base: { tab_value: 120, tab_multiplier: 1 },
    base_hours_per_2500: baseHours,
    deck_multipliers: { Wood: 1, Steel: 1.05, Concrete: 1.325 },
    fastener_spacing_multipliers: [
      { spacing_in: 18, multiplier: 1 },
      { spacing_in: 12, multiplier: 1.1 },
    ],
    thickness_multipliers: [
      { mil: 45, multiplier: 1 },
      { mil: 60, multiplier: 1 },
      { mil: 75, multiplier: 1.05 },
      { mil: 80, multiplier: 1.075 },
      { mil: 90, multiplier: 1.1 },
    ],
  });
  const ndlAdmin: EngineAdminData = {
    ...admin,
    labor: {
      ...admin.labor,
      "Non-DL TPO|mechanical": buildLaborTables(combo("Non-DL TPO", 27.5), deckOrder),
      "EPDM Rubber|mechanical": buildLaborTables(combo("EPDM Rubber", 31), deckOrder),
    },
    familyMembranePrices: {
      "Non-DL TPO": { "60": 0.7 },
      "EPDM Rubber": { "60": 0.65 },
    },
    rollGoodWidthMulti: { 7: { 30: 2.6, 60: 1.3, 120: 1 }, 8: { 120: 1, 240: 0.85 } },
  };
  const ndlBid = (roofSystem: string, fieldLap: number, over: Partial<BidInput> = {}) =>
    bid({
      roofSystem,
      sections: [{ ...bid().sections[0]!, thickness: 60, fieldLap, fastenerOc: 18 }],
      ...over,
    });
  // 10 ft roll: TPO's 6" side lap → 2731.5 sq ft; EPDM's 3" seam tape → rollQty(10, 0.25).
  const TPO_MWO = rollQty(10, 0.5);
  const EPDM_MWO = rollQty(10, 0.25);

  it("Non-DL TPO: roll-goods quantity × flat $/sq ft bills to Non-DL Other purchases, not Duro-Last material", () => {
    const { inputs, breakdown } = buildEstimateInputs(ndlBid("Non-DL TPO", 120), ndlAdmin);
    expect(inputs.sections[0]!.membraneWithOverlap).toBeCloseTo(TPO_MWO, 6);
    expect(inputs.duroLastMaterial).toBe(0);
    expect(inputs.otherMaterial).toBeCloseTo(TPO_MWO * 0.7, 2);
    expect(breakdown.nonDlMembraneMaterial).toBeCloseTo(TPO_MWO * 0.7, 2);
    // 27.5 h / 2,500 × Moderate 1.25 on a wood deck, 10 ft roll, 18" spacing, 60 mil ×1.
    expect(computeEstimate(inputs).installHours).toBeCloseTo((TPO_MWO * 27.5 * 1.25) / 2500, 6);
  });

  it('EPDM Rubber: 3" seam lap on the roll-goods quantity, 31 h / 2,500 base', () => {
    const { inputs, breakdown } = buildEstimateInputs(ndlBid("EPDM Rubber", 120), ndlAdmin);
    expect(inputs.sections[0]!.membraneWithOverlap).toBeCloseTo(EPDM_MWO, 6);
    expect(inputs.duroLastMaterial).toBe(0);
    expect(breakdown.nonDlMembraneMaterial).toBeCloseTo(EPDM_MWO * 0.65, 2);
    expect(computeEstimate(inputs).installHours).toBeCloseTo((EPDM_MWO * 31 * 1.25) / 2500, 6);
  });

  it("a wall on a Non-DL system bills its membrane at the flat family price into the same Non-DL bucket", () => {
    const withWall = ndlBid("Non-DL TPO", 120, {
      parapets: [
        {
          id: "p1",
          name: "North",
          lengthFt: 100,
          heightBand: "",
          deckType: "Wood",
          predrill: false,
          canted: false,
          girthInches: 24,
          pieces: 1,
          wallType: 1,
        },
      ],
    });
    const { inputs, breakdown } = buildEstimateInputs(withWall, ndlAdmin);
    // Girth 24" → 2 ft billed height × adjusted length (100 + 1 + 1) × $0.70.
    const wall = 2 * 102 * 0.7;
    expect(inputs.duroLastMaterial).toBe(0);
    expect(breakdown.nonDlMembraneMaterial).toBeCloseTo(TPO_MWO * 0.7 + wall, 2);
    expect(inputs.otherMaterial).toBeCloseTo(TPO_MWO * 0.7 + wall, 2);
  });

  it("warns (and prices 0) when the membrane matrix row is still blank", () => {
    const blank: EngineAdminData = { ...ndlAdmin, familyMembranePrices: {} };
    const { inputs, warnings } = buildEstimateInputs(ndlBid("EPDM Rubber", 120), blank);
    expect(inputs.otherMaterial).toBe(0);
    expect(warnings.some((w) => w.includes("No EPDM Rubber membrane price"))).toBe(true);
  });
});
