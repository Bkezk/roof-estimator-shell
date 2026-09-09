import { describe, it, expect } from "vitest";

import { buildEstimateInputs, type BidInput } from "./bid-builder";
import { computeEstimate } from "./estimate";
import { buildReviewLedger } from "./review-ledger";
import { buildLaborTables, type EngineAdminData, type LaborCombo } from "./adapters";

const deckOrder = ["Wood", "Steel", "Concrete"];
const combo: LaborCombo = {
  roof_system: "Duro-Last",
  attachment: "mechanical",
  base: { tab_value: 28, tab_multiplier: 1.5125 },
  deck_multipliers: { Wood: 1 },
  fastener_spacing_multipliers: [{ spacing_in: 18, multiplier: 1 }],
  sheet_size_multipliers: [{ label: "1500 sf", roof_section: 1, underlayment: 1 }],
  thickness_multipliers: [{ mil: 40, multiplier: 1 }],
};

const admin: EngineAdminData = {
  deckOrder,
  priceMatrix: { 40: { rollGoods: { White: 1.23 }, parapet: { White: 1.4 } } },
  labor: { "Duro-Last|mechanical": buildLaborTables(combo, deckOrder) },
  settings: {
    hoursPerDay: 9,
    masterEliteCont: true,
    salesTax: 0.0625,
    taxMaterialOnly: true,
    shippingMode: "stepped",
    shippingPercent: 0,
  },
  underlaymentPrices: { '1/2" ISO': 0.85 },
  underlaymentLabor: {
    layoutHoursByProduct: { '1/2" ISO': 7.775 },
    fastenerCounts: [5],
    fastenerMinutesByDeck: { Wood: 0.342 },
  },
  underlaymentGroups: {
    groups: [],
    groupIdByBoard: { '1/2" ISO': 2, "Flute Filler": 4 },
    needQuoteByBoard: { "Flute Filler": true },
    adhesiveGroupIdByBoard: { '1/2" ISO': 2 },
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
  autoRates: {
    counterflash: { price: 4, laborPerUnit: 0.0167, laborRate: 45 },
    parapetBlocking: { price: 0.57, laborPerUnit: 0.04, laborRate: 40 },
    masonryRemove: { price: 0, laborPerUnit: 0.1, laborRate: 45 },
    masonryReplace: { price: 5, laborPerUnit: 0, laborRate: 45 },
    arpPricePerSqFt: 3,
  },
  curbLabor: {
    setupMinutes: 8,
    minutesByDeck: { Wood: 7.5 },
    multiplierByType: { Closed: 1 },
    curbTypes: ["Closed"],
  },
};

const bid: BidInput = {
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
      layers: [
        {
          board: '1/2" ISO',
          attachment: "mechanical",
          fastenersPerBoard: 5,
          adhesiveName: "",
          substrate: "",
        },
        {
          board: "Flute Filler",
          attachment: "mechanical",
          fastenersPerBoard: 0,
          adhesiveName: "",
          substrate: "",
          quote: { id: "q1", name: "FF", lumpSum: 1200, laborAmount: 6 },
        },
      ],
      sheetSizeLabel: "1500 sf",
      tearOff: false,
      tearOffType: "",
      toThicknessInches: 0,
    },
  ],
  accessories: [{ description: "Vent", price: 25, quantity: 4, laborHoursPerUnit: 0.5 }],
  nonDlLines: [
    {
      description: 'Plywood Deck ¾"',
      category: "Structural Deck Materials",
      price: 21.89,
      laborPerUnit: 0.35,
      laborRate: 45,
      quantity: 10,
    },
    {
      description: "HVAC",
      category: "Subcontractors",
      price: 800,
      laborPerUnit: 0,
      laborRate: 45,
      quantity: 1,
    },
  ],
  metals: [
    { description: "Gutter", price: 4.69, laborPerUnit: 0.06, laborRate: 42.25, quantity: 100 },
  ],
  parapets: [
    {
      id: "p1",
      name: "North",
      lengthFt: 100,
      heightBand: '0"-30"',
      deckType: "Wood",
      predrill: false,
      canted: false,
      girthInches: 30,
      hasBlocking: true,
      capstoneOption: 2,
      arpSizeIn: 18,
    },
  ],
  curbs: [
    {
      id: "c1",
      name: "RTU",
      quantity: 2,
      widthIn: 24,
      lengthIn: 36,
      curbType: "Closed",
      deckType: "Wood",
      termOption: 5,
    },
  ],
  markupMode: 2,
  markup: 35,
  crewLaborRatePerHour: 45,
  commission: 0,
  commissionInMarkup: false,
  perDiem: 0,
  perDiemInMarkup: true,
  prepayDiscount: false,
  stdSizeDiscount: false,
  volumeDiscount: false,
  taxExempt: true,
  adjustLaborPct: 0,
  extraShipping: 50,
  subsCost: 0,
  servicesCost: 120,
  materialUnderlayment: 0,
  otherMaterial: 0,
  warrantyCostPerSqFt: 0,
  warrantyNonEliteMasterCharge: 0,
  warrantyIsHighWind: false,
  warrantyHighWindUpcharge: 0,
};

describe("buildReviewLedger — rows ATTRIBUTE the engine totals (never recompute)", () => {
  const result = buildEstimateInputs(bid, admin);
  const est = computeEstimate(result.inputs);
  const ledger = buildReviewLedger({ bid, result, est, crewRate: 45 });
  const sum = (rows: Array<{ cost: number }>) => rows.reduce((s, r) => s + r.cost, 0);

  it("Duro-Last purchase rows sum to M0 (duroLastMaterial)", () => {
    expect(sum(ledger.purchases.duroLast)).toBeCloseTo(
      result.inputs.duroLastMaterial - result.inputs.materialUnderlayment * 0,
      2,
    );
    expect(sum(ledger.purchases.duroLast)).toBeCloseTo(result.inputs.duroLastMaterial, 2);
  });

  it("insulation purchase rows sum to materialUnderlayment; quote lands on its tile", () => {
    expect(sum(ledger.purchases.insulation)).toBeCloseTo(result.inputs.materialUnderlayment, 2);
    const ff = ledger.purchases.insulation.find((r) => r.label === "Flute Filler")!;
    expect(ff.cost).toBeCloseTo(1200, 2);
  });

  it("non-DL purchase rows sum to otherMaterial (incl. auto counterflash/masonry)", () => {
    expect(sum(ledger.purchases.nonDuroLast)).toBeCloseTo(result.inputs.otherMaterial, 2);
    expect(
      ledger.purchases.nonDuroLast.find((r) => r.label === "Sheet Metal")!.cost,
    ).toBeGreaterThan(0);
  });

  it("purchases totals mirror the engine (materials before tax, shipping split)", () => {
    expect(ledger.purchases.materials).toBeCloseTo(result.inputs.materialTotalBeforeTax, 2);
    expect(ledger.purchases.shippingDl + bid.extraShipping).toBeCloseTo(result.inputs.shipping, 2);
  });

  it("labor rows (crew-rate + own-rate + setup/inspection/tear-off) sum to LaborSubtotal1", () => {
    const rows = [
      ...ledger.labor.duroLast,
      ...ledger.labor.insulation,
      ...ledger.labor.nonDuroLast,
      ledger.labor.setup,
      ledger.labor.inspection,
      ledger.labor.tearOff,
    ];
    // LS1 applies GoodSingle to the crew-rate product once; allow pennies.
    expect(sum(rows)).toBeCloseTo(est.laborSubtotal1, 1);
    const hours = rows.reduce((s, r) => s + (r.hours ?? 0), 0);
    expect(hours).toBeCloseTo(est.laborSubtotal1Hours, 4);
    expect(ledger.labor.totalLabor.cost).toBeCloseTo(est.laborSubtotal1, 2);
  });

  it("subs + services rows sum to LaborSubtotal2; HVAC lands on its fixed row", () => {
    expect(sum(ledger.labor.subcontractors) + sum(ledger.labor.services)).toBeCloseTo(
      est.laborSubtotal2,
      2,
    );
    expect(ledger.labor.subcontractors.find((r) => r.label === "HVAC")!.cost).toBeCloseTo(800, 2);
    expect(ledger.labor.services.find((r) => r.label === "Other services")!.cost).toBeCloseTo(
      120,
      2,
    );
  });
});
