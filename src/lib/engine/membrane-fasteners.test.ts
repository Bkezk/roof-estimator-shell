import { describe, it, expect } from "vitest";

import { dlRowStyleFastenersField, dlRowStyleFastenersPerim } from "./membrane-fasteners";

const noPerim: [boolean, boolean, boolean, boolean] = [false, false, false, false];

describe("dlRowStyleFastenersField (DLRowStyleFastenersField, roll goods)", () => {
  const base = {
    lengthFt: 100,
    widthFt: 80,
    fieldLapIn: 60,
    fieldSpacingIn: 18,
    overlapWidthIn: 6,
    perimLapIn: -1, // legacy default (unset)
    perimEnhancementWidthFt: 0,
    sideIsPerim: noPerim,
    useCustomSettings: false,
    quickBid: true,
  };

  it("quick bid, no perim sides: rows = Ceil(width / In2Ft(lap−overlap)), fasteners = Round(rowLF/spacing)", () => {
    // rows = Ceil(80 / In2Ft(54)) = Ceil(80/4.5) = 18; rowLF = 18×100 = 1800; 1800/1.5 = 1200
    expect(dlRowStyleFastenersField(base)).toBe(1200);
  });

  it("non-custom perim tab sides carve the literal 30 strip off the width (IL constant, flagged)", () => {
    // strips: sides 0/2 = 30 each → fieldW = 80−60 = 20; rows = Ceil(20/4.5) = 5;
    // rowLF = 5×100 = 500; 500/1.5 = 333.33 → 333
    expect(dlRowStyleFastenersField({ ...base, sideIsPerim: [true, false, true, false] })).toBe(
      333,
    );
  });

  it("non-quick-bid sections count only the field outline: 2×(L+W)/spacing", () => {
    // 2×(100+80) = 360; 360/1.5 = 240
    expect(dlRowStyleFastenersField({ ...base, quickBid: false })).toBe(240);
  });

  it("custom-settings sections keep the computed enhancement strip instead of the 30 constant", () => {
    // perimLap 66 → In2Ft(60) = 5; enhWidth 8 → Ceil(8/5)=2 → strip 10 on side 0.
    // fieldW = 80−10 = 70; rows = Ceil(70/4.5) = 16; rowLF = 1600; /1.5 = 1066.67 → 1067
    expect(
      dlRowStyleFastenersField({
        ...base,
        useCustomSettings: true,
        perimLapIn: 66,
        perimEnhancementWidthFt: 8,
        sideIsPerim: [true, false, false, false],
      }),
    ).toBe(1067);
  });
});

describe("dlRowStyleFastenersPerim (DLRowStyleFastenersPerim, standard sheet, non-custom)", () => {
  it("lap < 120: one row along each perim TAB side (sides 0/2 only)", () => {
    expect(
      dlRowStyleFastenersPerim({
        fieldLapIn: 60,
        spacingIn: 12,
        perimSideLengthsFt: [100, 80, 100, 80],
        sideIsPerim: [true, true, true, true], // sides 1/3 marked but do NOT count below 120
      }),
    ).toBe(200); // (100 + 100) / In2Ft(12)=1
  });

  it("lap ≥ 120: doubled rows on 0/2; sides 1/3 doubled with the 90-inch corner offsets", () => {
    // sides 0/2: 2×80/1 ×2 = 320; sides 1/3: 2×(100 − 7.5 − 7.5)/1 ×2 = 340 → 660
    expect(
      dlRowStyleFastenersPerim({
        fieldLapIn: 120,
        spacingIn: 12,
        perimSideLengthsFt: [80, 100, 80, 100],
        sideIsPerim: [true, true, true, true],
      }),
    ).toBe(660);
  });

  it("unmarked sides contribute nothing", () => {
    expect(
      dlRowStyleFastenersPerim({
        fieldLapIn: 60,
        spacingIn: 12,
        perimSideLengthsFt: [100, 80, 100, 80],
        sideIsPerim: noPerim,
      }),
    ).toBe(0);
  });
});
