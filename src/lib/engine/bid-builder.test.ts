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
      sheetSizeLabel: "1500 sf",
      tearOff: false,
      toThicknessInches: 0,
    },
  ],
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
