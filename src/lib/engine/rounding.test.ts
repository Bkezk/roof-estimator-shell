import { describe, it, expect } from "vitest";

import { goodSingle, calcLaborCost, in2Ft, toSingle, bankersRound } from "./rounding";

describe("goodSingle — banker's rounding + float32 round-trip (engine-truth §7.1)", () => {
  it("rounds half to EVEN at 2 dp (not half-away-from-zero)", () => {
    // Use exactly-representable halves so the double has no representation drift.
    expect(bankersRound(0.125, 2)).toBe(0.12); // 0.125 → 0.12 (2 is even)
    expect(bankersRound(0.375, 2)).toBe(0.38); // 0.375 → 0.38 (38 even)
    expect(bankersRound(0.625, 2)).toBe(0.62); // 0.625 → 0.62 (62 even)
    expect(bankersRound(0.875, 2)).toBe(0.88); // 0.875 → 0.88 (88 even)
  });

  it("applies a deliberate float32 round-trip (reproduces legacy 0.180000007152557 noise)", () => {
    expect(goodSingle(0.18)).toBe(Math.fround(0.18));
    expect(goodSingle(0.18)).toBeCloseTo(0.18, 6);
    // The stored double is the float32 image, not the clean decimal.
    expect(goodSingle(0.18)).not.toBe(0.18);
  });

  it("handles negative amounts (discounts are stored negative)", () => {
    expect(goodSingle(-352.904)).toBeCloseTo(-352.9, 2);
    expect(-goodSingle(352.904)).toBeCloseTo(-352.9, 2);
  });

  it("toSingle is Math.fround", () => {
    expect(toSingle(16448.2)).toBe(Math.fround(16448.2));
  });
});

describe("calcLaborCost — 4-dp round then float32 (engine-truth §7.2)", () => {
  it("rounds the rate×hours product to 4 dp", () => {
    // 1.23456 × 10 = 12.3456 → 4 dp is exact here
    expect(calcLaborCost(1.23456, 10)).toBeCloseTo(12.3456, 4);
    // 0.33333 × 3 = 0.99999 → stays 4 dp
    expect(calcLaborCost(0.33333, 3)).toBeCloseTo(0.99999, 4);
  });
});

describe("in2Ft — inches→feet at 2 dp (engine-truth §2)", () => {
  it("turns a 6-inch overlap into exactly 0.5 ft", () => {
    expect(in2Ft(6)).toBe(0.5);
  });
  it("rounds to 2 dp", () => {
    expect(in2Ft(64)).toBe(bankersRound(64 / 12, 2)); // 5.3333.. → 5.33
    expect(in2Ft(64)).toBeCloseTo(5.33, 2);
  });
});
