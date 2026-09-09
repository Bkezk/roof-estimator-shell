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
 * BAColor id order 1..4, PROVEN from the IL (docs/legacy-money-parity.md §7.2 — eDLColorsID enum
 * field order AND GetCurrentColorPriceIndex agree): Tan, Gray, White, Dark Gray. The earlier
 * assumption (White first) was falsified; at 60mil White takes the LOW 0.5437 rate.
 */
export const CURB_COLOR_ORDER: readonly string[] = ["Tan", "Gray", "White", "Dark Gray"];

/** Wrap $/sqft for a thickness/color; 0 (legacy: rate 0) when either is outside the table. */
export function curbWrapRate(thickness: number, color: string): number {
  const row = CURB_WRAP_RATES[thickness];
  const idx = CURB_COLOR_ORDER.findIndex((c) => c.toLowerCase() === color.trim().toLowerCase());
  if (!row || idx < 0) return 0;
  return row[idx] ?? 0;
}

/**
 * Legacy curb style id → labor curb-type name (docs/legacy-money-parity.md §8.1). The legacy
 * app has ONE style selection (`Curb.Style`) driving BOTH the wrap model (curbWrapCost) and the
 * labor multiplier (`lookup_CurbTypes[Style.ID]`); the seeded curb-type names are that table's
 * live-captured rows for ids 1/2/5/6/7. The canted styles (3/4) quote the wrap and their labor
 * rows are DB-resident (uncaptured) — no mapping. Exported for the UI to derive the labor type
 * from the style selection (collapsing the two pickers is a flagged human-gate UI change; the
 * engine itself still takes both fields).
 */
export const CURB_TYPE_BY_STYLE_ID: Readonly<Record<number, string>> = {
  1: "Open",
  2: "Closed",
  5: "Closed w/ Top",
  6: "Scupper",
  7: "Metal Scupper",
};

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
 * Legacy Curb.Cost, verbatim per style. Returns -1 for styles 3/4 (quote required) and 0 for
 * style 7 (Metal Scupper — no membrane wrap) or any unknown style id.
 */
export function curbWrapCost(i: CurbWrapInputs): number {
  const { styleId, rate, quantity } = i;
  // The legacy method tail rounds EVERY priced style's result (Round(cost, 8) after the
  // switch). The −1 quote markers return early here — Round(−1, 8) is −1, so behavior matches.
  const tail = (cost: number): number => bankersRound(cost, 8);
  if (styleId === 3 || styleId === 4) return -1;
  if (styleId === 1 || styleId === 2) {
    const base = (styleId === 1 ? 4.8081 : 6.2651) * 1.7819;
    const a = increment6(i.dimAIn);
    const b = increment6(i.dimBIn);
    const c = Math.max(12, increment6(i.dimCIn));
    const d = increment6(i.dimDIn);
    const wrapSqFt = ((2 * a + 2 * b) * (c + d)) / 144;
    return tail((wrapSqFt * rate + 0.3099 + base) * 2.6047 * quantity);
  }
  if (styleId === 5) {
    const base = 10.9275 * 1.7819;
    const a = increment6(i.dimAIn);
    const b = increment6(i.dimBIn);
    const c = increment6(i.dimCIn) < 12 ? 24 : 2 * increment6(i.dimCIn);
    const d = increment6(i.dimDIn);
    // IL rva 0x32e3c id-5 block: (A' + 2D' + C') × (B' + 2D' + C') — dims[0] loads once,
    // no ×2 and no B' in the first factor. (An earlier transcription read 2A'+2B'+2D'+C';
    // corrected 2026-09-09, docs §2.)
    const wrapSqFt = ((a + 2 * d + c) * (b + 2 * d + c)) / 144;
    return tail((wrapSqFt * rate + 0.3099 + base) * 2.17777 * quantity);
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
    return tail(cost * quantity);
  }
  // Style 7 (Metal Scupper) and any unknown id fall outside the legacy switch: wrap $0
  // (the metal scupper itself is a quoted/non-DL metal item, not a membrane wrap).
  return 0;
}
