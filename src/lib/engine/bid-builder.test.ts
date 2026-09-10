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
  type UnderlaymentLayer,
} from "./bid-builder";
import { computeEstimate } from "./estimate";
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23, 2);
    // install labor: field 2500 sf × rate (10×1×1.5125×1/2500) = 15.125 hrs
    expect(r.installHours).toBeCloseTo(15.125, 6);
    // $50/hr × 15.125 = $756.25
    expect(r.laborSubtotal1).toBeCloseTo(756.25, 2);
    // tax-exempt, no markup/commission/discount ⇒ purchases + labor
    expect(r.money.grandTotal).toBeCloseTo(3199.23 + 756.25, 2);
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
    // 7×25.75 + 3×10.20 = 180.25 + 30.60 = 210.85, added to membrane 3199.23
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 210.85, 2);
    // membrane-before-discount stays membrane-only (std-sheet discount basis)
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(3199.23, 2);
  });

  it("underlayment material = board $/sqft × area × 1.06 waste (1.03 for Geotextile)", () => {
    const withU: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85, Geotextile: 0.85 },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }] }),
      withU,
    );
    expect(warnings).toEqual([]);
    // 50×50 = 2500 sf × $0.85 × 1.06 waste = $2,252.50 (legacy UnderlaymentCost, parity doc §6)
    expect(inputs.materialUnderlayment).toBeCloseTo(2252.5, 2);
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23, 2); // membrane unchanged
    const r = computeEstimate(inputs);
    expect(r.money.dTotals[6]).toBeCloseTo(2252.5, 2);
    // Geotextile carries the reduced 1.03 factor: 2500 × 0.85 × 1.03 = 2188.75
    const geo = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: "Geotextile" }] }),
      withU,
    );
    expect(geo.inputs.materialUnderlayment).toBeCloseTo(2188.75, 2);
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
    expect(s0.perimArea).toBe(600);
    expect(s0.fieldArea).toBe(1900); // 2500 − 600
    const r = computeEstimate(inputs);
    // field 1900 × 0.00605 (OC 18) + perim 600 × 0.006655 (OC 12 → ×1.1) = 11.495 + 3.993
    expect(r.installHours).toBeCloseTo(15.488, 3);
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
    // it rolls into the direct-labor hours (install 15.125 + tear-off 62.19)
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 62.19, 2);
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
    // they roll into direct-labor hours alongside install (15.125)
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 16 + 5, 3);
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
    // M0 stays 3199.23, but board material 2500 × 0.85 × 1.06 = 2252.50 lifts material-before-tax
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
    // base bid material = membrane 3199.23 (no accessories) → 0 < 3199.23 ≤ 5001 → 800 freight
    const { inputs } = buildEstimateInputs(bid(), withShip);
    expect(inputs.shipping).toBeCloseTo(800, 2);
    // an accessory line pushes M0 over 5001 → next band
    const { inputs: hi } = buildEstimateInputs(
      bid({ accessories: [{ description: "Big", price: 2000, quantity: 1 }] }),
      withShip,
    );
    expect(hi.shipping).toBeCloseTo(975, 2); // 3199.23 + 2000 = 5199.23 > 5001
  });

  it("freight: percent mode multiplies material-before-tax by shipping_percent/100", () => {
    const pct: EngineAdminData = {
      ...admin,
      underlaymentPrices: { '1/2" ISO': 0.85 },
      settings: { ...admin.settings, shippingMode: "percent", shippingPercent: 5 },
    };
    // Board material (2500 × 0.85 × 1.06 = 2252.50) separates the basis from M0: the percent
    // applies to material-before-tax 3199.23 + 2252.50 = 5451.73 → 5% = 272.5865 → GoodSingle.
    const { inputs } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }] }),
      pct,
    );
    expect(inputs.shipping).toBeCloseTo(272.59, 2);
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
    // install 15.125 + accessory 1.0002 = 16.1252 direct-labor hours
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 1.0002, 3);
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
    expect(inputs.servicesCost).toBeCloseTo(7.515, 3); // 10 × 0.0167 h × $45/h
    expect(inputs.materialTotalBeforeTax).toBeCloseTo(3199.23 + 40, 2); // OtherMaterial is taxable
    const r = computeEstimate(inputs);
    expect(r.money.dTotals[7]).toBeCloseTo(40, 2); // OtherMaterial row
    expect(r.laborSubtotal2).toBeCloseTo(7.515, 3); // subs + services
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
    expect(r.laborSubtotal1).toBeCloseTo(756.25 + 90, 2);
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 2, 6);
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 368.42, 2);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(3199.23, 2); // membrane-only basis unchanged
    const r = computeEstimate(inputs);
    // AdjustedLength = 100 + 1 + pieces(1) = 102 (legacy BaseManHours multiplies
    // AdjustedLength, not raw Length — docs §8.5): 102/50 × 2.25 = 4.59
    expect(r.parapetLaborHours).toBeCloseTo(4.59, 6);
    // rolls into direct labor alongside install 15.125
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 4.59, 3);
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 368.42 + 657.9, 2);
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 368.42, 2);
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
      // Duro-Tuff membrane is flat-family priced now; 1.23 keeps the fixture's 3199.23 membrane.
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 714, 2);
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
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + (2 * 83) / 60, 3);
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
    // Insulation on curb(s): LinealFt = (24+24)/6 = 8 → Round((0.25 + 8×0.0167) × 2, 2) = 0.77 h
    // on top of the type labor (perimeter 8 ft: (8 + 7.5×1×8)/60 × 2 = 2.2667 h).
    const { inputs } = buildEstimateInputs(
      bid({ curbs: [{ ...curb, hasInsulation: true }] }),
      withCurb,
    );
    const r = computeEstimate(inputs);
    expect(r.curbLaborHours).toBeCloseTo((2 * 68) / 60 + 0.77, 4);
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
    // curb base: type labor 2×(8+7.5×20)/60 + ISO Round((0.25+20×0.0167)×2,2)=1.17
    //            + lift 1+20×0.020833 = 1.41666
    const curbBase = (2 * (8 + 7.5 * 20)) / 60 + 1.17 + 1 + 20 * 0.020833;
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 34.0035, 2);
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
    // MembraneWithOverlap(50x50, _230) x $1.10: 3199.23/1.23 x 1.10 = 2861.10
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo((3199.23 / 1.23) * 1.1, 2);

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
    expect(zoned.membraneCostBeforeDiscount).toBeCloseTo((3199.23 / 1.23) * 1.1 * (2200 / 2500), 2);

    // The roll-good sheet (the combo's FIRST label) keeps the roll-goods tier on the full area.
    const { inputs: rg } = buildEstimateInputs(bid(), tabAdmin);
    expect(rg.membraneCostBeforeDiscount).toBeCloseTo(3199.23, 2);
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
    const mwo = 3199.23 / 1.23; // MembraneWithOverlap × 1 (price factored out)
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
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo((3199.23 / 1.23) * 1.35, 2);
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
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(3199.23, 2);
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
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(3199.23, 2);
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
    const mwo = 3199.23 / 1.23; // MembraneWithOverlap for the 50×50 fixture section
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
    expect(fleece.inputs.membraneCostBeforeDiscount).toBeCloseTo(mwo * 1.39, 2);
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
    const mwo = 3199.23 / 1.23;
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
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(3199.23 * 1.05, 2);
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
    // material: 2 x 550 = 1100 -> M0 alongside membrane 3199.23; OtherMaterial untouched
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 1100, 2);
    expect(inputs.otherMaterial).toBeCloseTo(0, 6);
    // labor: 2 x 1.5 h x $40 = $120 at the LINE's own rate -> DIRECT labor (legacy dLabor[5]
    // inside LaborSubtotal1), NOT services; the 3 hours join LS1 hours (man-days).
    expect(inputs.servicesCost).toBeCloseTo(0, 6);
    expect(inputs.ownRateDirectLaborCost).toBeCloseTo(120, 2);
    expect(inputs.ownRateDirectLaborHours).toBeCloseTo(3, 6);
    const r = computeEstimate(inputs);
    expect(r.laborSubtotal2).toBeCloseTo(0, 6);
    // base bid crew labor = 15.125 h x $50 = 756.25; + metals $120 own-rate
    expect(r.laborSubtotal1).toBeCloseTo(756.25 + 120, 2);
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 3, 6);
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
    // board material: 2500 x (0.85 + 0.30) x 1.06 waste = 3047.50 -> underlayment purchase line
    expect(inputs.materialUnderlayment).toBeCloseTo(3047.5, 2);
    // adhesive material (legacy AggregateCalcQtys): 2500/2000 = 1.25 units, ceilinged once per
    // adhesive across the estimate -> 2 whole units x $899 = $1798 -> M0
    expect(adhesiveMaterial).toBeCloseTo(1798, 2);
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 1798, 2);
    const r = computeEstimate(inputs);
    // mech: 7.775 + (0.342/60)(5/32)(2500) = 10.0016 h; adhesive: 2500 x 6.5/1000 = 16.25 h
    expect(r.underlaymentLaborHours).toBeCloseTo(10.0016 + 16.25, 3);
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 10.0016 + 16.25, 3);
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
    expect(inputs.materialUnderlayment).toBeCloseTo(2252.5, 2); // unchanged material
    expect(r.underlaymentLaborHours).toBeCloseTo(10.0016, 3); // labor now bills (parity behavior)
  });

  it("labor template scales categories: install, setup, tear-off, parapets (0 = default)", () => {
    const withTpl: EngineAdminData = {
      ...admin,
      setupTable: { minimum: 16, bands: [{ upTo: 100000, value: 0.003, multiply: true }] },
      tearOff: {
        deckColumns: ["Wood"],
        tearoffTypes: ['BUR < 2"'],
        lookup: { Wood: { 'BUR < 2"': 2.4876 / 100 } },
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
      laborTemplates: {
        names: ["Heavy"],
        byName: {
          Heavy: {
            "Roof Section Labor": 90,
            "Setup Time Labor": 120,
            "Tear-Off Labor": 150,
            "Parapets Labor": 110,
            "Inspection Time Labor": 0, // use-default sentinel
          },
        },
      },
    };
    const { inputs, warnings } = buildEstimateInputs(
      bid({
        laborTemplateName: "Heavy",
        sections: [
          { ...bid().sections[0]!, tearOff: true, tearOffType: 'BUR < 2"', toThicknessInches: 4 },
        ],
        parapets: [
          {
            id: "p1",
            name: "Wall",
            lengthFt: 100,
            heightBand: '0"-30"',
            deckType: "Wood",
            predrill: false,
            canted: false,
            girthInches: 0,
          },
        ],
      }),
      withTpl,
    );
    expect(warnings).toEqual([]);
    const r = computeEstimate(inputs);
    expect(r.installHours).toBeCloseTo(15.125 * 0.9, 3); // Roof Section Labor 90
    expect(r.setupHours).toBeCloseTo(16 * 1.2, 3); // Setup 120 (min 16 x 1.2)
    // tear-off: base 62.19 x 1.5 (per-section additional %), then Ceiling-to-cent
    expect(r.tearOffLaborHours).toBeCloseTo(62.19 * 1.5, 1);
    expect(r.parapetLaborHours).toBeCloseTo(4.59 * 1.1, 3); // Parapets 110, AdjustedLength 102
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
    expect(s0.perimArea).toBe(300);
    expect(s0.fieldArea).toBe(2200);
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

  it("parapet wood blocking: Ceil(Σ length × 1.03) on the TopOfParapet row — LABOR-ONLY", () => {
    const { inputs, warnings } = buildEstimateInputs(
      bid({ parapets: [{ ...wall, hasBlocking: true }] }),
      withParapet,
    );
    expect(warnings).toEqual([]);
    // 100 × 1.03 = 103 → Ceil 103 units × 0.04 h × $40 = $164.80; material price IGNORED
    expect(inputs.ownRateDirectLaborHours).toBeCloseTo(103 * 0.04, 6);
    expect(inputs.ownRateDirectLaborCost).toBeCloseTo(103 * 0.04 * 40, 2);
    expect(inputs.otherMaterial).toBeCloseTo(0, 6);
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
    // 204 sq ft → Ceil 204 × $3 = $612, on top of membrane 3199.23 + parapet membrane 368.42
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 368.42 + 612, 2);
    // a custom ARP length bills RAW (not adjusted): 2 × 30 = 60 → $180
    const custom = buildEstimateInputs(
      bid({ parapets: [{ ...wall, arpSizeIn: 18, arpLengthFt: 30 }] }),
      withParapet,
    );
    expect(custom.inputs.duroLastMaterial).toBeCloseTo(3199.23 + 368.42 + 180, 2);
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
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23 + 368.42 + arpMaterial, 2);
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
    // default (no custom): 7.775 + 0.342/60 × (5/32) × 2500 = 10.0016 — custom is a real change
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
    expect(computeEstimate(def.inputs).underlaymentLaborHours).toBeCloseTo(10.0016, 3);
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
    // priced: 2500 × 0.85 × 1.06 = 2252.50; quote adds 300 verbatim
    expect(inputs.materialUnderlayment).toBeCloseTo(2252.5 + 300, 2);
    // priced labor 10.0016 + quote 1 h
    expect(computeEstimate(inputs).underlaymentLaborHours).toBeCloseTo(11.0016, 3);
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

  it("fluteFillerPieces: verbatim frmFluteFillerCalc geometry", () => {
    // 50 ft wide section, 4 ft pieces (48"), 24" ridge-to-ridge:
    // secWid = 600; across = Round(48/24) = 2; x = 600/48 = 12.5 (frac .5);
    // rows = Round(12.5 + .5) = 13; trim = Round(.5 × 2) = 1; pieces = Round(26 − 1) = 25.
    const r = fluteFillerPieces({
      sections: [{ widthFt: 50 }],
      pieceLengthFt: 4,
      ridgeToRidgeIn: 24,
      wastePct: 10,
    });
    expect(r.pieces).toBe(25);
    expect(r.piecesWithWaste).toBe(Math.ceil(25 * 1.1)); // 28
    expect(fluteFillerPieces({ sections: [], pieceLengthFt: 0, ridgeToRidgeIn: 24 }).pieces).toBe(
      0,
    );
  });

  it("adhered layer over a tapered-group board bills quoteAdhesiveUnits verbatim (no coverage)", () => {
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
        quoteAdhesiveUnits: 7,
      },
    ];
    const { inputs, warnings, adhesiveMaterial } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, layers }] }),
      withU,
    );
    // 7 containers verbatim × $899 (whole units, no coverage formula, no spacing multiplier)
    expect(adhesiveMaterial).toBeCloseTo(7 * 899, 2);
    expect(warnings).toEqual([]);
    expect(inputs.materialUnderlayment).toBeCloseTo(900 + 2500 * 0.85 * 1.06, 2);
    // without the containers entered, it warns instead of billing $0 silently
    const missing = buildEstimateInputs(
      bid({
        sections: [
          {
            ...bid().sections[0]!,
            layers: [layers[0]!, { ...layers[1]!, quoteAdhesiveUnits: 0 }],
          },
        ],
      }),
      withU,
    );
    expect(missing.warnings.some((w) => w.includes("quote adhesive containers"))).toBe(true);
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
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(2601 * 1.28, 2);
  });

  it("roll-good sheet (no tab table): helper and engine both bill roll goods", () => {
    const s = bid().sections[0]!;
    const disp = sectionMembraneDisplayPricing(admin, "Duro-Last", "mechanical", s);
    expect(disp.tierLabel).toBe("Roll Goods");
    expect(disp.pricePerSqFt).toBe(1.23);
    const { inputs } = buildEstimateInputs(bid(), admin);
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(2601 * 1.23, 2);
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
    expect(r.installHours).toBeCloseTo(15.125 * 1.5 + 15.125 * 1.1, 6);
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
    expect(r.installHours).toBeCloseTo(15.125 * 2.4, 6);
    // TearOffBaseLabor = 2500 × 0.024876 × 1 × 2.4 = 149.256 → Round 3 → Ceiling to the cent
    expect(r.tearOffLaborHours).toBeCloseTo(149.26, 2);
    // Duro-Tuff flat membrane price applied (family price, no tab tiers)
    expect(inputs.membraneCostBeforeDiscount).toBeCloseTo(2601 * 1.23, 2);
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
    expect(s0.perimArea).toBe(528);
    expect(s0.cornerArea).toBe(36);
    expect(s0.fieldArea).toBe(2500 - 528 - 36);
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
