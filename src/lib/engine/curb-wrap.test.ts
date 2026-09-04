import { describe, it, expect } from "vitest";

import { curbWrapCost, curbWrapRate, increment2, increment6 } from "./curb-wrap";

describe("curbWrapRate", () => {
  it("looks up the hardcoded thickness × color table (assumed BAColor order)", () => {
    expect(curbWrapRate(40, "White")).toBe(0.3481);
    expect(curbWrapRate(40, "Dark Gray")).toBe(0.3544);
    expect(curbWrapRate(60, "Gray")).toBe(0.5437);
    expect(curbWrapRate(50, "tan")).toBe(0.45); // case-insensitive
  });
  it("returns 0 (legacy: rate 0) outside the table", () => {
    expect(curbWrapRate(80, "White")).toBe(0);
    expect(curbWrapRate(40, "Terra Cotta")).toBe(0);
  });
});

describe("legacy increments", () => {
  it("increment6 rounds up to 6s with a 6 floor; increment2 to 2s with a 2 floor", () => {
    expect(increment6(0)).toBe(6);
    expect(increment6(12)).toBe(12);
    expect(increment6(13)).toBe(18);
    expect(increment2(0)).toBe(2);
    expect(increment2(19)).toBe(20);
  });
});

describe("curbWrapCost (verbatim Curb.Cost, parity doc §2)", () => {
  it("style 1: (2A'+2B')(C'+D')/144 wrap, ×2.6047", () => {
    // A'=B'=24, C'=max(12,12)=12, D'=inc6(0)=6 → wrap = 96×18/144 = 12 sqft
    // (12×0.3481 + 0.3099 + 4.8081×1.7819) × 2.6047 = 34.0035
    const cost = curbWrapCost({
      styleId: 1,
      dimAIn: 24,
      dimBIn: 24,
      dimCIn: 12,
      dimDIn: 0,
      rate: 0.3481,
      quantity: 1,
    });
    expect(cost).toBeCloseTo(34.0035, 3);
  });

  it("style 2 swaps only the base constant (6.2651)", () => {
    const cost = curbWrapCost({
      styleId: 2,
      dimAIn: 24,
      dimBIn: 24,
      dimCIn: 12,
      dimDIn: 0,
      rate: 0.3481,
      quantity: 1,
    });
    // (12×0.3481 + 0.3099 + 6.2651×1.7819) × 2.6047 = 40.7659
    expect(cost).toBeCloseTo(40.7659, 3);
  });

  it("styles 3 and 4 return -1 (quote required)", () => {
    for (const styleId of [3, 4]) {
      expect(
        curbWrapCost({ styleId, dimAIn: 24, dimBIn: 24, dimCIn: 12, dimDIn: 0, rate: 1, quantity: 1 }),
      ).toBe(-1);
    }
  });

  it("style 5: doubled-C wrap with the verbatim stack order, ×2.17777", () => {
    // inc6(10)=12 not <12 → C'=24; D'=6; wrap=(48+48+(12+24))×(24+12+24)/144 = 132×60/144 = 55
    // (55×0.45 + 0.3099 + 10.9275×1.7819) × 2.17777 × qty 2 = 193.9592
    const cost = curbWrapCost({
      styleId: 5,
      dimAIn: 24,
      dimBIn: 24,
      dimCIn: 10,
      dimDIn: 6,
      rate: 0.45,
      quantity: 2,
    });
    expect(cost).toBeCloseTo(193.9592, 2);
  });

  it("style 6: inc2 dims, ×30/144 wrap, ×3.04, tall-C surcharge, Round8", () => {
    // A'=B'=10; wrap=40×30/144=8.3333; (0 + 0.3099 + 4.8081×1.7819)×3.04 = 26.98746
    // inc2(20)=20>18 → + ((20−18)×2×10 + 2×10)/144 × 0.3484 × 3.04 = 0.44131 → 27.428765
    const cost = curbWrapCost({
      styleId: 6,
      dimAIn: 10,
      dimBIn: 10,
      dimCIn: 20,
      dimDIn: 0,
      rate: 0,
      quantity: 1,
    });
    expect(cost).toBeCloseTo(27.42876, 4);
  });

  it("unknown style ids price 0", () => {
    expect(
      curbWrapCost({ styleId: 9, dimAIn: 24, dimBIn: 24, dimCIn: 12, dimDIn: 0, rate: 1, quantity: 1 }),
    ).toBe(0);
  });
});
