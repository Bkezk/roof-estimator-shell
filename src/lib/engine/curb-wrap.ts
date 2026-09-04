/**
 * Legacy curb membrane material — a verbatim port of `Curb.Cost` (rva 0x32e3c,
 * docs/legacy-money-parity.md §2). Curbs bill membrane as a self-contained prefab-wrap model
 * hardcoded in the legacy code — it does NOT read lookup_DuroLastPrices. The wrap $/sqft rates
 * and every constant below are the capture-era values baked into the binary, surfaced here as
 * data so admins can eventually retune them.
 *
 * Styles 3 and 4 return -1: the legacy app shows these as "quote required" (no auto price).
 */

import { bankersRound } from "./rounding";

/** Wrap $/sqft by thickness (mil) → BAColor columns 1..4 (capture-era hardcoded prices). */
export const CURB_WRAP_RATES: Record<number, readonly [number, number, number, number]> = {
  40: [0.3481, 0.3481, 0.3481, 0.3544],
  50: [0.45, 0.45, 0.45, 0.471875],
  60: [0.5625, 0.5625, 0.5437, 0.5906],
};

/**
 * ASSUMED BAColor order 1..4 = White, Tan, Gray, Dark Gray — the enum order is not yet proven
 * from the IL (extraction follow-up). White as color 1 is near-certain (the legacy default);
 * 40/50mil price columns 1–3 identically so only Gray/Dark Gray at 60mil ride on the assumption.
 */
export const CURB_COLOR_ORDER: readonly string[] = ["White", "Tan", "Gray", "Dark Gray"];

/** Wrap $/sqft for a thickness/color; 0 (legacy: rate 0) when either is outside the table. */
export function curbWrapRate(thickness: number, color: string): number {
  const row = CURB_WRAP_RATES[thickness];
  const idx = CURB_COLOR_ORDER.findIndex((c) => c.toLowerCase() === color.trim().toLowerCase());
  if (!row || idx < 0) return 0;
  return row[idx] ?? 0;
}

/** Legacy increment6: round up to a multiple of 6", minimum 6". */
export const increment6 = (x: number): number => Math.max(6, Math.ceil(x / 6) * 6);
/** Legacy increment2: round up to a multiple of 2", minimum 2". */
export const increment2 = (x: number): number => Math.max(2, Math.ceil(x / 2) * 2);

export interface CurbWrapInputs {
  styleId: number; // legacy CurbStyle.ID 1..6
  dimAIn: number; // footprint A (inches)
  dimBIn: number; // footprint B (inches)
  dimCIn: number; // height C (inches)
  dimDIn: number; // height D (inches)
  rate: number; // wrap $/sqft (curbWrapRate)
  quantity: number;
}

/**
 * Legacy Curb.Cost, verbatim per style. Returns -1 for styles 3/4 (quote required) and 0 for an
 * unknown style id.
 */
export function curbWrapCost(i: CurbWrapInputs): number {
  const { styleId, rate, quantity } = i;
  if (styleId === 3 || styleId === 4) return -1;
  if (styleId === 1 || styleId === 2) {
    const base = (styleId === 1 ? 4.8081 : 6.2651) * 1.7819;
    const a = increment6(i.dimAIn);
    const b = increment6(i.dimBIn);
    const c = Math.max(12, increment6(i.dimCIn));
    const d = increment6(i.dimDIn);
    const wrapSqFt = ((2 * a + 2 * b) * (c + d)) / 144;
    return (wrapSqFt * rate + 0.3099 + base) * 2.6047 * quantity;
  }
  if (styleId === 5) {
    const base = 10.9275 * 1.7819;
    const a = increment6(i.dimAIn);
    const b = increment6(i.dimBIn);
    const c = increment6(i.dimCIn) < 12 ? 24 : 2 * increment6(i.dimCIn);
    const d = increment6(i.dimDIn);
    // verbatim stack order from the IL
    const wrapSqFt = ((2 * a + 2 * b + (2 * d + c)) * (b + 2 * d + c)) / 144;
    return (wrapSqFt * rate + 0.3099 + base) * 2.17777 * quantity;
  }
  if (styleId === 6) {
    const a = increment2(i.dimAIn);
    const b = increment2(i.dimBIn);
    const wrapSqFt = ((2 * a + 2 * b) * 30) / 144;
    let cost = (wrapSqFt * rate + 0.3099 + 4.8081 * 1.7819) * 3.04;
    const c = increment2(i.dimCIn);
    if (c > 18) {
      // verbatim: ((inc2(C) − 18) × 2A' + 2B') / 144 × 0.3484 × 3.04
      cost += (((c - 18) * 2 * a + 2 * b) / 144) * 0.3484 * 3.04;
    }
    return bankersRound(cost * quantity, 8);
  }
  return 0;
}
