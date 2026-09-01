import { describe, it, expect } from "vitest";

import { calcMarkupValue, computeMoney, type MoneyInputs } from "./money";

/** Default-config money inputs; individual tests override what they exercise. */
const base = (over: Partial<MoneyInputs> = {}): MoneyInputs => ({
  duroLastMaterial: 0,
  membraneCostBeforeDiscount: 0,
  sqFtTotalMembrane: 0,
  prepayDiscount: false,
  stdSizeDiscount: false,
  volumeDiscount: false,
  warrantyTotalCost: 0,
  materialUnderlayment: 0,
  otherMaterial: 0,
  shipping: 0,
  laborSubtotal1: 0,
  laborSubtotal2: 0,
  laborSubtotal1Hours: 0,
  hoursPerDay: 9,
  markupMode: 2,
  markup: 0,
  salesTax: 0,
  taxMaterialOnly: false,
  taxExempt: false,
  materialTotalBeforeTax: 0,
  perDiem: 0,
  perDiemInMarkup: true,
  commission: 0,
  commissionInMarkup: false,
  ...over,
});

describe("calcMarkupValue — three modes (engine-truth §4.3)", () => {
  it("mode 2 (gross profit %): S/(1−x/100) − S — anchor 35% on $10,691.33 → $5,756.87", () => {
    expect(calcMarkupValue(2, 35, 10691.33, 0)).toBeCloseTo(5756.87, 2);
  });

  it("mode 0 (% × cost): S × x/100", () => {
    expect(calcMarkupValue(0, 20, 1000, 0)).toBeCloseTo(200, 2);
  });

  it("mode 1 (flat $/man-day): MD × x", () => {
    expect(calcMarkupValue(1, 50, 0, 5.47)).toBeCloseTo(273.5, 2);
  });
});

describe("computeMoney — money chain column 0 (engine-truth §4)", () => {
  it("gross-profit anchor: TotalSub1 $10,691.33 → markup $5,756.87, Subtotal 2 $16,448.20", () => {
    const r = computeMoney(base({ laborSubtotal1: 10691.33, markupMode: 2, markup: 35 }));
    expect(r.subtotal1).toBeCloseTo(10691.33, 2);
    expect(r.markupValue).toBeCloseTo(5756.87, 2);
    expect(r.subtotal2).toBeCloseTo(16448.2, 2);
    expect(r.grandTotal).toBeCloseTo(16448.2, 2);
  });

  it("commission anchor: 3% on Subtotal 2 $16,448.20 (default config) → $493.45", () => {
    // perDiemInMarkup true ⇒ commission base is Subtotal 2 alone (§4.6).
    const r = computeMoney(
      base({ laborSubtotal1: 10691.33, markupMode: 2, markup: 35, commission: 3 }),
    );
    expect(r.subtotal2).toBeCloseTo(16448.2, 2);
    expect(r.commissionValue).toBeCloseTo(493.45, 2);
    // Not in markup ⇒ commission is added at Bid Total.
    expect(r.grandTotal).toBeCloseTo(16448.2 + 493.45, 2);
  });

  it("prepay discount anchor: 5% of M0 $7,058.08 → −$352.90 (stored negative)", () => {
    const r = computeMoney(base({ duroLastMaterial: 7058.08, prepayDiscount: true }));
    expect(r.dTotals[1]).toBeCloseTo(-352.9, 2);
    expect(r.dTotals[4]).toBeCloseTo(7058.08 - 352.9, 2); // TotalAfterDiscount
  });

  it("man-days anchor: 49.27 labor hrs / 9 → 5.47", () => {
    const r = computeMoney(base({ laborSubtotal1Hours: 49.27 }));
    expect(r.totalManDays).toBeCloseTo(5.47, 2);
  });

  it("std-sheet & volume discounts gate on BOTH checkbox and sqft threshold (§4.2)", () => {
    // Below thresholds: amounts are zero regardless of checkbox.
    const small = computeMoney(
      base({
        duroLastMaterial: 1000,
        membraneCostBeforeDiscount: 1000,
        sqFtTotalMembrane: 40000,
        stdSizeDiscount: true,
        volumeDiscount: true,
      }),
    );
    expect(small.dTotals[2]).toBe(0);
    expect(small.dTotals[3]).toBe(0);

    // Above thresholds: std-sheet at ≥50k, volume at >100k, and they stack (volume nets prior).
    const big = computeMoney(
      base({
        duroLastMaterial: 10000,
        membraneCostBeforeDiscount: 10000,
        sqFtTotalMembrane: 100001,
        prepayDiscount: true,
        stdSizeDiscount: true,
        volumeDiscount: true,
      }),
    );
    expect(big.dTotals[2]).toBeCloseTo(-400, 2); // 4% × 10000
    expect(big.dTotals[1]).toBeCloseTo(-500, 2); // 5% × 10000 prepay
    // volume = 5% × (M0 + prepay + stdsheet) = 5% × (10000 − 500 − 400) = −455
    expect(big.dTotals[3]).toBeCloseTo(-455, 2);
  });

  it("whole-contract tax taxes Subtotal 2 + commission, excludes bare per-diem (§4.5)", () => {
    const r = computeMoney(
      base({
        laborSubtotal1: 10000,
        markupMode: 0,
        markup: 0,
        salesTax: 0.0625,
        taxMaterialOnly: false,
      }),
    );
    // Subtotal2 = 10000 (no markup); tax = 6.25% × (10000 + 0 commission).
    expect(r.subtotal2).toBeCloseTo(10000, 2);
    expect(r.salesTaxValue).toBeCloseTo(625, 2);
    expect(r.grandTotal).toBeCloseTo(10625, 2);
  });

  it("tax-exempt forces both tax slots to zero", () => {
    const r = computeMoney(
      base({
        laborSubtotal1: 10000,
        salesTax: 0.0625,
        taxExempt: true,
        materialTotalBeforeTax: 5000,
      }),
    );
    expect(r.salesTaxValue).toBe(0);
  });
});
