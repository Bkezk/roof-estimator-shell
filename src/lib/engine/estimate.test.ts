import { describe, it, expect } from "vitest";

import {
  computeEstimate,
  computeSectionInstallHours,
  type EstimateInputs,
  type RoofSection,
  type AdminLaborTables,
} from "./estimate";

const admin: AdminLaborTables = {
  deckTypeMulti: { 1: { default: 1 } }, // wood ×1
  tabBands: [
    { key: 24, value: 2 },
    { key: 60, value: 1.5125 },
  ],
  onCenterBands: [
    { key: 6, value: 1.2 },
    { key: 15, value: 1 },
  ],
  fastenerSpacing: [
    { thickness: 40, designTable: 60, tabLap: 60, pullRating: 350, fieldOc: 15, perimOc: 15 },
  ],
};

const section = (over: Partial<RoofSection> = {}): RoofSection => ({
  id: "s1",
  length: 50,
  width: 50, // roofSqFootage 2500
  fieldArea: 2500,
  perimArea: 0,
  cornerArea: 0,
  membraneWithOverlap: 2500,
  arpSqFt: 0,
  thickness: 40,
  thicknessLabor: 1,
  designTable: 60,
  pullTest: 350,
  fieldLap: 60,
  perimLap: 60,
  cornerLap: 60,
  customFieldFastenerSpacing: -1,
  customPerimFastenerSpacing: -1,
  customCornerFastenerSpacing: -1,
  deckTypeId: 1,
  sheetSizeMulti: 1,
  complexity: 1,
  fieldAttachment: "mechanical",
  perimAttachment: "mechanical",
  adhesiveBaseHoursPer1000: 0,
  rollGoods: false,
  rollGoodWidthMulti: 1,
  adheredPerimeterBump: false,
  tearOff: false,
  tearOffLaborLookup: 0,
  tearOffAdditionalPct: 0,
  toThicknessInches: 0,
  ...over,
});

const estimate = (over: Partial<EstimateInputs> = {}): EstimateInputs => ({
  formulasVersion: "4.0.237",
  sections: [section()],
  admin,
  adjustLaborPct: 0,
  adjustSetupLaborPct: 0,
  adjustInspectionPct: 0,
  crewLaborRatePerHour: 50,
  tearOffFillFraction: 1,
  dumpsterUnitYardage: 30,
  duroLastMaterial: 0,
  membraneCostBeforeDiscount: 0,
  materialUnderlayment: 0,
  otherMaterial: 0,
  materialTotalBeforeTax: 0,
  shipping: 0,
  subsCost: 0,
  servicesCost: 0,
  prepayDiscount: false,
  stdSizeDiscount: false,
  volumeDiscount: false,
  markupMode: 0,
  markup: 0,
  salesTax: 0,
  taxMaterialOnly: false,
  taxExempt: false,
  perDiem: 0,
  perDiemInMarkup: true,
  commission: 0,
  commissionInMarkup: false,
  hoursPerDay: 9,
  warranty: {
    costPerSqFt: 0,
    nonEliteMasterCharge: 0,
    masterEliteCont: true,
    isHighWind: false,
    highWindUpcharge: 0,
  },
  ...over,
});

describe("section install hours wiring (§3)", () => {
  it("resolves the admin multipliers into the §9 field-labor anchor: 2500 sf → 15.125 hrs", () => {
    // deck ×1, tab(60)→1.5125, pull 350→15" oc→×1 ⇒ rate 0.00605/sf; × 2500 sf = 15.125
    expect(computeSectionInstallHours(section(), admin, "4.0.237", 0)).toBeCloseTo(15.125, 6);
  });

  it("labor adjustment flows in", () => {
    expect(computeSectionInstallHours(section(), admin, "4.0.237", 10)).toBeCloseTo(16.6375, 4);
  });
});

describe("computeEstimate end-to-end", () => {
  it("hand-computed single section → grand total $756.25 (labor only)", () => {
    const r = computeEstimate(estimate());
    expect(r.roofSqFootage).toBe(2500);
    expect(r.sqFtTotalMembrane).toBe(2500);
    expect(r.installHours).toBeCloseTo(15.125, 6);
    expect(r.laborSubtotal1Hours).toBeCloseTo(15.125, 6);
    // crew $50/hr × 15.125 hrs = $756.25
    expect(r.laborSubtotal1).toBeCloseTo(756.25, 2);
    expect(r.money.grandTotal).toBeCloseTo(756.25, 2);
  });

  it("a change in section area flows through to the grand total", () => {
    const bigger = computeEstimate(estimate({ sections: [section({ fieldArea: 5000 })] }));
    expect(bigger.installHours).toBeCloseTo(30.25, 6);
    expect(bigger.money.grandTotal).toBeCloseTo(1512.5, 2); // $50 × 30.25
  });

  it("man-days derive from the direct-labor hours (÷ HoursPerDay)", () => {
    const r = computeEstimate(estimate());
    expect(r.money.totalManDays).toBeCloseTo(15.125 / 9, 2);
  });

  it("the §9 money anchors survive end-to-end (gross-profit 35% on Sub1 $10,691.33 → Sub2 $16,448.20)", () => {
    // Put the whole cost basis in otherMaterial, no sections, gross-profit markup.
    const r = computeEstimate(
      estimate({ sections: [], otherMaterial: 10691.33, markupMode: 2, markup: 35 }),
    );
    expect(r.money.subtotal1).toBeCloseTo(10691.33, 2);
    expect(r.money.markupValue).toBeCloseTo(5756.87, 2);
    expect(r.money.subtotal2).toBeCloseTo(16448.2, 2);
  });

  it("warranty cost is computed on whole-job membrane sqft and enters the total", () => {
    const r = computeEstimate(
      estimate({
        warranty: {
          costPerSqFt: 0.18,
          nonEliteMasterCharge: 0,
          masterEliteCont: true,
          isHighWind: false,
          highWindUpcharge: 0,
        },
      }),
    );
    // 0.18 × 2500 sf = 450 warranty, added to purchases → grand total = labor 756.25 + 450
    expect(r.warrantyTotalCost).toBeCloseTo(450, 2);
    expect(r.money.grandTotal).toBeCloseTo(756.25 + 450, 2);
  });

  it("DuroBond section uses its own labor model instead of the rate chain", () => {
    const db = section({
      fieldArea: 0,
      membraneWithOverlap: 2500,
      duroBond: { layoutTime: 10, mechSheetMulti: 2, fastenerCount: 100, singleFastenerTime: 0.1 },
    });
    // 2500×(10/2500)×1×2 + 100×0.1 = 30 hrs (v4.0.237)
    expect(computeSectionInstallHours(db, admin, "4.0.237", 0)).toBeCloseTo(30, 6);
  });
});
