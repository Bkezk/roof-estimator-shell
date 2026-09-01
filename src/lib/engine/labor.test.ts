import { describe, it, expect } from "vitest";

import {
  smartValue,
  directLookup,
  bandLookup,
  universalFastenerSpacing,
  mechLaborRate,
  snapFieldOc,
  adheredFieldLaborRate,
  adheredPerimCornerLaborRate,
  roofSectionLaborHours,
  duroBondLaborHours,
  type FastenerSpacingRow,
} from "./labor";

describe("admin-data lookup primitives (§3.6/§4)", () => {
  it("smartValue = custom override if set, else default", () => {
    expect(smartValue({ default: 1 })).toBe(1);
    expect(smartValue({ default: 1, custom: 1.25 })).toBe(1.25);
  });

  it("directLookup reads Smart (field) or Default (perim/corner) column by id", () => {
    const map = { 3: { default: 1.1, custom: 1.4 } };
    expect(directLookup(map, 3)).toBe(1.4); // smart (field)
    expect(directLookup(map, 3, true)).toBe(1.1); // default (perim/corner)
    expect(directLookup(map, 99)).toBe(1); // absent ⇒ no-op
  });

  it("bandLookup takes the largest threshold not exceeding the value (descending), smallest as catch-all", () => {
    const bands = [
      { key: 24, value: 1.2 },
      { key: 60, value: 1.0 },
      { key: 120, value: 0.8 },
    ];
    expect(bandLookup(bands, 60)).toBe(1.0);
    expect(bandLookup(bands, 57)).toBe(1.2); // between 24 and 60 → 24 tier
    expect(bandLookup(bands, 200)).toBe(0.8); // above top → 120 tier
    expect(bandLookup(bands, 10)).toBe(1.2); // below all → smallest-key catch-all
  });
});

describe("pull test → fastener spacing (§3.5)", () => {
  const table: FastenerSpacingRow[] = [
    { thickness: 40, designTable: 60, tabLap: 60, pullRating: 350, fieldOc: 15, perimOc: 9 },
    { thickness: 40, designTable: 60, tabLap: 60, pullRating: 500, fieldOc: 12, perimOc: 7 },
  ];

  it('Pull Test 350 → 15" field OC (screen-map anchor), 9" perimeter OC', () => {
    expect(
      universalFastenerSpacing(table, {
        thickness: 40,
        designTable: 60,
        tabLap: 60,
        pullTest: 350,
        which: 0,
      }),
    ).toEqual({ ok: true, onCenter: 15 });
    expect(
      universalFastenerSpacing(table, {
        thickness: 40,
        designTable: 60,
        tabLap: 60,
        pullTest: 350,
        which: 1,
      }),
    ).toEqual({ ok: true, onCenter: 9 });
  });

  it("skips rows whose rated capacity exceeds the entered pull test", () => {
    // pull 300 < both ratings (350, 500) ⇒ none accepted
    expect(
      universalFastenerSpacing(table, {
        thickness: 40,
        designTable: 60,
        tabLap: 60,
        pullTest: 300,
        which: 0,
      }).ok,
    ).toBe(false);
    // pull 600 ≥ both ⇒ first accepted row wins (15)
    expect(
      universalFastenerSpacing(table, {
        thickness: 40,
        designTable: 60,
        tabLap: 60,
        pullTest: 600,
        which: 0,
      }).onCenter,
    ).toBe(15);
  });

  it("thickness/tabLap accept a -1 wildcard row", () => {
    const wild: FastenerSpacingRow[] = [
      { thickness: -1, designTable: 60, tabLap: -1, pullRating: 350, fieldOc: 15, perimOc: 9 },
    ];
    expect(
      universalFastenerSpacing(wild, {
        thickness: 50,
        designTable: 60,
        tabLap: 72,
        pullTest: 350,
        which: 0,
      }).onCenter,
    ).toBe(15);
  });
});

describe("mechanical field labor rate (§3.1)", () => {
  it('ANCHOR (§9): 10 hrs, wood ×1, tab ×1.5125, 18" OC ×1 → 15.125 hrs over 2500 sf (screen shows 15.13)', () => {
    const rate = mechLaborRate({
      deckMulti: 1,
      tabMulti: 1.5125,
      ocMulti: 1,
      sheetSizeMulti: 1,
      complexity: 1,
    });
    expect(rate * 2500).toBeCloseTo(15.125, 6);
  });

  it("Duro-Last oLookupDecktimes factor multiplies the rate; -1 is inert", () => {
    const base = mechLaborRate({
      deckMulti: 1,
      tabMulti: 1,
      ocMulti: 1,
      sheetSizeMulti: 1,
      complexity: 1,
    });
    const withFactor = mechLaborRate({
      deckMulti: 1,
      tabMulti: 1,
      ocMulti: 1,
      sheetSizeMulti: 1,
      complexity: 1,
      deckTimeFactor: 0.5,
    });
    expect(withFactor).toBeCloseTo(base * 0.5, 9);
    const inert = mechLaborRate({
      deckMulti: 1,
      tabMulti: 1,
      ocMulti: 1,
      sheetSizeMulti: 1,
      complexity: 1,
      deckTimeFactor: -1,
    });
    expect(inert).toBe(base);
  });

  it("snapFieldOc rounds down to a multiple of 3, min 6", () => {
    expect(snapFieldOc(17)).toBe(15);
    expect(snapFieldOc(15)).toBe(15);
    expect(snapFieldOc(5)).toBe(6);
    expect(snapFieldOc(6)).toBe(6);
    expect(snapFieldOc(20)).toBe(18);
  });
});

describe("adhered rates (§3.3)", () => {
  it("field: baseHours/1000 × (rollGoodWidth | sheetSize) × complexity", () => {
    expect(
      adheredFieldLaborRate({
        baseHoursPer1000: 12,
        rollGoods: true,
        rollGoodWidthMulti: 1.5,
        sheetSizeMulti: 2,
        complexity: 1,
      }),
    ).toBeCloseTo(0.018, 9); // 0.012 × 1.5
    expect(
      adheredFieldLaborRate({
        baseHoursPer1000: 12,
        rollGoods: false,
        rollGoodWidthMulti: 1.5,
        sheetSizeMulti: 2,
        complexity: 1,
      }),
    ).toBeCloseTo(0.024, 9); // 0.012 × 2 (sheet path)
  });

  it("perimeter applies the 1.2 bump when marked; corner rate = perimeter rate", () => {
    const r = adheredPerimCornerLaborRate({
      baseHoursPer1000: 12,
      rollGoods: true,
      rollGoodWidthMulti: 1.5,
      sheetSizeMulti: 2,
      complexity: 1,
      perimeterBump: true,
    });
    expect(r.perim).toBeCloseTo(0.0216, 9); // 0.012 × 1.2 × 1.5
    expect(r.corner).toBe(r.perim);
  });
});

describe("section labor assembly (§3.0)", () => {
  it("(field+perim+corner rate×area) × thickness, ×(1+adj/100), floored at 0 — chains the §9 anchor", () => {
    const fieldRate = mechLaborRate({
      deckMulti: 1,
      tabMulti: 1.5125,
      ocMulti: 1,
      sheetSizeMulti: 1,
      complexity: 1,
    });
    const hrs = roofSectionLaborHours({
      fieldArea: 2500,
      fieldRate,
      perimArea: 0,
      perimRate: 0,
      cornerArea: 0,
      cornerRate: 0,
      thicknessLabor: 1,
      adjustLaborPct: 0,
    });
    expect(hrs).toBeCloseTo(15.125, 6);
    // labor adjustment applies last
    expect(
      roofSectionLaborHours({
        fieldArea: 2500,
        fieldRate,
        perimArea: 0,
        perimRate: 0,
        cornerArea: 0,
        cornerRate: 0,
        thicknessLabor: 1,
        adjustLaborPct: 10,
      }),
    ).toBeCloseTo(16.6375, 4);
  });

  it("negative composite hours floor to 0 before the labor adjustment", () => {
    expect(
      roofSectionLaborHours({
        fieldArea: 1,
        fieldRate: -5,
        perimArea: 0,
        perimRate: 0,
        cornerArea: 0,
        cornerRate: 0,
        thicknessLabor: 1,
        adjustLaborPct: 50,
      }),
    ).toBe(0);
  });
});

describe("DuroBond model (§3.4/§8)", () => {
  const inputs = {
    membraneWithOverlap: 2500,
    layoutTime: 10,
    thicknessLabor: 1,
    mechSheetMulti: 2,
    fastenerCount: 100,
    singleFastenerTime: 0.1,
  };

  it("_237 applies MechSheetMulti; _230 does not", () => {
    // 237: 2500×(10/2500)×1×2 + 100×0.1 = 20 + 10 = 30
    expect(duroBondLaborHours({ ...inputs, version: "4.0.237" })).toBeCloseTo(30, 6);
    // 230: 2500×(10/2500)×1 + 10 = 10 + 10 = 20
    expect(duroBondLaborHours({ ...inputs, version: "4.0.230" })).toBeCloseTo(20, 6);
  });
});
