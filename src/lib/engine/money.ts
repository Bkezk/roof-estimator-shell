/**
 * Money chain — `ReviewCalc.Recalculate`, column 0 (the real configured bid), engine-truth §4.
 *
 * This is the spine: subtotal1 → markup → discounts → tax → per-diem → commission → bid total.
 * It operates on already-computed component values (material, membrane cost, labor subtotals,
 * hours, warranty additions, and the per-estimate flags/rates). Quantities (§2) and the labor
 * engine (§3) produce those components; this module assembles the totals penny-for-penny.
 *
 * Rounding rules (§7) are load-bearing:
 *  - Every value that the IL wraps in GoodSingle is wrapped here (goodSingle).
 *  - Column-0 sums of already-GoodSingle'd terms (TotalPurchases, TotalSub1, Subtotal2) are
 *    RAW ADDS with no extra rounding — re-rounding can lose a matching penny (§7.3).
 */

import { goodSingle } from "./rounding";

export type MarkupMode = 0 | 1 | 2;

export interface MoneyInputs {
  // ── Material (Duro-Last catalog), §4.2 / §4.8 row 0 ──
  /** M0 — Duro-Last material subtotal, dTotals[0] (Σ dMaterial[0..6]). */
  duroLastMaterial: number;
  /** MB — membrane cost before discount (basis for the std-sheet discount). */
  membraneCostBeforeDiscount: number;
  /** SF — whole-job membrane square footage (discount thresholds key off this). */
  sqFtTotalMembrane: number;

  // ── Discount checkboxes (Estimate.iDiscountUsage bits), §4.2 ──
  prepayDiscount: boolean; // bit0
  stdSizeDiscount: boolean; // bit1
  volumeDiscount: boolean; // bit2

  // ── Other purchase lines, §4.1 / §4.8 rows 5-9 ──
  /** Raw WarrantyTotalCost (§6); this module applies GoodSingle → dTotals[5]. */
  warrantyTotalCost: number;
  materialUnderlayment: number; // dTotals[6]
  otherMaterial: number; // dTotals[7] (non-DL catalog materials)
  shipping: number; // dTotals[9] — already GoodSingle(DL freight + ExtraShipping)

  // ── Labor, §4.1 / §4.6 ──
  laborSubtotal1: number; // dTotals[10] direct-labor cost
  laborSubtotal2: number; // dTotals[11] labor + subs + services cost
  laborSubtotal1Hours: number; // for man-days
  hoursPerDay: number; // Settings.HoursPerDay (default 9)

  // ── Markup, §4.3 ──
  markupMode: MarkupMode; // 0 = %×cost, 1 = flat $/man-day, 2 = gross-profit %
  markup: number; // x (percent for modes 0/2, $/man-day for mode 1)

  // ── Tax, §4.5 ──
  salesTax: number; // fraction, e.g. 0.0625 (NOT a percent)
  taxMaterialOnly: boolean;
  taxExempt: boolean;
  /** dMaterial[20] — raw material sum before tax (basis for material-only tax). */
  materialTotalBeforeTax: number;

  // ── Per-diem & commission, §4.6 ──
  perDiem: number; // $/man-day (hand-entered)
  perDiemInMarkup: boolean;
  commission: number; // percent (× Commission/100)
  commissionInMarkup: boolean;
}

export interface MoneyResult {
  /** dTotals rows, authoritative map in engine-truth §4.8. */
  dTotals: Record<number, number>;
  /** Convenience accessors. */
  grandTotal: number; // dTotals[20] — Bid Total
  subtotal1: number; // dTotals[13]
  markupValue: number; // dTotals[14]
  subtotal2: number; // dTotals[16]
  commissionValue: number; // dTotals[18]
  perDiemValue: number; // dTotals[17]
  totalManDays: number; // dTotals[21]
  salesTaxValue: number; // dTotals[19]
}

/** Markup value, `CalcMarkupValue` (§4.3). S = TotalSub1, MD = TotalManDays, x = markup. */
export function calcMarkupValue(mode: MarkupMode, x: number, S: number, MD: number): number {
  switch (mode) {
    case 0: // "% × Total Cost"
      return goodSingle((S * x) / 100);
    case 1: // flat "$ / Per Man Day"
      return goodSingle(MD * x);
    case 2: // "Gross Profit %" (margin)
      return goodSingle(S / (1 - x / 100) - S);
    default:
      return 0;
  }
}

/**
 * Compute the full money chain (column 0). Faithfully reproduces `ReviewCalc.Recalculate`,
 * including the §7.3 asymmetry where TotalPurchases / TotalSub1 / Subtotal2 are raw adds.
 */
export function computeMoney(i: MoneyInputs): MoneyResult {
  const d: Record<number, number> = {};
  const rate = i.taxExempt ? 0 : i.salesTax;

  // ── Material subtotal & discounts (§4.2) ──
  const M0 = i.duroLastMaterial;
  d[0] = M0;
  d[1] = -goodSingle(M0 * 0.05); // Prepay: 5% of DL material (stored negative)
  d[2] = i.sqFtTotalMembrane >= 50000 ? -goodSingle(i.membraneCostBeforeDiscount * 0.04) : 0;
  d[3] = i.sqFtTotalMembrane > 100000 ? -goodSingle((M0 + d[1]! + d[2]!) * 0.05) : 0;

  d[4] =
    M0 +
    (i.prepayDiscount ? d[1]! : 0) +
    (i.stdSizeDiscount ? d[2]! : 0) +
    (i.volumeDiscount ? d[3]! : 0);

  // ── Purchases (§4.1) ──
  d[5] = goodSingle(i.warrantyTotalCost); // TotalWarrantyAdditions
  d[6] = i.materialUnderlayment;
  d[7] = i.otherMaterial;
  const materialTax =
    i.taxMaterialOnly && !i.taxExempt ? goodSingle(rate * i.materialTotalBeforeTax) : 0;
  // TotalPurchases — RAW ADD (§7.3), no extra GoodSingle.
  d[8] = d[4]! + d[5]! + d[6]! + d[7]! + materialTax;

  d[9] = i.shipping;
  d[10] = i.laborSubtotal1;
  d[11] = i.laborSubtotal2;

  // ── Per-diem & man-days (§4.6) ──
  const totalManDays = goodSingle(i.laborSubtotal1Hours / i.hoursPerDay);
  d[21] = totalManDays;
  const perDiemValue = goodSingle(i.perDiem * totalManDays);
  d[17] = perDiemValue;

  // Commission when folded into markup: pre-markup base × rate (§4.6).
  const commissionInMarkupValue = goodSingle(
    (d[8]! + d[9]! + d[10]! + d[11]! + perDiemValue) * (i.commission / 100),
  );

  // ── Subtotal 1 (§4.1) — RAW ADD, plus in-markup commission/per-diem ──
  d[13] =
    d[8]! +
    d[9]! +
    d[10]! +
    d[11]! +
    (i.commissionInMarkup ? commissionInMarkupValue : 0) +
    (i.perDiemInMarkup ? perDiemValue : 0);

  // ── Markup (§4.3) ──
  d[14] = calcMarkupValue(i.markupMode, i.markup, d[13]!, totalManDays);

  // ── Subtotal 2 (§4.4) — RAW ADD of two GoodSingle'd values ──
  d[16] = d[13]! + d[14]!;

  // ── Commission value (§4.6) ──
  let commissionValue: number;
  if (i.commissionInMarkup) {
    commissionValue = commissionInMarkupValue; // already folded into Subtotal 1
  } else if (!i.perDiemInMarkup) {
    commissionValue = goodSingle((d[16]! + perDiemValue) * (i.commission / 100));
  } else {
    commissionValue = goodSingle(d[16]! * (i.commission / 100)); // per-diem already inside Subtotal 2
  }
  d[18] = commissionValue;

  // ── Sales tax (§4.5) ──
  // Material-only tax already added inside TotalPurchases; whole-contract tax added at Bid Total.
  d[19] = !i.taxExempt && !i.taxMaterialOnly ? goodSingle(rate * (d[16]! + commissionValue)) : 0;

  // ── Bid Total (§4.7) — commission/per-diem re-added only when NOT in markup ──
  d[20] =
    d[16]! +
    d[19]! +
    (!i.commissionInMarkup ? commissionValue : 0) +
    (!i.perDiemInMarkup ? perDiemValue : 0);

  return {
    dTotals: d,
    grandTotal: d[20]!,
    subtotal1: d[13]!,
    markupValue: d[14]!,
    subtotal2: d[16]!,
    commissionValue: d[18]!,
    perDiemValue: d[17]!,
    totalManDays: d[21]!,
    salesTaxValue: d[19]!,
  };
}
