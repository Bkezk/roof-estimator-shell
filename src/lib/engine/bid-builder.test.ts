import { describe, it, expect } from "vitest";

import { buildEstimateInputs, type BidInput } from "./bid-builder";
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
    expect(r.parapetLaborHours).toBeCloseTo(4.5, 6); // 100/50 x 2.25
    // rolls into direct labor alongside install 15.125
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125 + 4.5, 3);
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
    expect(adhesiveMaterial).toBeCloseTo(3 * 899 + 5 * 122.1, 2);
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
    expect(r.parapetLaborHours).toBeCloseTo(4.5 * 1.1, 3); // Parapets 110
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
    expect(adhesiveMaterial).toBeCloseTo(4 * 122.1, 2);
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
    expect(adhesiveMaterial).toBeCloseTo(5 * 122.1, 2);
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
    expect(adhesiveMaterial).toBeCloseTo(5 * 122.1, 2);
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
