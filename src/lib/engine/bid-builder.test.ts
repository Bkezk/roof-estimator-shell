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

  it("underlayment material = board $/sqft × deck area, into the underlayment purchase line", () => {
    const withU: EngineAdminData = { ...admin, underlaymentPrices: { '1/2" ISO': 0.85 } };
    const { inputs, warnings } = buildEstimateInputs(
      bid({ sections: [{ ...bid().sections[0]!, underlaymentBoard: '1/2" ISO' }] }),
      withU,
    );
    expect(warnings).toEqual([]);
    // 50×50 = 2500 sf × $0.85 = $2,125 underlayment (separate from membrane material)
    expect(inputs.materialUnderlayment).toBeCloseTo(2125, 2);
    expect(inputs.duroLastMaterial).toBeCloseTo(3199.23, 2); // membrane unchanged
    const r = computeEstimate(inputs);
    expect(r.money.dTotals[6]).toBeCloseTo(2125, 2);
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
