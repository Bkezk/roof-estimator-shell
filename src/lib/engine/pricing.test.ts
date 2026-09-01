import { describe, it, expect } from "vitest";

import {
  selectMembranePriceTier,
  priceMatrixLookup,
  membraneMaterialCost,
  freightPercent,
  freightStepped,
  shippingTotal,
  duroLastMaterialSubtotal,
  materialTotalBeforeTax,
  type PriceMatrix,
} from "./pricing";

describe("membrane price tier selection (§2.2)", () => {
  const spacings = [28, 60, 120];
  it("roll-good default → rollGoods (col 5)", () => {
    expect(
      selectMembranePriceTier({
        isDefaultRollGood: true,
        fieldLapInches: 28,
        sheetTabSpacings: spacings,
      }),
    ).toBe("rollGoods");
  });
  it("field lap tiers: ≥120 → tab120, ≥60 → tab60, smaller → tab28", () => {
    const t = (lap: number) =>
      selectMembranePriceTier({
        isDefaultRollGood: false,
        fieldLapInches: lap,
        sheetTabSpacings: spacings,
      });
    expect(t(120)).toBe("tab120");
    expect(t(60)).toBe("tab60");
    expect(t(28)).toBe("tab28");
  });
  it("a field lap not offered by the system → custom cost", () => {
    expect(
      selectMembranePriceTier({
        isDefaultRollGood: false,
        fieldLapInches: 45,
        sheetTabSpacings: spacings,
      }),
    ).toBe("custom");
  });
});

describe("price matrix lookup", () => {
  const matrix: PriceMatrix = {
    40: {
      rollGoods: { White: 1.23, Tan: 1.25 },
      tab28: { White: 1.35 },
    },
    50: { rollGoods: { White: 1.36 } },
  };
  it("reads $/sqft by thickness × tier × color", () => {
    expect(priceMatrixLookup(matrix, 40, "rollGoods", "White")).toBe(1.23);
    expect(priceMatrixLookup(matrix, 40, "rollGoods", "Tan")).toBe(1.25);
    expect(priceMatrixLookup(matrix, 40, "tab28", "White")).toBe(1.35);
  });
  it("returns null for an absent cell", () => {
    expect(priceMatrixLookup(matrix, 40, "tab120", "White")).toBeNull();
    expect(priceMatrixLookup(matrix, 60, "rollGoods", "White")).toBeNull();
  });
});

describe("membrane material cost (§2.2 / §1 DuroRoof surcharge)", () => {
  it("area × $/sqft", () => {
    expect(membraneMaterialCost(2500, 1.23, false)).toBeCloseTo(3075, 4);
  });
  it("DuroRoof multiplies the membrane cost by ×1.05", () => {
    expect(membraneMaterialCost(2500, 1.23, true)).toBeCloseTo(3075 * 1.05, 4); // 3228.75
  });
});

describe("freight / shipping (dMaterial[22], dTotals[9])", () => {
  it("percent mode: materialTotal × percent (fraction)", () => {
    expect(freightPercent(10000, 0.05)).toBeCloseTo(500, 4);
  });
  it("stepped mode: lower-bound 'from' table — highest threshold ≤ materialTotal", () => {
    // Real seeded shipping_steps shape (material $ 'from' → shipping cost); row 0 = Minimum.
    const steps = [
      { fromThreshold: 0, cost: 800 },
      { fromThreshold: 5001, cost: 975 },
      { fromThreshold: 7500, cost: 1050 },
      { fromThreshold: 10000, cost: 1100 },
    ];
    expect(freightStepped(0, steps)).toBe(800); // minimum band
    expect(freightStepped(6000, steps)).toBe(975); // 5001 ≤ 6000 < 7500
    expect(freightStepped(7500, steps)).toBe(1050); // inclusive lower edge
    expect(freightStepped(999999, steps)).toBe(1100); // above top → top step
  });
  it("below the first threshold falls back to the first (minimum) row", () => {
    const steps = [
      { fromThreshold: 100, cost: 50 },
      { fromThreshold: 500, cost: 90 },
    ];
    expect(freightStepped(0, steps)).toBe(50);
  });
  it("shippingTotal = GoodSingle(freight + extraShipping)", () => {
    expect(shippingTotal(250, 50)).toBeCloseTo(300, 2);
  });
});

describe("material subtotals (dMaterial aggregation)", () => {
  it("M0 = Σ dMaterial[0..6]", () => {
    expect(duroLastMaterialSubtotal([1000, 200, 150, 300, 80, 40, 0])).toBe(1770);
  });
  it("material total before tax = Σ all slots", () => {
    expect(materialTotalBeforeTax([1000, 200, 150, 300, 80, 40, 0, 500])).toBe(2270);
  });
});
