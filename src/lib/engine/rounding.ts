/**
 * Rounding primitives — the make-or-break of a penny-exact rebuild (engine-truth §7).
 *
 * The legacy engine (BidAdvantage.DataAccess, .NET) runs every money value through
 * `GoodSingle`, which is `(double) Convert.ToSingle( Math.Round(x, 2) )`:
 *   1. Math.Round(x, 2) with .NET's default MidpointRounding.ToEven (banker's rounding).
 *   2. A deliberate, lossy cast to float32 and back — this is why legacy data carries
 *      noise like 0.180000007152557 (== Math.fround(0.18)).
 *
 * Labor cost uses a 4-dp round then ToSingle, and the caller later wraps it in GoodSingle,
 * so labor is double-rounded (4dp → 2dp).
 *
 * KNOWN LIMITATION: .NET Math.Round operates on the exact binary value of the double, so a
 * literal like 2.675 (stored as 2.67499999…) can round differently than a naive scale-by-100.
 * We detect the exact-half case with a small epsilon, which matches for the money magnitudes
 * here; adversarial representation cases must still be validated against real bids (Phase 6).
 */

/** float32 round-trip — the .NET `Convert.ToSingle(double)` cast. */
export const toSingle = (x: number): number => Math.fround(x);

/** Round-half-to-even (banker's rounding) of an already-scaled number. */
function roundHalfToEven(n: number): number {
  if (!Number.isFinite(n)) return n;
  const floor = Math.floor(n);
  const diff = n - floor;
  const EPS = 1e-9;
  if (Math.abs(diff - 0.5) < EPS) {
    // exact midpoint → round to the even neighbor
    return floor % 2 === 0 ? floor : floor + 1;
  }
  // Not a midpoint: nearest integer. Math.round is half-up, but the half case is handled above.
  return Math.round(n);
}

/** Banker's rounding to `dp` decimal places (default MidpointRounding.ToEven). */
export function bankersRound(x: number, dp: number): number {
  if (!Number.isFinite(x)) return x;
  const factor = 10 ** dp;
  return roundHalfToEven(x * factor) / factor;
}

/**
 * `GoodSingle(x)` — the money rounder: banker's-round to 2 dp, then float32 round-trip.
 * Every money value in the Review chain passes through this unless engine-truth §7.3 says
 * the sum is a raw add of already-GoodSingle'd terms.
 */
export const goodSingle = (x: number): number => toSingle(bankersRound(x, 2));

/**
 * `CalcLaborCost(rate, hours)` — labor rounder: banker's-round the product to 4 dp, then
 * float32 round-trip (engine-truth §7.2). The money chain wraps the result in `goodSingle`
 * downstream, so labor is intentionally double-rounded (4dp → 2dp).
 */
export const calcLaborCost = (rate: number, hours: number): number =>
  toSingle(bankersRound(rate * hours, 4));

/**
 * `In2Ft(x) = Round(x/12, 2)` (DACommon.In2Ft) — inches to feet at 2 dp. A 6" overlap
 * becomes exactly 0.5. This 2-dp rounding is load-bearing in the lap/quantity math (§2).
 */
export const in2Ft = (inches: number): number => bankersRound(inches / 12, 2);
