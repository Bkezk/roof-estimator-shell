import { describe, it, expect } from "vitest";

import {
  CURB_TYPE_BY_STYLE_ID,
  curbWrapCost,
  curbWrapRate,
  increment2,
  increment6,
} from "./curb-wrap";

describe("curbWrapRate", () => {
  it("looks up the hardcoded thickness × color table (proven BAColor order: Tan/Gray/White/DarkGray)", () => {
    expect(curbWrapRate(40, "White")).toBe(0.3481);
    expect(curbWrapRate(40, "Dark Gray")).toBe(0.3544);
    // Proven BAColor order (parity doc §7.2): 1=Tan, 2=Gray, 3=White, 4=Dark Gray — at 60mil
    // the WHITE rate is the low 0.5437 (ids 1/2 = Tan/Gray share 0.5625).
    expect(curbWrapRate(60, "White")).toBe(0.5437);
    expect(curbWrapRate(60, "Gray")).toBe(0.5625);
    expect(curbWrapRate(60, "Tan")).toBe(0.5625);
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
        curbWrapCost({
          styleId,
          dimAIn: 24,
          dimBIn: 24,
          dimCIn: 12,
          dimDIn: 0,
          rate: 1,
          quantity: 1,
        }),
      ).toBe(-1);
    }
  });

  it("style 5: (A'+2D'+C')×(B'+2D'+C') wrap (corrected first factor), ×2.17777", () => {
    // IL rva 0x32e3c, id-5 block (re-read 2026-09-09): dims[0] is loaded through increment6
    // exactly once — the first factor is A' + 2D' + C', NOT 2A'+2B'+2D'+C' as first ported.
    // inc6(10)=12, 12<12 false → C'=2×12=24; D'=6; wrap=(24+12+24)×(24+12+24)/144 = 3600/144 = 25
    // (25×0.45 + 0.3099 + 10.9275×1.7819) × 2.17777 × qty 2 = 135.15943…
    const cost = curbWrapCost({
      styleId: 5,
      dimAIn: 24,
      dimBIn: 24,
      dimCIn: 10,
      dimDIn: 6,
      rate: 0.45,
      quantity: 2,
    });
    expect(cost).toBeCloseTo(135.1594, 2);
  });

  it("styles 1/2/5 pass through the method-tail Round(cost, 8) like style 6", () => {
    // The legacy final Round(…, 8) sits after the style switch — every result takes it.
    const cost = curbWrapCost({
      styleId: 1,
      dimAIn: 7, // inc6 → 12
      dimBIn: 7,
      dimCIn: 7,
      dimDIn: 1,
      rate: 1 / 3, // forces a long fraction pre-round
      quantity: 1,
    });
    expect(cost).toBe(Number(cost.toFixed(8)));
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
      curbWrapCost({
        styleId: 9,
        dimAIn: 24,
        dimBIn: 24,
        dimCIn: 12,
        dimDIn: 0,
        rate: 1,
        quantity: 1,
      }),
    ).toBe(0);
  });
});

describe("CURB_TYPE_BY_STYLE_ID", () => {
  it("maps the five non-canted styles to the seeded curb-type names; canted styles unmapped", () => {
    expect(CURB_TYPE_BY_STYLE_ID[1]).toBe("Open");
    expect(CURB_TYPE_BY_STYLE_ID[2]).toBe("Closed");
    expect(CURB_TYPE_BY_STYLE_ID[5]).toBe("Closed w/ Top");
    expect(CURB_TYPE_BY_STYLE_ID[6]).toBe("Scupper");
    expect(CURB_TYPE_BY_STYLE_ID[7]).toBe("Metal Scupper");
    expect(CURB_TYPE_BY_STYLE_ID[3]).toBeUndefined();
    expect(CURB_TYPE_BY_STYLE_ID[4]).toBeUndefined();
  });
});
